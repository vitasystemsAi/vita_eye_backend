import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { computerIpv4 } from '../utils/network';

export interface DiscoveredLanCamera {
  ip: string;
  name: string;
  streamUrl: string;
  source: 'onvif' | 'rtsp' | 'http';
}

function ipv4Interfaces(): string[] {
  const addresses: string[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|wsl|docker|hyper-v|virtualbox|vmware|loopback|bluetooth/i.test(name)) continue;
    for (const entry of entries ?? []) {
      if (String(entry.family) !== 'IPv4' || entry.internal) continue;
      if (isSearchable(entry.address)) addresses.push(entry.address);
    }
  }
  return addresses;
}

/** Private LAN and link-local only. Never walks the public internet. */
function isSearchable(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return true;
  return a === 169 && b === 254 && address !== '169.254.169.254';
}

function hostsOnSubnet(address: string): string[] {
  const parts = address.split('.');
  const prefix = parts.slice(0, 3).join('.');
  const own = Number(parts[3]);
  const hosts: string[] = [];
  for (let host = 1; host <= 254; host++) {
    if (host === own) continue;
    const ip = `${prefix}.${host}`;
    if (ip === '169.254.169.254') continue;
    hosts.push(ip);
  }
  return hosts;
}

function portOpen(host: string, port: number, timeoutMs: number, localAddress?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, family: 4, localAddress });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await run(item);
    }
  });
  await Promise.all(workers);
}

function probeMessage(): Buffer {
  const id = crypto.randomUUID();
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${id}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>`,
  );
}

function discoverOnvif(bindAddress: string, waitMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...found]);
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    socket.on('message', (message) => {
      const text = message.toString();
      for (const match of text.match(/https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/g) ?? []) {
        const ip = match.replace(/^https?:\/\//, '').split(':')[0] ?? '';
        if (isSearchable(ip)) found.add(ip);
      }
    });
    socket.bind(0, bindAddress, () => {
      try {
        socket.addMembership('239.255.255.250', bindAddress);
      } catch {
        /* A direct cable may not join multicast; the port scan still runs. */
      }
      socket.send(probeMessage(), 3702, '239.255.255.250');
    });
  });
}

const RTSP_PATHS = [
  { path: '/cam/realmonitor?channel=1&subtype=1', name: 'CP Plus' },
  { path: '/cam/realmonitor?channel=1&subtype=0', name: 'CP Plus' },
  { path: '/Streaming/Channels/102', name: 'IP camera' },
  { path: '/Streaming/Channels/101', name: 'IP camera' },
  { path: '/stream1', name: 'LAN camera' },
];

function rtspDescribe(ip: string, path: string, localAddress?: string): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port: 554, family: 4, localAddress });
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(code);
    };
    socket.setTimeout(900);
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    let buf = '';
    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1');
      const code = /^RTSP\/\d\.\d (\d{3})/.exec(buf.split('\r\n', 1)[0] ?? '');
      if (code?.[1]) finish(Number(code[1]));
    });
    socket.once('connect', () => {
      socket.write(
        `DESCRIBE rtsp://${ip}:554${path} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: VitaEye\r\n\r\n`,
      );
    });
  });
}

/** 200 or 401 means this path exists. CP Plus answers 401 until the website login is sent. */
async function chooseRtsp(ip: string, localAddress?: string): Promise<DiscoveredLanCamera | null> {
  if (!(await portOpen(ip, 554, 700, localAddress))) return null;
  for (const candidate of RTSP_PATHS) {
    const code = await rtspDescribe(ip, candidate.path, localAddress);
    if (code === 200 || code === 401 || code === 403) {
      return { ip, name: `${candidate.name} ${ip}`, streamUrl: `rtsp://${ip}:554${candidate.path}`, source: 'rtsp' };
    }
  }
  return { ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'rtsp' };
}

function httpCameraKind(ip: string, localAddress?: string): Promise<'cpplus' | 'hikvision' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (kind: 'cpplus' | 'hikvision' | null) => {
      if (settled) return;
      settled = true;
      resolve(kind);
    };
    const req = http.get(
      { host: ip, port: 80, path: '/', timeout: 1200, family: 4, localAddress, headers: { 'User-Agent': 'VitaEye', Connection: 'close' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          if (Buffer.concat(chunks).length > 2500) res.destroy();
        });
        const classify = () => {
          const text = `${res.headers.server ?? ''}\n${Buffer.concat(chunks).toString('latin1')}`.toLowerCase();
          if (/cp\s*plus|cpplus|dahua|web_caps|rpc2|\/cap\.js|jscore/.test(text)) finish('cpplus');
          else if (/hikvision/.test(text)) finish('hikvision');
          else finish(null);
        };
        res.on('end', classify);
        res.on('error', () => finish(null));
        res.on('close', classify);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
  });
}
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(String(stdout).trim());
    });
  });
}

/**
 * The Ethernet port only needs a link. The camera's address is read from its reply,
 * not chosen in advance. If the port has no address yet, DHCP is turned on so Windows
 * can give it a link-local address and the search can be sent out that cable.
 */
export async function prepareDirectEthernet(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const script = `
$ErrorActionPreference = 'Continue'
$adapters = @(Get-NetAdapter | Where-Object {
  $_.Status -eq 'Up' -and $_.HardwareInterface -and $_.Name -notmatch 'Wi-Fi|WLAN|Wireless|Bluetooth|vEthernet|Virtual|Loopback|WSL|Hyper-V|Docker'
})
if ($adapters.Count -eq 0) { Write-Output 'NO_LINK'; exit 0 }
foreach ($adapter in $adapters) {
  $ips = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' })
  if ($ips.Count -eq 0) {
    try { Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Enabled -ErrorAction Stop | Out-Null; Write-Output 'DHCP' } catch {
      if ($_.Exception.Message -match 'Access is denied|elevation|privilege') { Write-Output 'NEED_ADMIN'; exit 0 }
    }
  }
}
Write-Output 'READY'
`;
  try {
    const output = await runPowerShell(script);
    if (output.includes('NEED_ADMIN')) return 'Start Vita Eye as administrator so this PC can reach the camera after its address is found.';
    if (output.includes('DHCP')) await new Promise((resolve) => setTimeout(resolve, 2500));
    if (output.includes('NO_LINK')) return 'No Ethernet link on this computer. Power the camera with the 12V adapter, plug the LAN cable into this computer, and wait for the link light.';
    return null;
  } catch (err) {
    const text = (err as Error).message;
    if (/access is denied|elevation|privilege/i.test(text)) return 'Start Vita Eye as administrator so this PC can reach the camera after its address is found.';
    return text.slice(0, 300);
  }
}

function cpPlusProbe(): Buffer {
  const body = Buffer.from('{"method":"DHDiscover.search","params":{"mac":"","uni":1}}');
  const packet = Buffer.alloc(32 + body.length);
  packet.writeUInt32LE(0xa3, 0);
  packet.writeUInt32LE(body.length, 4);
  body.copy(packet, 32);
  return packet;
}

function jsonField(body: string, key: string): string | null {
  const at = body.indexOf(`"${key}"`);
  if (at < 0) return null;
  let rest = body.slice(at + key.length + 2).trimStart();
  if (!rest.startsWith(':')) return null;
  rest = rest.slice(1).trimStart();
  if (!rest.startsWith('"')) return null;
  const end = rest.indexOf('"', 1);
  return end > 1 ? rest.slice(1, end) : null;
}

/** CP Plus answers this broadcast with its own IP. Nothing is guessed. */
function discoverCpPlus(bindAddress: string): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve([...found]);
    };
    const timer = setTimeout(finish, 1500);
    socket.on('error', () => finish());
    socket.on('message', (message) => {
      const text = message.toString('utf8');
      if (text.includes('DHDiscover.search')) return;
      const start = text.indexOf('{');
      if (start < 0) return;
      const ip = jsonField(text.slice(start), 'IPAddress');
      if (ip && isSearchable(ip)) found.add(ip);
    });
    socket.bind(0, bindAddress, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* A directed broadcast is still sent. */
      }
      const probe = cpPlusProbe();
      const parts = bindAddress.split('.');
      socket.send(probe, 37810, '255.255.255.255');
      socket.send(probe, 37810, `${parts[0]}.${parts[1]}.${parts[2]}.255`);
      socket.send(probe, 37810, '239.255.255.251');
    });
  });
}

/** After the camera reports its address, give the Ethernet port one address on that same subnet so the stream can open. */
export async function alignEthernetTo(cameraIp: string): Promise<string | null> {
  if (!isSearchable(cameraIp) || ipv4Interfaces().some((address) => address.split('.').slice(0, 3).join('.') === cameraIp.split('.').slice(0, 3).join('.'))) return null;
  const prefix = cameraIp.split('.').slice(0, 3).join('.');
  const own = ['20', '30', '50'].map((host) => `${prefix}.${host}`).find((ip) => ip !== cameraIp);
  if (!own || process.platform !== 'win32') return null;
  const script = `
$ErrorActionPreference = 'Continue'
$adapter = Get-NetAdapter | Where-Object {
  $_.Status -eq 'Up' -and $_.HardwareInterface -and $_.Name -notmatch 'Wi-Fi|WLAN|Wireless|Bluetooth|vEthernet|Virtual|Loopback|WSL|Hyper-V|Docker'
} | Select-Object -First 1
if (-not $adapter) { Write-Output 'NO_LINK'; exit 0 }
try {
  New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress '${own}' -PrefixLength 24 -ErrorAction Stop | Out-Null
  Write-Output 'SET ${own}'
} catch {
  if ($_.Exception.Message -match 'already exists') { Write-Output 'SET ${own}'; exit 0 }
  if ($_.Exception.Message -match 'Access is denied|elevation|privilege') { Write-Output 'NEED_ADMIN'; exit 0 }
  Write-Output $_.Exception.Message
}
`;
  try {
    const output = await runPowerShell(script);
    if (output.includes('NEED_ADMIN')) return 'The camera address was found, but Vita Eye must be started as administrator before this PC can open it.';
    if (output.includes('NO_LINK')) return 'The camera address was found, but this computer has no Ethernet link to reach it.';
    if (output.includes('SET ')) await new Promise((resolve) => setTimeout(resolve, 800));
    return null;
  } catch (err) {
    return (err as Error).message.slice(0, 300);
  }
}

export async function discoverLanPortCameras(): Promise<{ cameras: DiscoveredLanCamera[]; notice: string | null }> {
  const notice = await prepareDirectEthernet();
  let interfaces = ipv4Interfaces();
  const byIp = new Map<string, DiscoveredLanCamera>();
  const remember = (camera: DiscoveredLanCamera) => {
    const existing = byIp.get(camera.ip);
    if (!existing || (existing.source !== 'onvif' && camera.source === 'onvif')) byIp.set(camera.ip, camera);
  };

  const announced = [...new Set((await Promise.all(interfaces.map((address) => discoverCpPlus(address).catch(() => [] as string[])))).flat())];
  for (const ip of announced) await alignEthernetTo(ip);
  interfaces = ipv4Interfaces();
  for (const ip of announced) {
    remember({ ip, name: `CP Plus ${ip}`, streamUrl: `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=1`, source: 'rtsp' });
  }

  const onvif = (await Promise.all(interfaces.map((address) => discoverOnvif(address, 1200).catch(() => [] as string[])))).flat();
  for (const ip of onvif) {
    if (byIp.has(ip)) continue;
    await alignEthernetTo(ip);
    remember((await chooseRtsp(ip)) ?? { ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'onvif' });
  }

  for (const address of interfaces) {
    await eachLimited(hostsOnSubnet(address), 48, async (ip) => {
      if (byIp.has(ip)) return;
      const chosen = await chooseRtsp(ip, address);
      if (chosen) {
        remember(chosen);
        return;
      }
      if (!(await portOpen(ip, 80, 200, address))) return;
      const kind = await httpCameraKind(ip, address);
      if (kind === 'cpplus') remember({ ip, name: `CP Plus ${ip}`, streamUrl: `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=1`, source: 'http' });
      else if (kind === 'hikvision') remember({ ip, name: `IP camera ${ip}`, streamUrl: `rtsp://${ip}:554/Streaming/Channels/101`, source: 'http' });
    });
  }

  return { cameras: [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })).slice(0, 24), notice };
}

/** Browser on this PC calls 127.0.0.1 even when the page was opened from another computer. */
export function startLocalLanPortDiscover(port = 47915) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/discover') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const found = await discoverLanPortCameras();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cameras: found.cameras, notice: found.notice, computerAddresses: computerIpv4().map((item) => item.address) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cameras: [], notice: (err as Error).message.slice(0, 300) }));
    }
  });
  server.on('error', () => {
    /* Another Vita Eye process is already listening on this PC. */
  });
  server.listen(port, '127.0.0.1');
  return server;
}

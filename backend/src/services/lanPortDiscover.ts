import crypto from 'node:crypto';
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';

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

function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, family: 4 });
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

function rtspDescribe(ip: string, path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port: 554, family: 4 });
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
async function chooseRtsp(ip: string): Promise<DiscoveredLanCamera | null> {
  if (!(await portOpen(ip, 554, 450))) return null;
  for (const candidate of RTSP_PATHS) {
    const code = await rtspDescribe(ip, candidate.path);
    if (code === 200 || code === 401 || code === 403) {
      return { ip, name: `${candidate.name} ${ip}`, streamUrl: `rtsp://${ip}:554${candidate.path}`, source: 'rtsp' };
    }
  }
  return { ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'rtsp' };
}

function httpCameraKind(ip: string): Promise<'cpplus' | 'hikvision' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (kind: 'cpplus' | 'hikvision' | null) => {
      if (settled) return;
      settled = true;
      resolve(kind);
    };
    const req = http.get(
      { host: ip, port: 80, path: '/', timeout: 800, family: 4, headers: { 'User-Agent': 'VitaEye', Connection: 'close' } },
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
export async function discoverLanPortCameras(): Promise<DiscoveredLanCamera[]> {
  const interfaces = ipv4Interfaces();
  const byIp = new Map<string, DiscoveredLanCamera>();
  const remember = (camera: DiscoveredLanCamera) => {
    const existing = byIp.get(camera.ip);
    if (!existing || (existing.source !== 'onvif' && camera.source === 'onvif')) byIp.set(camera.ip, camera);
  };

  const onvif = (await Promise.all(interfaces.map((address) => discoverOnvif(address, 1200).catch(() => [] as string[])))).flat();
  for (const ip of onvif) {
    remember((await chooseRtsp(ip)) ?? { ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'onvif' });
  }

  const hosts = [...new Set(interfaces.flatMap(hostsOnSubnet))];
  await eachLimited(hosts, 48, async (ip) => {
    if (byIp.has(ip)) return;
    const chosen = await chooseRtsp(ip);
    if (chosen) {
      remember(chosen);
      return;
    }
    if (!(await portOpen(ip, 80, 200))) return;
    const kind = await httpCameraKind(ip);
    if (kind === 'cpplus') {
      remember({ ip, name: `CP Plus ${ip}`, streamUrl: `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=1`, source: 'http' });
    } else if (kind === 'hikvision') {
      remember({ ip, name: `IP camera ${ip}`, streamUrl: `rtsp://${ip}:554/Streaming/Channels/101`, source: 'http' });
    }
  });

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })).slice(0, 24);
}

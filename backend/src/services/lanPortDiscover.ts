import crypto from 'node:crypto';
import dgram from 'node:dgram';
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

/**
 * Finds cameras on this computer's own LAN adapters. A camera plugged straight into the
 * Ethernet port answers ONVIF discovery or has RTSP/HTTP open. Nothing is typed by hand.
 */
export async function discoverLanPortCameras(): Promise<DiscoveredLanCamera[]> {
  const interfaces = ipv4Interfaces();
  const byIp = new Map<string, DiscoveredLanCamera>();
  const remember = (camera: DiscoveredLanCamera) => {
    const existing = byIp.get(camera.ip);
    if (!existing || (existing.source !== 'onvif' && camera.source === 'onvif')) byIp.set(camera.ip, camera);
  };

  const onvif = (await Promise.all(interfaces.map((address) => discoverOnvif(address, 1200).catch(() => [] as string[])))).flat();
  for (const ip of onvif) {
    remember({ ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'onvif' });
  }

  const hosts = [...new Set(interfaces.flatMap(hostsOnSubnet))];
  await eachLimited(hosts, 48, async (ip) => {
    if (byIp.has(ip)) return;
    if (await portOpen(ip, 554, 220)) {
      remember({ ip, name: `LAN camera ${ip}`, streamUrl: `rtsp://${ip}:554/stream1`, source: 'rtsp' });
      return;
    }
    // Port 80 is only a camera signal on a direct cable (link-local). An office LAN has many web devices.
    if (ip.startsWith('169.254.') && (await portOpen(ip, 80, 180))) {
      remember({ ip, name: `LAN camera ${ip}`, streamUrl: `http://${ip}/video`, source: 'http' });
    }
  });

  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })).slice(0, 24);
}

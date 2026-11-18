import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors';

export type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

export function parseCidrs(spec: string): Cidr[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => ipaddr.parseCIDR(c));
}

export function ipAllowed(ip: string, cidrs: Cidr[]): boolean {
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return cidrs.some(([range, bits]) => range.kind() === addr.kind() && addr.match([range, bits] as never));
}

const ALLOWED_SCHEMES: Record<string, string[]> = {
  RTSP: ['rtsp:', 'rtsps:'],
  ONVIF: ['rtsp:', 'rtsps:'],
  HTTP_MJPEG: ['http:', 'https:'],
  LAN: ['rtsp:', 'rtsps:', 'http:', 'https:'],
  LAN_PORT: ['rtsp:', 'rtsps:', 'http:', 'https:'],
};

/**
 * Validates a camera stream URL: scheme allowed for the camera type, no embedded credentials,
 * and every resolved address inside CAMERA_ALLOWED_NETWORKS and outside CAMERA_BLOCKED_NETWORKS
 * (prevents SSRF to arbitrary hosts and to the platform's own internal services).
 */
export async function assertCameraUrlAllowed(rawUrl: string, cameraType: string, cidrs: Cidr[], blocked: Cidr[] = []): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.validation([{ path: 'streamUrl', message: 'Invalid URL' }]);
  }
  const schemes = ALLOWED_SCHEMES[cameraType];
  if (!schemes || !schemes.includes(url.protocol)) {
    throw AppError.validation([{ path: 'streamUrl', message: `Scheme ${url.protocol} not allowed for ${cameraType}` }]);
  }
  if (url.username || url.password) {
    throw AppError.validation([
      { path: 'streamUrl', message: 'Do not embed credentials in the URL; use the username/password fields' },
    ]);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) {
    throw AppError.validation([{ path: 'streamUrl', message: `Host ${host} could not be resolved` }]);
  }
  for (const a of addresses) {
    if (!ipAllowed(a, cidrs) || ipAllowed(a, blocked)) {
      throw AppError.validation([
        { path: 'streamUrl', message: `Host ${host} (${a}) is outside the approved camera networks` },
      ]);
    }
  }
  return url;
}

export function computerIpv4(): { address: string; netmask: string }[] {
  const found: { address: string; netmask: string }[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (String(entry.family) !== 'IPv4' || entry.internal) continue;
      found.push({ address: entry.address, netmask: entry.netmask });
    }
  }
  return found;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function sameLan(ip: string, local: { address: string; netmask: string }): boolean {
  const mask = ipv4ToInt(local.netmask);
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(local.address) & mask);
}

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
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

function streamPort(url: URL): number {
  if (url.port) return Number(url.port);
  if (url.protocol === 'https:') return 443;
  if (url.protocol === 'rtsp:' || url.protocol === 'rtsps:') return 554;
  return 80;
}

/**
 * A camera website on another subnet can still open in a browser and show "Not secure".
 * That label is HTTP, not a Vita Eye failure. This computer has to be on the camera's network.
 */
export async function assertCameraReachable(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!ipaddr.IPv4.isValidFourPartDecimal(host)) return;
  const port = streamPort(url);
  if (await tcpOpen(host, port, 2500)) return;
  const locals = computerIpv4();
  const here = locals.map((item) => item.address).join(', ') || 'no network address';
  const onLan = locals.some((item) => sameLan(host, item));
  const website = port !== 80 && (await tcpOpen(host, 80, 800));
  let message: string;
  if (!onLan) {
    message = `${host} is not on this computer’s network (${here}). A browser can still open that camera on another device and show “Not secure” because the page is HTTP. Connect this computer to the same network as ${host}, or change the camera to an address next to ${here}.`;
  } else if (website) {
    message = `The camera website at ${host} answers, but video port ${port} does not. In the CP Plus page, enable RTSP. “Not secure” in the browser is that website and is normal.`;
  } else {
    message = `${host} did not answer from this computer (${here}). Check that the camera is on and that this computer is on the same network. “Not secure” in the browser is only the camera website.`;
  }
  throw AppError.validation([{ path: 'streamUrl', message }], message);
}

/** Inserts credentials into a stream URL (only ever sent to the internal AI service). */
export function withCredentials(rawUrl: string, creds: { username?: string; password?: string } | null): string {
  if (!creds?.username) return rawUrl;
  const url = new URL(rawUrl);
  url.username = encodeURIComponent(creds.username);
  url.password = encodeURIComponent(creds.password ?? '');
  return url.toString();
}

import dns from 'node:dns/promises';
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

/** Inserts credentials into a stream URL (only ever sent to the internal AI service). */
export function withCredentials(rawUrl: string, creds: { username?: string; password?: string } | null): string {
  if (!creds?.username) return rawUrl;
  const url = new URL(rawUrl);
  url.username = encodeURIComponent(creds.username);
  url.password = encodeURIComponent(creds.password ?? '');
  return url.toString();
}

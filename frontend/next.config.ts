import os from 'node:os';
import path from 'node:path';
import type { NextConfig } from 'next';

const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://localhost:5000').replace(/\/$/, '');
const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? '';
const isDev = process.env.NODE_ENV !== 'production';

function socketOrigins(): string {
  if (!socketUrl) return '';
  const u = new URL(socketUrl);
  const ws = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${u.origin} ${ws}//${u.host}`;
}

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://www.gstatic.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self' ${socketOrigins()} https://*.googleapis.com https://www.gstatic.com${isDev ? ' ws: wss: http://localhost:* http://127.0.0.1:* http://*:5000 ws://*:5000' : ''}`,
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function devOrigins(): string[] {
  const hosts = new Set(['localhost', '127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) hosts.add(net.address);
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: 'security',
  },
  allowedDevOrigins: devOrigins(),
  poweredByHeader: false,
  output: 'standalone',
  turbopack: { root: path.join(__dirname) },
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    // Browser talks to /api/v1 on the frontend origin; the dev/standalone server forwards to the API.
    // In production Nginx routes /api directly to the backend and this rewrite is unused.
    return [{ source: '/api/v1/:path*', destination: `${apiTarget}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

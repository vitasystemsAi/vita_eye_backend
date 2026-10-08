// Cross-platform launcher: `node scripts/run.mjs dev|start` on FRONTEND_HOST:FRONTEND_PORT
// (default 127.0.0.1:3001; browsers only allow webcam access on localhost or HTTPS anyway).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fromEnvFile(file, key) {
  try {
    const line = fs
      .readFileSync(path.join(root, file), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const port = process.env.FRONTEND_PORT ?? fromEnvFile('.env.local', 'FRONTEND_PORT') ?? fromEnvFile('.env', 'FRONTEND_PORT') ?? '3001';
const host = process.env.FRONTEND_HOST ?? fromEnvFile('.env.local', 'FRONTEND_HOST') ?? fromEnvFile('.env', 'FRONTEND_HOST') ?? '127.0.0.1';
const [cmd = 'dev', ...rest] = process.argv.slice(2);
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, cmd, '-p', port, '-H', host, ...rest], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

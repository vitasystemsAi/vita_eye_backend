// Site connector. Run on a PC that can see the client's cameras.
//   $env:VITA_EYE_URL='https://the-vita-eye-site'
//   $env:CONNECTOR_KEY='the key from Cameras → Site connector'
//   node site-connector.mjs
// Requires Node.js and ffmpeg on that PC. One connector per client account.

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

const base = (process.env.VITA_EYE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const key = process.env.CONNECTOR_KEY || '';

function takeJpegs(buffer) {
  const frames = [];
  let rest = buffer;
  let start = rest.indexOf(Buffer.from([0xff, 0xd8]));
  while (start >= 0) {
    const end = rest.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) break;
    frames.push(rest.subarray(start, end + 2));
    rest = rest.subarray(end + 2);
    start = rest.indexOf(Buffer.from([0xff, 0xd8]));
  }
  if (start > 0) rest = rest.subarray(start);
  return { frames, rest };
}

if (process.argv.includes('--self-check')) {
  const { frames, rest } = takeJpegs(Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9, 0xff, 0xd8]));
  if (frames.length !== 1 || frames[0].length !== 6 || rest.length !== 2) {
    console.error('jpeg split failed');
    process.exit(1);
  }
  process.exit(0);
}

if (!key) {
  console.error('Set CONNECTOR_KEY to the key from the client’s Cameras page.');
  process.exit(1);
}

const headers = { 'X-Connector-Key': key };
const running = new Map();

async function assignments() {
  const response = await fetch(`${base}/api/v1/connector/cameras`, { headers });
  if (!response.ok) throw new Error(`Vita Eye rejected the connector key (${response.status})`);
  const body = await response.json();
  return body.data ?? [];
}

function openCamera(camera) {
  const fps = Math.min(8, Math.max(0.2, Number(camera.samplingFps) || 2));
  const child = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', camera.streamUrl, '-an', '-vf', `fps=${fps}`, '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let pending = Buffer.alloc(0);
  let sending = false;
  child.stdout.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 4 * 1024 * 1024) pending = pending.subarray(pending.length - 1024 * 1024);
    const split = takeJpegs(pending);
    pending = Buffer.from(split.rest);
    const frame = split.frames.at(-1);
    if (!frame || sending) return;
    sending = true;
    fetch(`${base}/api/v1/connector/cameras/${camera.id}/frame`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
      body: frame,
    })
      .then((response) => {
        if (!response.ok) console.error(`${camera.name}: frame was not accepted (${response.status})`);
      })
      .catch((err) => console.error(`${camera.name}: ${err.message}`))
      .finally(() => {
        sending = false;
      });
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`${camera.name}: ${text}`);
  });
  child.on('exit', (code) => {
    if (running.get(camera.id) === child) running.delete(camera.id);
    console.error(`${camera.name} stopped (${code ?? 'closed'}). It will be opened again on the next check.`);
  });
  child.on('error', (err) => {
    console.error(err.code === 'ENOENT' ? 'ffmpeg is not installed on this PC. Install it, then run this connector again.' : err.message);
    running.delete(camera.id);
  });
  running.set(camera.id, child);
  console.log(`Opening ${camera.name}`);
}

async function sync() {
  const cameras = await assignments();
  const wanted = new Set(cameras.map((camera) => camera.id));
  for (const [id, child] of running) {
    if (!wanted.has(id)) {
      child.kill();
      running.delete(id);
    }
  }
  for (const camera of cameras) {
    if (!running.has(camera.id)) openCamera(camera);
  }
  if (!cameras.length) console.log('No cameras waiting. Add them in Vita Eye and turn monitoring on.');
}

console.log(`Site connector → ${base}`);
sync().catch((err) => console.error(err.message));
setInterval(() => {
  sync().catch((err) => console.error(err.message));
}, 20_000);

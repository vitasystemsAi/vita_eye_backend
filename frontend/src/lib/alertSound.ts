'use client';

import { useSyncExternalStore } from 'react';

export type AlertKind = 'UNKNOWN' | 'UNCERTAIN';

const MUTE_KEY = 'vita.alertSound.muted';
const PLAYED_KEY = 'vita.alertSound.played';
const LOCK_NAME = 'vita-eye-alert-sound';
const PLAYED_TTL_MS = 10 * 60_000;
const RESUME_WAIT_MS = 300;
/** Driven above 1.0 into the limiter for maximum loudness without clipping distortion. */
const MASTER_GAIN = 1.8;
const PRIORITY: Record<AlertKind, number> = { UNCERTAIN: 1, UNKNOWN: 2 };

interface Tone {
  freq: number;
  at: number;
  dur: number;
  type: OscillatorType;
  gain: number;
}

/** Synthesized so no audio assets are needed; the two patterns are distinguishable without looking. */
const PATTERNS: Record<AlertKind, Tone[]> = {
  // Urgent two-tone siren, three cycles (~1.5 s).
  UNKNOWN: [0, 1, 2].flatMap((i) => [
    { freq: 960, at: i * 0.5, dur: 0.22, type: 'square' as const, gain: 1 },
    { freq: 720, at: i * 0.5 + 0.25, dur: 0.22, type: 'square' as const, gain: 1 },
  ]),
  // Softer rising chime, twice (~1.7 s).
  UNCERTAIN: [0, 0.95].flatMap((t) => [
    { freq: 660, at: t, dur: 0.3, type: 'sine' as const, gain: 1 },
    { freq: 880, at: t + 0.32, dur: 0.45, type: 'sine' as const, gain: 1 },
  ]),
};

interface Snapshot {
  muted: boolean;
  /** The browser has not allowed audio yet (no user interaction on this page). */
  blocked: boolean;
}

const SERVER_SNAPSHOT: Snapshot = { muted: false, blocked: false };

let ctx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
let current: { kind: AlertKind; master: GainNode; end: number } | null = null;
let snapshot: Snapshot | null = null;
let initialized = false;
const listeners = new Set<() => void>();
const playedHere = new Set<string>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function computeSnapshot(): Snapshot {
  return { muted: readMuted(), blocked: ctx?.state !== 'running' };
}

function emit() {
  const next = computeSnapshot();
  if (!snapshot || next.muted !== snapshot.muted || next.blocked !== snapshot.blocked) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  ctx.onstatechange = emit;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  return ctx;
}

/** Browsers only start audio after a user gesture; the first click or key press on the page unlocks it. */
function unlock() {
  const c = getContext();
  if (!c) return;
  if (c.state !== 'running') void c.resume().catch(() => undefined);
  // iOS Safari additionally needs a sound started inside the gesture.
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, 22_050);
  src.connect(c.destination);
  src.start();
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const onGesture = () => {
    unlock();
    if (ctx?.state === 'running') events.forEach((e) => window.removeEventListener(e, onGesture, true));
  };
  events.forEach((e) => window.addEventListener(e, onGesture, true));
  window.addEventListener('storage', (e) => {
    if (e.key === MUTE_KEY) emit();
  });
}

/** One sound per alert per device, even with several tabs open. */
async function claim(key: string): Promise<boolean> {
  if (playedHere.has(key)) return false;
  const run = (): boolean => {
    const now = Date.now();
    let played: Record<string, number> = {};
    try {
      played = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '{}') as Record<string, number>;
    } catch {
      played = {};
    }
    for (const [k, at] of Object.entries(played)) if (now - at > PLAYED_TTL_MS) delete played[k];
    const fresh = !(key in played);
    if (fresh) played[key] = now;
    try {
      localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
    } catch {
      /* storage unavailable: per-tab dedupe only */
    }
    return fresh;
  };
  const fresh = navigator.locks ? await navigator.locks.request(LOCK_NAME, run) : run();
  playedHere.add(key);
  return fresh;
}

function fadeOut(c: AudioContext, master: GainNode) {
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setTargetAtTime(0, c.currentTime, 0.03);
  setTimeout(() => master.disconnect(), 250);
}

function schedule(c: AudioContext, kind: AlertKind) {
  const master = c.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(limiter ?? c.destination);
  const t0 = c.currentTime + 0.02;
  let end = t0;
  for (const tone of PATTERNS[kind]) {
    const start = t0 + tone.at;
    const stop = start + tone.dur;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, start);
    // Short attack/release envelope avoids audible clicks.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(tone.gain, start + 0.015);
    env.gain.setValueAtTime(tone.gain, stop - 0.04);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(stop + 0.02);
    end = Math.max(end, stop);
  }
  setTimeout(() => master.disconnect(), (end - c.currentTime + 0.5) * 1000);
  return { master, end };
}

async function ready(): Promise<AudioContext | null> {
  const c = getContext();
  if (!c) return null;
  if (c.state !== 'running') {
    await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
  }
  emit();
  return c.state === 'running' ? c : null;
}

function start(c: AudioContext, kind: AlertKind) {
  if (current && current.end > c.currentTime) {
    // An unknown-person siren pre-empts a chime; anything else already playing covers the new alert.
    if (PRIORITY[kind] <= PRIORITY[current.kind]) return;
    fadeOut(c, current.master);
  }
  current = { kind, ...schedule(c, kind) };
}

/**
 * Sounds the alarm for an unknown or uncertain detection. `key` (the event id) makes repeated
 * deliveries of the same event — socket broadcast, frame ack, other tabs — sound only once.
 */
export function playAlert(kind: AlertKind, key: string): void {
  if (typeof window === 'undefined') return;
  init();
  if (readMuted()) return;
  void (async () => {
    // Only a tab that can actually play claims the alert, so a blocked tab never swallows it.
    const c = await ready();
    if (!c || !(await claim(key))) return;
    start(c, kind);
  })();
}

/** Plays a pattern immediately (settings preview / unmute feedback). Must run inside a user gesture. */
export function previewAlert(kind: AlertKind): void {
  if (typeof window === 'undefined') return;
  init();
  unlock();
  void ready().then((c) => c && start(c, kind));
}

export function setAlertSoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* ignore */
  }
  if (muted && ctx && current) fadeOut(ctx, current.master);
  emit();
}

function subscribe(listener: () => void) {
  init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  snapshot ??= computeSnapshot();
  return snapshot;
}

export function useAlertSound(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

if (typeof window !== 'undefined') init();

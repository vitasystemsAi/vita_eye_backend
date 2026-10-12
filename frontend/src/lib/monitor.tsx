'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useToast } from '@/components/ui/toast';
import { playAlert } from './alertSound';
import { api, errorMessage } from './api';
import { socketUrl } from './socket';
import type { Camera, FrameAck, FrameFace } from './types';

const SESSION_KEY = 'vita.monitor.session';
const PENDING_STOP_KEY = 'vita.monitor.pendingStop';
const LOCK_NAME = 'vita-eye-monitor';
const MAX_WIDTH = 960;
const JPEG_QUALITY = 0.8;
const ACK_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 6_000;
const SCHEDULE_RETRY_MS = 15_000;
const CAMERA_RETRY_MS = 5_000;
const PENDING_STOP_RETRY_MS = 30_000;

/** Server answers after which this device's monitoring session is over. */
const TERMINAL: Record<string, string> = {
  MONITORING_NOT_STARTED: 'Monitoring was stopped for this camera.',
  TICKET_REVOKED: 'Monitoring was stopped for this camera.',
  TICKET_INVALID: 'The monitoring authorization is no longer valid. Start monitoring again.',
  CAMERA_INACTIVE: 'The camera has been deactivated.',
  CAMERA_NOT_FOUND: 'Camera not found or outside the permitted sites.',
  NOT_A_BROWSER_CAMERA: 'This camera is not a browser camera.',
  FORBIDDEN: 'The account that started monitoring is no longer allowed to stream frames.',
};

export interface MonitorSession {
  cameraId: string;
  cameraName: string;
  location: string;
  samplingFps: number;
  deviceId: string;
  ticket: string;
}

export interface MonitorStats {
  sent: number;
  processed: number;
  dropped: number;
  failed: number;
  latencyMs: number;
  fps: number;
}

/**
 * idle: nothing running · running: frames are being analysed · connecting: server unreachable, frames
 * resume automatically · paused: outside the camera schedule · camera-unavailable: webcam not delivering
 * video · other-tab: another tab on this device is doing the streaming.
 */
export type MonitorStatus = 'idle' | 'starting' | 'running' | 'connecting' | 'paused' | 'camera-unavailable' | 'other-tab';

interface MonitorState {
  session: MonitorSession | null;
  status: MonitorStatus;
  stream: MediaStream | null;
  faces: FrameFace[];
  frameSize: [number, number] | null;
  stats: MonitorStats;
  /** Current problem while running (camera / server), cleared automatically on recovery. */
  error: string | null;
  /** Why the last session ended on its own, shown until the next start. */
  notice: string | null;
  stopping: boolean;
  start: (camera: Camera, deviceId: string) => Promise<Camera>;
  stop: () => Promise<void>;
  resume: () => void;
}

const EMPTY_STATS: MonitorStats = { sent: 0, processed: 0, dropped: 0, failed: 0, latencyMs: 0, fps: 0 };

const MonitorContext = createContext<MonitorState | null>(null);

type FrameGrabber = { grabFrame(): Promise<ImageBitmap> };
type FrameGrabberCtor = new (track: MediaStreamTrack) => FrameGrabber;

function readSession(raw: string | null): MonitorSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<MonitorSession>;
    return s.cameraId && s.ticket ? { cameraName: '', location: '', samplingFps: 1, deviceId: '', ...s } as MonitorSession : null;
  } catch {
    return null;
  }
}

function openCamera(deviceId: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera access requires HTTPS (or localhost) and a modern browser.'));
  return navigator.mediaDevices.getUserMedia({
    video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera permission denied. Allow camera access in the address bar, then press Resume.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Camera not found. Reconnect it — monitoring resumes automatically.';
  if (name === 'NotReadableError') return 'The camera is in use by another application — retrying.';
  return errorMessage(err);
}

/** Tells the server to stop: live socket, then a one-off ticket socket, then the logged-in REST API. */
async function sendStop(sess: Pick<MonitorSession, 'cameraId' | 'ticket'>, live: Socket | null): Promise<boolean> {
  const viaSocket = async (s: Socket) => Boolean(((await s.timeout(STOP_TIMEOUT_MS).emitWithAck('monitor:stop', {})) as { ok?: boolean })?.ok);
  if (live?.connected) {
    try {
      if (await viaSocket(live)) return true;
    } catch {
      /* fall through */
    }
  }
  const temp = io(socketUrl(), { auth: { monitorTicket: sess.ticket }, transports: ['websocket', 'polling'], reconnection: false, timeout: STOP_TIMEOUT_MS });
  try {
    const done = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS * 2);
      temp.on('connect', () => viaSocket(temp).then(resolve, () => resolve(false)).finally(() => clearTimeout(timer)));
      temp.on('connect_error', (err) => {
        clearTimeout(timer);
        resolve(err.message === 'TICKET_REVOKED');
      });
    });
    if (done) return true;
  } finally {
    temp.disconnect();
  }
  try {
    await api.post(`/cameras/${sess.cameraId}/stop-monitoring`);
    return true;
  } catch {
    return false;
  }
}

/** setTimeout backed by a worker, so hidden tabs aren't throttled to one tick per minute. */
function createSleeper() {
  let worker: Worker | null = null;
  try {
    worker = new Worker('/monitor-ticker.js');
  } catch {
    worker = null;
  }
  let seq = 0;
  const waiting = new Map<number, () => void>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<number>) => {
      waiting.get(e.data)?.();
      waiting.delete(e.data);
    };
  }
  return {
    sleep(ms: number): Promise<void> {
      if (!worker || ms <= 0) return new Promise((r) => setTimeout(r, Math.max(ms, 0)));
      const id = ++seq;
      return new Promise((r) => {
        waiting.set(id, r);
        worker!.postMessage({ id, ms });
      });
    },
    dispose() {
      worker?.terminate();
      waiting.forEach((r) => r());
      waiting.clear();
    },
  };
}

/**
 * Device-level browser-camera monitoring. Mounted at the app root (outside the login session), it keeps
 * streaming through logout, session expiry, page changes and network outages until Stop is pressed,
 * and resumes automatically after a reload. Frames are authorized by a per-camera device ticket.
 */
export function MonitorProvider({ children }: { children: ReactNode }) {
  const notify = useToast();
  const [session, setSession] = useState<MonitorSession | null>(null);
  const [owner, setOwner] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [faces, setFaces] = useState<FrameFace[]>([]);
  const [frameSize, setFrameSize] = useState<[number, number] | null>(null);
  const [stats, setStats] = useState<MonitorStats>(EMPTY_STATS);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resumeNonce, setResumeNonce] = useState(0);

  const sessionRef = useRef<MonitorSession | null>(null);
  const ownerRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grabberRef = useRef<{ track: MediaStreamTrack; grabber: FrameGrabber } | null>(null);
  const grabbing = useRef(false);
  const inferBusy = useRef(false);
  const lastProcessedAt = useRef(0);
  const sleeperRef = useRef<ReturnType<typeof createSleeper> | null>(null);
  sessionRef.current = session;
  ownerRef.current = owner;
  socketRef.current = socket;

  const cameraId = session?.cameraId ?? null;
  const samplingFps = session?.samplingFps ?? 1;

  const resetRuntime = useCallback(() => {
    setPaused(false);
    setFaces([]);
    setFrameSize(null);
    setFrameError(null);
    setCameraError(null);
    lastProcessedAt.current = 0;
  }, []);

  const endSession = useCallback(
    (message: string) => {
      if (!sessionRef.current) return;
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      resetRuntime();
      setNotice(message);
      notify('warning', 'Live monitoring ended', message);
    },
    [notify, resetRuntime],
  );
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  useEffect(() => {
    setSession(readSession(localStorage.getItem(SESSION_KEY)));
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) setSession(readSession(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    sleeperRef.current = createSleeper();
    return () => {
      window.removeEventListener('storage', onStorage);
      sleeperRef.current?.dispose();
      sleeperRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (owner && session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [owner, session]);

  // A stop that couldn't reach the server is retried until it lands.
  useEffect(() => {
    let busy = false;
    const flush = async () => {
      const pending = readSession(localStorage.getItem(PENDING_STOP_KEY));
      if (!pending || busy) return;
      busy = true;
      try {
        if (await sendStop(pending, null)) localStorage.removeItem(PENDING_STOP_KEY);
      } finally {
        busy = false;
      }
    };
    void flush();
    const timer = setInterval(() => void flush(), PENDING_STOP_RETRY_MS);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, []);

  // Only one tab per device streams; when it closes, another open tab takes over.
  const hasSession = Boolean(session);
  useEffect(() => {
    if (!hasSession) return;
    if (!navigator.locks) {
      setOwner(true);
      return () => setOwner(false);
    }
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const ac = new AbortController();
    navigator.locks
      .request(LOCK_NAME, { signal: ac.signal }, () => {
        setOwner(true);
        return held;
      })
      .catch(() => undefined);
    return () => {
      ac.abort();
      release();
      setOwner(false);
    };
  }, [hasSession]);

  // Ticket-authenticated socket, independent of the user's login session.
  useEffect(() => {
    if (!owner || !cameraId) return;
    const s = io(socketUrl(), {
      auth: (cb) => cb({ monitorTicket: sessionRef.current?.ticket }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reconnectLater = () => {
      clearTimeout(retry);
      retry = setTimeout(() => s.connect(), CAMERA_RETRY_MS);
    };
    s.on('connect', () => setConnected(true));
    s.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') reconnectLater();
    });
    s.on('connect_error', (err) => {
      setConnected(false);
      if (TERMINAL[err.message]) endSessionRef.current(TERMINAL[err.message]);
      else if (!s.active) reconnectLater();
    });
    s.on('monitor:ticket', (ticket: string) => setSession((prev) => (prev && prev.cameraId === cameraId ? { ...prev, ticket } : prev)));
    setSocket(s);
    return () => {
      clearTimeout(retry);
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [owner, cameraId]);

  // Webcam: kept open for the whole session and re-acquired if it drops out.
  const deviceId = session?.deviceId ?? '';
  useEffect(() => {
    if (!owner || !cameraId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attach = (s: MediaStream) => {
      streamRef.current = s;
      setStream(s);
      setCameraError(null);
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (cancelled || streamRef.current !== s) return;
        streamRef.current = null;
        setStream(null);
        setCameraError('Camera disconnected — retrying.');
        timer = setTimeout(acquire, CAMERA_RETRY_MS);
      });
    };
    async function acquire() {
      if (cancelled) return;
      if (streamRef.current?.active) return attach(streamRef.current);
      try {
        const s = await openCamera(deviceId);
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        attach(s);
      } catch (err) {
        if (cancelled) return;
        setCameraError(cameraErrorMessage(err));
        if ((err as DOMException)?.name !== 'NotAllowedError') timer = setTimeout(acquire, CAMERA_RETRY_MS);
      }
    }
    void acquire();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      grabberRef.current = null;
      setStream(null);
    };
  }, [owner, cameraId, deviceId, resumeNonce]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  const grab = useCallback(async (s: MediaStream): Promise<HTMLCanvasElement | null> => {
    const video = videoRef.current;
    const track = s.getVideoTracks()[0];
    let source: CanvasImageSource | null = null;
    let width = 0;
    let height = 0;
    let bitmap: ImageBitmap | null = null;
    const Grabber = (window as unknown as { ImageCapture?: FrameGrabberCtor }).ImageCapture;
    // Hidden tabs may stop painting <video>; ImageCapture reads straight from the camera track.
    if (document.hidden && Grabber && track?.readyState === 'live') {
      try {
        if (grabberRef.current?.track !== track) grabberRef.current = { track, grabber: new Grabber(track) };
        bitmap = await grabberRef.current.grabber.grabFrame();
        source = bitmap;
        width = bitmap.width;
        height = bitmap.height;
      } catch {
        bitmap = null;
      }
    }
    if (!source && video?.videoWidth) {
      source = video;
      width = video.videoWidth;
      height = video.videoHeight;
    }
    if (!source) return null;
    const scale = Math.min(1, MAX_WIDTH / width);
    canvasRef.current ??= document.createElement('canvas');
    const c = canvasRef.current;
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
    bitmap?.close();
    return c;
  }, []);

  // Back-to-back capture: the next frame is sent as soon as the previous one is answered, capped at
  // the camera's sampling rate. Pauses (not stops) while offline or outside the schedule.
  useEffect(() => {
    if (!owner || !cameraId || !stream || !socket) return;
    let cancelled = false;
    const minGapMs = 1000 / Math.max(0.2, samplingFps);

    async function sendOne(): Promise<'ok' | 'wait' | 'paused' | 'ended'> {
      if (!socket!.connected) return 'wait';
      if (grabbing.current) return 'wait';
      grabbing.current = true;
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await grab(stream!);
      } finally {
        grabbing.current = false;
      }
      if (!canvas) return 'wait';
      const t0 = performance.now();
      const blob = await new Promise<Blob | null>((r) => canvas!.toBlob(r, 'image/jpeg', JPEG_QUALITY));
      if (!blob || cancelled) return 'wait';
      const size: [number, number] = [canvas.width, canvas.height];
      setStats((s) => ({ ...s, sent: s.sent + 1 }));
      inferBusy.current = true;
      try {
        const ack: FrameAck = await socket!.timeout(ACK_TIMEOUT_MS).emitWithAck('frame', { cameraId, image: await blob.arrayBuffer() });
        if (cancelled) return 'ended';
        if (ack.ok && ack.dropped) {
          setStats((s) => ({ ...s, dropped: s.dropped + 1 }));
          return 'ok';
        }
        if (ack.ok) {
          for (const a of ack.alerts ?? []) playAlert(a.eventType, a.id);
          const done = performance.now();
          const gap = lastProcessedAt.current ? done - lastProcessedAt.current : 0;
          lastProcessedAt.current = done;
          setFaces(ack.faces ?? []);
          setFrameSize(ack.frameSize ?? size);
          setPaused(false);
          setFrameError(null);
          setStats((s) => ({
            ...s,
            processed: s.processed + 1,
            latencyMs: s.latencyMs ? s.latencyMs * 0.8 + (done - t0) * 0.2 : done - t0,
            fps: gap ? (s.fps ? s.fps * 0.8 + (1000 / gap) * 0.2 : 1000 / gap) : s.fps,
          }));
          return 'ok';
        }
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        if (ack.error === 'OUTSIDE_SCHEDULE') {
          setPaused(true);
          setFaces([]);
          return 'paused';
        }
        if (ack.error && TERMINAL[ack.error]) {
          endSessionRef.current(TERMINAL[ack.error]);
          return 'ended';
        }
        setFrameError(ack.error === 'AI_SERVICE_UNAVAILABLE' ? 'Recognition service unavailable — retrying.' : `Frame failed: ${ack.error ?? 'unknown error'} — retrying.`);
        return 'wait';
      } catch {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        setFrameError('No response from the server — retrying.');
        return 'wait';
      } finally {
        inferBusy.current = false;
      }
    }

    void (async () => {
      while (!cancelled) {
        const t0 = performance.now();
        const outcome = await sendOne();
        if (cancelled || outcome === 'ended') break;
        const gap = outcome === 'paused' ? SCHEDULE_RETRY_MS : outcome === 'wait' ? Math.max(minGapMs, 500) : minGapMs;
        const sleep = sleeperRef.current?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        await sleep(Math.max(gap - (performance.now() - t0), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, cameraId, samplingFps, stream, socket, grab]);

  // While one frame is being identified, keep sending the newest picture so the wall does not freeze.
  useEffect(() => {
    if (!owner || !cameraId || !stream || !socket) return;
    let cancelled = false;
    let sending = false;
    const timer = window.setInterval(() => {
      if (cancelled || sending || !inferBusy.current || grabbing.current || !socket.connected) return;
      sending = true;
      void (async () => {
        try {
          grabbing.current = true;
          const canvas = await grab(stream);
          grabbing.current = false;
          if (!canvas || cancelled || !inferBusy.current) return;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.45));
          if (!blob || cancelled || !inferBusy.current) return;
          await socket.timeout(2000).emitWithAck('frame', { cameraId, image: await blob.arrayBuffer() });
        } catch {
          /* best-effort picture while recognition is busy */
        } finally {
          grabbing.current = false;
          sending = false;
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [owner, cameraId, stream, socket, grab]);

  useEffect(() => {
    if (!session || !owner) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session, owner]);

  const start = useCallback(
    async (camera: Camera, devId: string) => {
      setNotice(null);
      setStarting(true);
      let s: MediaStream | null = null;
      try {
        try {
          s = await openCamera(devId);
        } catch (err) {
          throw new Error(cameraErrorMessage(err));
        }
        const { data } = await api.post<{ camera: Camera; message: string; monitorTicket?: string }>(`/cameras/${camera.id}/start-monitoring`);
        if (!data.monitorTicket) throw new Error('The server did not issue a monitoring ticket. Restart the API and try again.');
        if (readSession(localStorage.getItem(PENDING_STOP_KEY))?.cameraId === camera.id) localStorage.removeItem(PENDING_STOP_KEY);
        streamRef.current = s;
        setStream(s);
        resetRuntime();
        setStats(EMPTY_STATS);
        const next: MonitorSession = {
          cameraId: camera.id,
          cameraName: data.camera.cameraName,
          location: data.camera.location,
          samplingFps: data.camera.samplingFps,
          deviceId: devId,
          ticket: data.monitorTicket,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        setSession(next);
        return data.camera;
      } catch (err) {
        s?.getTracks().forEach((t) => t.stop());
        throw err;
      } finally {
        setStarting(false);
      }
    },
    [resetRuntime],
  );

  const stop = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    setStopping(true);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const ok = await sendStop(sess, ownerRef.current ? socketRef.current : null);
      localStorage.removeItem(SESSION_KEY);
      if (!ok) {
        localStorage.setItem(PENDING_STOP_KEY, JSON.stringify({ cameraId: sess.cameraId, ticket: sess.ticket }));
        notify('warning', 'Stopped on this device', 'The server could not be reached; it will be updated as soon as the connection returns.');
      } else {
        notify('info', 'Monitoring stopped', sess.cameraName);
      }
      setSession(null);
      resetRuntime();
      setStats(EMPTY_STATS);
    } finally {
      setStopping(false);
    }
  }, [notify, resetRuntime]);

  const resume = useCallback(() => {
    setCameraError(null);
    setResumeNonce((n) => n + 1);
  }, []);

  const status: MonitorStatus = !session
    ? starting
      ? 'starting'
      : 'idle'
    : !owner
      ? 'other-tab'
      : !stream
        ? 'camera-unavailable'
        : !connected
          ? 'connecting'
          : paused
            ? 'paused'
            : 'running';

  const error = status === 'camera-unavailable' ? (cameraError ?? 'Starting camera…') : status === 'connecting' ? 'Server unreachable — the camera stays on and analysis resumes automatically.' : frameError;

  const value = useMemo<MonitorState>(
    () => ({ session, status, stream, faces, frameSize, stats, error, notice, stopping, start, stop, resume }),
    [session, status, stream, faces, frameSize, stats, error, notice, stopping, start, stop, resume],
  );

  return (
    <MonitorContext.Provider value={value}>
      {children}
      <video ref={videoRef} muted playsInline aria-hidden className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0" />
    </MonitorContext.Provider>
  );
}

export function useMonitor(): MonitorState {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error('useMonitor must be used inside MonitorProvider');
  return ctx;
}

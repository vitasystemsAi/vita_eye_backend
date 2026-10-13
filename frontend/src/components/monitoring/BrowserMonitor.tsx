'use client';

import { Activity, Camera as CameraIcon, CircleStop, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertSoundToggle } from '@/components/AlertSoundToggle';
import { FACE_COLORS, FACE_LABELS } from '@/components/badges';
import { Badge, Button, Field, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMonitor, type MonitorStatus } from '@/lib/monitor';
import { useSocket } from '@/lib/socket';
import type { Camera, FrameFace } from '@/lib/types';

const PILL: Partial<Record<MonitorStatus, { text: string; className: string }>> = {
  running: { text: 'LIVE', className: 'bg-red-600/90' },
  connecting: { text: 'RECONNECTING', className: 'bg-amber-600/90' },
  paused: { text: 'PAUSED · OUTSIDE SCHEDULE', className: 'bg-sky-700/90' },
};

function FaceOverlay({ frameSize, faces, fit, mirror = false }: { frameSize: [number, number]; faces: FrameFace[]; fit: 'stretch' | 'contain'; mirror?: boolean }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${frameSize[0]} ${frameSize[1]}`}
      preserveAspectRatio={fit === 'contain' ? 'xMidYMid meet' : 'none'}
    >
      {faces.map((f) => {
        const [, y, w, h] = f.bbox;
        const x = mirror ? frameSize[0] - f.bbox[0] - w : f.bbox[0];
        const color = FACE_COLORS[f.label];
        const label = f.label === 'KNOWN' && f.personName ? f.personName : FACE_LABELS[f.label];
        const sim = f.similarity !== null && f.label !== 'LOW_QUALITY' ? ` ${f.similarity.toFixed(2)}` : '';
        const fs = Math.max(12, frameSize[0] / 55);
        return (
          <g key={f.trackId}>
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={Math.max(2, frameSize[0] / 320)} rx="4" />
            <rect x={x} y={Math.max(0, y - fs * 1.6)} width={Math.max(w, (label.length + sim.length) * fs * 0.62)} height={fs * 1.5} fill={color} opacity="0.9" rx="3" />
            <text x={x + fs * 0.3} y={Math.max(fs * 1.1, y - fs * 0.45)} fontSize={fs} fill="#05080f" fontWeight="600" fontFamily="system-ui, sans-serif">
              {label}
              {sim}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Glide each box toward the latest recognition so the outline follows the face instead of jumping. */
function useSmoothFaces(faces: FrameFace[]): FrameFace[] {
  const targetRef = useRef(faces);
  const shownRef = useRef(faces);
  const [smooth, setSmooth] = useState(faces);
  targetRef.current = faces;
  useEffect(() => {
    let raf = 0;
    let running = true;
    const step = () => {
      if (!running) return;
      const target = targetRef.current;
      const previous = new Map(shownRef.current.map((face) => [face.trackId, face]));
      let moved = shownRef.current.length !== target.length;
      const blended = target.map((face) => {
        const old = previous.get(face.trackId);
        if (!old) {
          moved = true;
          return face;
        }
        const bbox = face.bbox.map((value, index) => {
          const next = old.bbox[index] + (value - old.bbox[index]) * 0.42;
          if (Math.abs(next - value) > 0.6) moved = true;
          return next;
        }) as FrameFace['bbox'];
        if (old.label !== face.label || old.personName !== face.personName || old.similarity !== face.similarity) moved = true;
        return { ...face, bbox };
      });
      shownRef.current = blended;
      if (moved) setSmooth(blended);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);
  return smooth;
}

function jpegBlob(image: unknown): Blob | null {
  if (image instanceof Blob) return image;
  if (image instanceof ArrayBuffer) return new Blob([image], { type: 'image/jpeg' });
  if (ArrayBuffer.isView(image)) {
    const copy = new Uint8Array(image.byteLength);
    copy.set(new Uint8Array(image.buffer, image.byteOffset, image.byteLength));
    return new Blob([copy], { type: 'image/jpeg' });
  }
  if (image && typeof image === 'object' && (image as { type?: unknown }).type === 'Buffer' && Array.isArray((image as { data?: unknown }).data)) {
    return new Blob([new Uint8Array((image as { data: number[] }).data)], { type: 'image/jpeg' });
  }
  return null;
}

/** Paints the camera pixels. The canvas element is mirrored in CSS so a raised right hand stays on the right; the bitmap itself is not flipped, so recognition still sees the real image. */
function useCameraCanvas(stream: MediaStream | null, active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    video.srcObject = active ? stream : null;
    if (!active || !stream) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let raf = 0;
    let stopped = false;
    const paint = () => {
      if (stopped) return;
      if (video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(paint);
    };
    void video.play().then(() => {
      if (!stopped) paint();
    }).catch(() => undefined);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [stream, active]);
  return { videoRef, canvasRef };
}

interface PreviewFrame {
  cameraId: string;
  image?: ArrayBuffer | Uint8Array;
  faces?: FrameFace[];
  frameSize?: [number, number];
}

/** Shows the JPEG the monitoring session is already sending, without opening this device's camera. */
export function RemotePreview({
  cameras,
  fill = false,
  embedded = false,
  bare = false,
  passthrough = false,
}: {
  cameras: Camera[];
  fill?: boolean;
  embedded?: boolean;
  /** Fill the parent and leave the name to the surrounding tile. */
  bare?: boolean;
  /** Stay transparent until the first shared frame, so a local picture can show underneath. */
  passthrough?: boolean;
}) {
  const { socket } = useSocket();
  const live = cameras.filter((c) => c.monitoringEnabled);
  const [manualId, setManualId] = useState<string | null>(null);
  const camera = live.length === 1 ? live[0] : (manualId && cameras.find((c) => c.id === manualId)) || live[0] || cameras[0];
  const [hasFrame, setHasFrame] = useState(false);
  const [watching, setWatching] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seq = useRef(0);
  const matched = useRef(false);

  const [faces, setFaces] = useState<FrameFace[]>([]);
  const [frameSize, setFrameSize] = useState<[number, number] | null>(null);

  const clearFrame = useCallback(() => {
    seq.current += 1;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasFrame(false);
    setFaces([]);
    setFrameSize(null);
    matched.current = false;
  }, []);

  useEffect(() => {
    if (!socket || !camera) return;
    const cameraId = camera.id;
    let alive = true;
    const watch = () => {
      socket.emit('preview:watch', cameraId, (res: { ok?: boolean }) => {
        if (alive) setWatching(Boolean(res?.ok));
      });
    };
    const onFrame = (payload: PreviewFrame) => {
      if (!alive || payload.cameraId !== cameraId || !payload.image) return;
      const marked = Boolean(payload.faces && payload.frameSize);
      if (!marked && matched.current) return;
      const blob = jpegBlob(payload.image);
      if (!blob) return;
      const ticket = ++seq.current;
      void createImageBitmap(blob).then((bitmap) => {
        if (!alive || ticket !== seq.current) {
          bitmap.close();
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(bitmap, 0, 0);
        bitmap.close();
        setHasFrame(true);
        if (payload.faces && payload.frameSize) {
          matched.current = true;
          setFaces(payload.faces);
          setFrameSize(payload.frameSize);
        }
      }).catch(() => undefined);
    };
    const onStatus = (payload: { cameraId: string; monitoring: boolean }) => {
      if (!alive || payload.cameraId !== cameraId || payload.monitoring) return;
      clearFrame();
    };
    socket.on('camera:preview', onFrame);
    socket.on('camera:preview:status', onStatus);
    socket.on('connect', watch);
    watch();
    return () => {
      alive = false;
      socket.off('connect', watch);
      socket.off('camera:preview', onFrame);
      socket.off('camera:preview:status', onStatus);
      socket.emit('preview:unwatch', cameraId);
      clearFrame();
    };
  }, [socket, camera?.id, clearFrame]);

  useEffect(() => {
    if (!camera?.monitoringEnabled) clearFrame();
  }, [camera?.monitoringEnabled, clearFrame]);

  if (!camera) return <div className="absolute inset-0 bg-black" />;

  const waiting = !hasFrame;
  return (
    <div className={fill || bare ? `absolute inset-0 ${waiting && passthrough ? 'pointer-events-none' : 'bg-black'}` : 'relative aspect-video w-full overflow-hidden bg-black'}>
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full object-contain ${camera.cameraType === 'BROWSER' ? 'scale-x-[-1]' : ''} ${waiting ? 'invisible' : ''}`} />
      {hasFrame && frameSize && <FaceOverlay frameSize={frameSize} faces={faces} fit="contain" mirror={camera.cameraType === 'BROWSER'} />}
      {hasFrame && !bare && (
        <span className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1.5 text-sm font-semibold text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> LIVE · {camera.cameraName}
        </span>
      )}
      {waiting && !passthrough && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <CameraIcon className={embedded || bare ? 'h-8 w-8 text-ink-500' : 'h-12 w-12 text-ink-400'} />
          {!embedded && !bare && <p className="text-lg font-medium text-ink-100">{camera.cameraName}</p>}
          {!bare && (
            <p className="max-w-md text-sm text-ink-400">
              {camera.monitoringEnabled
                ? watching
                  ? 'Waiting for the live picture…'
                  : 'Connecting to the live picture…'
                : 'This screen shows the camera an administrator is monitoring. It does not use this computer’s webcam.'}
            </p>
          )}
        </div>
      )}
      {!bare && cameras.length > 1 && (
        <div className="absolute bottom-4 left-4 z-10 w-64">
          <Field label="Camera">
            <Select
              value={camera.id}
              onChange={(e) => setManualId(e.target.value)}
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cameraName} — {c.location}
                  {c.monitoringEnabled ? ' (live)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </div>
  );
}

/** Local webcam picture for one browser-camera tile. Controls live on the camera wall. */
export function BrowserStage({ camera }: { camera: Camera }) {
  const monitor = useMonitor();
  const { session, status, stream, faces, frameSize } = monitor;
  const mine = session?.cameraId === camera.id;
  const showVideo = mine && Boolean(stream) && status !== 'other-tab';
  const smoothFaces = useSmoothFaces(showVideo ? faces : []);
  const { videoRef, canvasRef } = useCameraCanvas(stream, showVideo);

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} playsInline muted className="pointer-events-none absolute h-px w-px opacity-0" />
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full scale-x-[-1] object-contain ${showVideo ? '' : 'invisible'}`} />
      {showVideo && frameSize && status === 'running' && <FaceOverlay frameSize={frameSize} faces={smoothFaces} fit="contain" mirror />}
      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-ink-500">
          <CameraIcon className="h-8 w-8" />
          {mine && status === 'other-tab' && <p className="text-xs text-ink-300">Live in another tab</p>}
          {mine && status !== 'other-tab' && status !== 'idle' && <p className="text-xs text-ink-300">Waiting for this camera…</p>}
        </div>
      )}
    </div>
  );
}

function emptyCameraCopy(role: string | undefined, siteScope: string[] | null | undefined): { title: string; body: string } {
  if (siteScope?.length) {
    return {
      title: 'No camera for this screen',
      body: `This account only sees cameras in ${siteScope.join(', ')}. None of those sites has an active browser camera.`,
    };
  }
  if (role === 'PREVIEW') {
    return {
      title: 'No camera for this screen',
      body: 'An administrator needs to add an active browser camera before this screen can show video.',
    };
  }
  return {
    title: 'No active browser cameras',
    body: 'Create a camera of type "Browser" in Camera Management to monitor using this computer\'s webcam.',
  };
}

export function BrowserMonitor({
  cameras,
  onCameraChange,
  variant = 'default',
}: {
  cameras: Camera[];
  onCameraChange: (c: Camera) => void;
  variant?: 'default' | 'kiosk' | 'tile';
}) {
  const { can, user } = useAuth();
  const kiosk = variant === 'kiosk';
  const tile = variant === 'tile';
  const notify = useToast();
  const monitor = useMonitor();
  const { session, status, stream, faces, frameSize, stats } = monitor;
  const smoothFaces = useSmoothFaces(faces);
  const browserCams = cameras.filter((c) => c.cameraType === 'BROWSER' && c.isActive);
  const [cameraId, setCameraId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const active = Boolean(session);
  const showVideo = active && Boolean(stream) && status !== 'other-tab';
  const { videoRef, canvasRef } = useCameraCanvas(stream, showVideo);
  const selectedId = session?.cameraId ?? cameraId;
  const camera = browserCams.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!cameraId && browserCams.length) setCameraId(browserCams[0].id);
  }, [browserCams, cameraId]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    setDevices(list);
  }, []);
  useEffect(() => void refreshDevices(), [refreshDevices, stream]);

  async function start() {
    if (!camera) return;
    setStartError(null);
    try {
      onCameraChange(await monitor.start(camera, deviceId));
    } catch (err) {
      setStartError(errorMessage(err));
      notify('error', 'Could not start monitoring', errorMessage(err));
    }
  }

  const empty = emptyCameraCopy(user?.role, user?.siteScope);

  if (kiosk) {
    if (!browserCams.length) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-black p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <CameraIcon className="h-8 w-8 text-ink-400" />
            <p className="text-sm text-ink-200">{empty.title}</p>
            <p className="max-w-sm text-xs text-ink-400">{empty.body}</p>
          </div>
        </div>
      );
    }
    return <RemotePreview cameras={browserCams} fill />;
  }

  if (!can('cameras:monitor') && !active) {
    return <p className="p-5 text-sm text-ink-400">Your role can view camera status but cannot stream from this device.</p>;
  }

  if (!browserCams.length && !active) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-center">
        <CameraIcon className="h-8 w-8 text-ink-400" />
        <p className="text-sm text-ink-200">{empty.title}</p>
        <p className="max-w-sm text-xs text-ink-400">{empty.body}</p>
      </div>
    );
  }

  const pill = PILL[status];
  const problem = active ? monitor.error : (startError ?? monitor.notice);
  const waitingText = status === 'other-tab' ? 'Monitoring is running in another tab on this device' : active ? 'Waiting for the camera…' : 'Camera preview appears here';

  return (
    <div className={tile ? 'space-y-3 p-4' : 'space-y-4 p-5'}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field label="Camera record">
            <Select value={selectedId} onChange={(e) => setCameraId(e.target.value)} disabled={active}>
              {session && !camera && <option value={session.cameraId}>{session.cameraName}</option>}
              {browserCams.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cameraName} — {c.location}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[200px] flex-1">
          <Field label="Video device">
            <Select value={session?.deviceId ?? deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={active}>
              <option value="">Default camera</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {active ? (
          <Button variant="danger" icon={<CircleStop className="h-4 w-4" />} loading={monitor.stopping} onClick={() => void monitor.stop()}>
            Stop
          </Button>
        ) : (
          <Button icon={<Play className="h-4 w-4" />} loading={status === 'starting'} onClick={() => void start()} disabled={!camera}>
            Start monitoring
          </Button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-black">
        <video ref={videoRef} playsInline muted className="pointer-events-none absolute h-px w-px opacity-0" />
        <canvas ref={canvasRef} className={`block h-auto max-h-[70vh] w-full scale-x-[-1] object-contain ${showVideo ? '' : 'hidden'}`} />
        {showVideo && frameSize && status === 'running' && <FaceOverlay frameSize={frameSize} faces={smoothFaces} fit="stretch" mirror />}
        {!showVideo && (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 text-center text-ink-400">
            <CameraIcon className="h-10 w-10" />
            <p className="text-sm">{waitingText}</p>
          </div>
        )}
        {showVideo && pill && (
          <span className={`absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${pill.className}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {pill.text}
            {status === 'running' && ` · ${stats.fps ? stats.fps.toFixed(1) : '—'} / ${session?.samplingFps} fps`}
          </span>
        )}
      </div>

      {problem && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <TriangleAlert className="h-4 w-4 shrink-0" /> <span className="flex-1">{problem}</span>
          {status === 'camera-unavailable' && (
            <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={monitor.resume}>
              Resume
            </Button>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="blue">
          <Activity className="h-3 w-3" /> Sent {stats.sent}
        </Badge>
        <Badge tone="green">Processed {stats.processed}</Badge>
        <Badge>Skipped (busy) {stats.dropped}</Badge>
        {stats.failed > 0 && <Badge tone="red">Failed {stats.failed}</Badge>}
        <Badge>Latency {stats.latencyMs ? `${Math.round(stats.latencyMs)} ms` : '—'}</Badge>
        <Badge>Faces {faces.length}</Badge>
        <AlertSoundToggle withLabel className="ml-auto py-1" />
      </div>
      {!tile && (
        <p className="text-xs text-ink-400">
          Once started, monitoring keeps running on this device — through sign-out, session expiry, page changes and network drops — until Stop is pressed, and resumes automatically if the page is reloaded. Frames are analysed on the server and are not stored; only confirmed events are recorded with an encrypted face close-up and full photo. Keep this browser open; closing it pauses monitoring until it is reopened.
        </p>
      )}
    </div>
  );
}

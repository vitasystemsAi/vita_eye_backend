'use client';

import { Camera, CameraOff, ImagePlus, Maximize2, SwitchCamera, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Tabs } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useMonitor } from '@/lib/monitor';
import { assessCanvasGuide, assessImage, estimateGuideYaw, guideCrop, guideSignature, signatureMotion, type LocalQuality } from '@/lib/imageQuality';

export interface CapturedImage {
  id: string;
  file: File;
  url: string;
  quality: LocalQuality | null;
  source: 'camera' | 'upload';
  /** Front-camera shots are shown mirrored so the thumbnail matches the live preview. */
  mirror?: boolean;
}

const MAX_IMAGES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

type PoseId = 'straight' | 'left' | 'right' | 'up' | 'down';

const POSES: Array<{ id: PoseId; title: string; hint: string }> = [
  { id: 'straight', title: '1 · Look straight', hint: 'Eyes on the line, face filling the guide' },
  { id: 'left', title: '2 · Turn left', hint: 'Turn your head a little to your left. Both eyes stay visible' },
  { id: 'right', title: '3 · Turn right', hint: 'Turn your head a little to your right. Both eyes stay visible' },
  { id: 'up', title: '4 · Chin slightly up', hint: 'Lift your chin a little and look into the guide' },
  { id: 'down', title: '5 · Chin slightly down', hint: 'Lower your chin a little. Both eyes stay visible' },
];

const AUTO_SHOTS = POSES.length;
const STILL_MAX = 9;
const HOLD_MS = 700;
const COUNT_MS = 900;
const COOLDOWN_MS = 1600;
const POSE_FRESH_MS = 1800;
const POSE_MATCHED_FRESH_MS = 2800;
/** Pose-guide hits the AI service — poll only when the local frame is already clean. */
const POSE_POLL_MS = 750;
const CAMERA_RETRY_DELAYS_MS = [0, 450, 900];

type AutoPhase = { kind: 'align'; text: string } | { kind: 'hold'; progress: number } | { kind: 'count'; n: number } | { kind: 'saved' } | { kind: 'done' };

type Facing = 'user' | 'environment';

const VIDEO_SIZE: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };

type StageLayout = {
  canvasLeft: number;
  canvasTop: number;
  canvasW: number;
  canvasH: number;
  guideLeft: number;
  guideTop: number;
  guideW: number;
  guideH: number;
};

/** Scale the live frame so the enrollment guide fills the stage. The guide stays the same crop the photo is saved from. */
function fitGuide(videoW: number, videoH: number, boxW: number, boxH: number, topInset: number, bottomInset: number): StageLayout {
  const { sw, sh } = guideCrop(videoW, videoH);
  const side = 8;
  const availW = Math.max(48, boxW - side * 2);
  const availH = Math.max(48, boxH - topInset - bottomInset);
  const scale = Math.min(availW / sw, availH / sh);
  const guideW = sw * scale;
  const guideH = sh * scale;
  const canvasW = videoW * scale;
  const canvasH = videoH * scale;
  const cx = boxW / 2;
  const cy = topInset + availH / 2;
  return {
    canvasLeft: cx - canvasW / 2,
    canvasTop: cy - canvasH / 2,
    canvasW,
    canvasH,
    guideLeft: cx - guideW / 2,
    guideTop: cy - guideH / 2,
    guideW,
    guideH,
  };
}

function sameLayout(a: StageLayout, b: StageLayout) {
  return (
    Math.abs(a.canvasW - b.canvasW) < 0.5 &&
    Math.abs(a.canvasH - b.canvasH) < 0.5 &&
    Math.abs(a.canvasLeft - b.canvasLeft) < 0.5 &&
    Math.abs(a.canvasTop - b.canvasTop) < 0.5 &&
    Math.abs(a.guideW - b.guideW) < 0.5 &&
    Math.abs(a.guideH - b.guideH) < 0.5
  );
}

function cameraErrorMessage(err: unknown, switching = false): string {
  const name = (err as DOMException).name;
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in the browser settings.';
  if (name === 'NotFoundError') return switching ? 'Only one camera is available on this device.' : 'No camera was found on this device.';
  if (name === 'NotReadableError') {
    return switching
      ? 'Could not switch camera — another app may still be using it. Close WhatsApp/Instagram/video calls and other browser tabs, wait a moment, then try again.'
      : 'This phone’s camera is still held by another app or browser tab. Close that, wait a second, then tap Start camera again — or upload photos instead.';
  }
  return switching ? `Could not switch camera: ${(err as Error).message}` : `Camera unavailable: ${(err as Error).message}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function openVideo(constraints: MediaTrackConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { ...VIDEO_SIZE, ...constraints }, audio: false });
}

function isCameraBusy(err: unknown): boolean {
  const name = (err as DOMException).name;
  return name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError';
}

/** Local turn check so we do not upload pose frames when the head is clearly on the wrong side. */
function localPoseHint(target: PoseId, canvas: HTMLCanvasElement, mirrored: boolean): { ok: boolean; nudge: string } | null {
  if (target === 'up' || target === 'down') return null;
  const raw = estimateGuideYaw(canvas);
  if (raw == null) return null;
  // Preview is mirrored for the front camera; flip so "your left" matches the on-screen command.
  const yaw = mirrored ? -raw : raw;
  if (target === 'straight') {
    if (Math.abs(yaw) > 0.18) return { ok: false, nudge: yaw < 0 ? 'Look straight — turn a little to your right' : 'Look straight — turn a little to your left' };
    return { ok: true, nudge: 'Hold still' };
  }
  if (target === 'left') {
    if (yaw > -0.06) return { ok: false, nudge: 'Turn your head a little to your left' };
    return { ok: true, nudge: 'Hold still' };
  }
  if (target === 'right') {
    if (yaw < 0.06) return { ok: false, nudge: 'Turn your head a little to your right' };
    return { ok: true, nudge: 'Hold still' };
  }
  return null;
}

function denied(err: unknown): boolean {
  const name = (err as DOMException).name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

/** Front cameras are mirrored in the preview. A reported facing mode wins; otherwise the requested side is used. */
function mirrorFor(stream: MediaStream, requested: Facing): boolean {
  const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (reported === 'environment') return false;
  if (reported === 'user') return true;
  const label = stream.getVideoTracks()[0]?.label ?? '';
  if (/back|rear|environment/i.test(label)) return false;
  if (/front|user|face/i.test(label)) return true;
  return requested === 'user';
}

async function acquireCameraOnce(facing: Facing, previousId?: string): Promise<MediaStream> {
  if (!previousId) {
    try {
      return await openVideo({ facingMode: { ideal: facing } });
    } catch (err) {
      if (denied(err)) throw err;
      return openVideo({});
    }
  }

  try {
    const exact = await openVideo({ facingMode: { exact: facing } });
    const id = exact.getVideoTracks()[0]?.getSettings().deviceId;
    if (!id || id !== previousId) return exact;
    exact.getTracks().forEach((track) => track.stop());
  } catch (err) {
    if (denied(err)) throw err;
  }

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput' && device.deviceId && device.deviceId !== previousId);
  if (!devices.length) throw new DOMException('Only one camera is available on this device.', 'NotFoundError');
  const hint = facing === 'environment' ? /back|rear|environment/i : /front|user|face/i;
  const preferred = devices.find((device) => hint.test(device.label)) ?? devices[0];
  return openVideo({ deviceId: { exact: preferred.deviceId } });
}

/** Retry when Android/browser still holds the camera after another app closed. */
async function acquireCamera(facing: Facing, previousId?: string): Promise<MediaStream> {
  let lastErr: unknown;
  for (const delay of CAMERA_RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      return await acquireCameraOnce(facing, previousId);
    } catch (err) {
      lastErr = err;
      if (denied(err) || !isCameraBusy(err)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new DOMException('The camera is in use by another app. Close it and try again.', 'NotReadableError');
}

interface PoseReading {
  target: PoseId;
  matched: boolean;
  nudge: string;
  at: number;
}

function guideJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const { sx, sy, sw, sh } = guideCrop(canvas.width, canvas.height);
  const scale = Math.min(1, 480 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
}

export function FaceCapture({ images, onChange }: { images: CapturedImage[]; onChange: (imgs: CapturedImage[]) => void }) {
  const { releaseDeviceCamera, restoreDeviceCamera } = useMonitor();
  const cameraHeld = useRef(false);
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [switching, setSwitching] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [live, setLive] = useState<LocalQuality | null>(null);
  const [phase, setPhase] = useState<AutoPhase>({ kind: 'align', text: 'Align your face' });
  const [mobile, setMobile] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [layout, setLayout] = useState<StageLayout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef(images);
  const layoutBoxRef = useRef({ w: 0, h: 0 });
  const bottomInsetRef = useRef(4);
  const immersiveRef = useRef(false);
  const layoutReadyRef = useRef(false);
  const publishLayoutRef = useRef(() => {});
  const shootRef = useRef<() => boolean>(() => false);
  const pauseUntilRef = useRef(0);
  const inflightRef = useRef(false);
  const poseRef = useRef<PoseReading | null>(null);
  const facingRef = useRef<Facing>('user');
  const switchingRef = useRef(false);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const stopCamera = useCallback(() => {
    setLive(null);
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    if (cameraHeld.current) {
      cameraHeld.current = false;
      restoreDeviceCamera();
    }
  }, [restoreDeviceCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    video.srcObject = stream;
    if (!stream) return;
    let raf = 0;
    let stopped = false;
    let lastCheck = 0;
    let stableSince = 0;
    let cooldownUntil = 0;
    let previous: Float32Array | null = null;
    let shown = '';
    let shownLive = '';
    const publish = (next: AutoPhase) => {
      const key = next.kind === 'hold' ? `hold:${Math.round(next.progress * 20)}` : next.kind === 'align' ? `align:${next.text}` : next.kind === 'count' ? `count:${next.n}` : next.kind;
      if (key === shown) return;
      shown = key;
      setPhase(next);
    };
    const paint = () => {
      if (stopped) return;
        if (video.videoWidth > 0) {
        const resized = canvas.width !== video.videoWidth || canvas.height !== video.videoHeight;
        if (resized) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        if (resized || !layoutReadyRef.current) {
          layoutReadyRef.current = true;
          publishLayoutRef.current();
        }
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const now = performance.now();
        if (now - lastCheck > 120) {
          lastCheck = now;
          const quality = assessCanvasGuide(canvas);
          const liveKey = quality ? quality.warnings.join('|') || 'ok' : 'none';
          if (liveKey !== shownLive) {
            shownLive = liveKey;
            setLive(quality);
          }
          const signature = guideSignature(canvas);
          const motion = previous && signature ? signatureMotion(previous, signature) : 0;
          if (signature) previous = signature;
          const taken = imagesRef.current.length;
          const clear = Boolean(quality && quality.warnings.length === 0);
          const still = motion <= STILL_MAX;
          const reading = poseRef.current;
          const commanded = POSES[Math.min(taken, POSES.length - 1)].id;
          const freshWindow = reading?.matched ? POSE_MATCHED_FRESH_MS : POSE_FRESH_MS;
          const poseFresh = Boolean(reading && reading.target === commanded && now - reading.at < freshWindow);
          const localHint = clear ? localPoseHint(commanded, canvas, facingRef.current === 'user') : null;
          if (taken >= AUTO_SHOTS) {
            stableSince = 0;
            publish({ kind: 'done' });
          } else if (now < cooldownUntil || now < pauseUntilRef.current || inflightRef.current) {
            stableSince = 0;
            publish({ kind: 'saved' });
          } else if (!clear) {
            stableSince = 0;
            publish({ kind: 'align', text: quality?.warnings[0] ?? 'Checking…' });
          } else if (localHint && !localHint.ok) {
            stableSince = 0;
            publish({ kind: 'align', text: localHint.nudge });
          } else if (!poseFresh || !reading) {
            stableSince = 0;
            publish({ kind: 'align', text: 'Checking the turn…' });
          } else if (!reading.matched) {
            stableSince = 0;
            publish({ kind: 'align', text: reading.nudge });
          } else if (!still) {
            stableSince = 0;
            publish({ kind: 'align', text: 'Hold still' });
          } else {
            if (!stableSince) stableSince = now;
            const held = now - stableSince;
            if (held < HOLD_MS) publish({ kind: 'hold', progress: held / HOLD_MS });
            else if (held < HOLD_MS + COUNT_MS) publish({ kind: 'count', n: 3 - Math.min(2, Math.floor((held - HOLD_MS) / (COUNT_MS / 3))) });
            else if (shootRef.current()) {
              cooldownUntil = now + COOLDOWN_MS;
              stableSince = 0;
              previous = null;
              publish({ kind: 'saved' });
            } else {
              stableSince = 0;
              publish({ kind: 'align', text: 'Hold still' });
            }
          }
        }
      }
      raf = requestAnimationFrame(paint);
    };
    void video.play().then(() => {
      if (!stopped) paint();
    }).catch(() => undefined);
    return () => {
      stopped = true;
      layoutReadyRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [stream, immersive, mobile]);

  useEffect(() => {
    if (!stream) {
      poseRef.current = null;
      return;
    }
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy || imagesRef.current.length >= AUTO_SHOTS) return;
      if (performance.now() < pauseUntilRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas?.width) return;
      const quality = assessCanvasGuide(canvas);
      if (!quality || quality.warnings.length) return;
      const target = POSES[Math.min(imagesRef.current.length, POSES.length - 1)].id;
      const localHint = localPoseHint(target, canvas, facingRef.current === 'user');
      if (localHint && !localHint.ok) {
        poseRef.current = { target, matched: false, nudge: localHint.nudge, at: performance.now() };
        return;
      }
      const existing = poseRef.current;
      if (existing && existing.target === target && existing.matched && performance.now() - existing.at < POSE_MATCHED_FRESH_MS) return;
      busy = true;
      try {
        const blob = await guideJpeg(canvas);
        if (!blob || stopped) return;
        const form = new FormData();
        form.append('image', blob, 'pose.jpg');
        form.append('target', target);
        const { data } = await api.post<{ matched: boolean; nudge: string }>('/persons/pose-guide', form);
        if (!stopped) poseRef.current = { target, matched: data.matched, nudge: data.nudge, at: performance.now() };
      } catch {
        // Prefer local readiness over blocking enroll when the pose service is down.
        if (!stopped) poseRef.current = { target, matched: Boolean(localHint?.ok ?? target === 'straight'), nudge: localHint?.ok || target === 'straight' ? 'Hold still' : 'Pose check unavailable — use Capture now', at: performance.now() };
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), POSE_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [stream]);

  useEffect(() => {
    if (mode !== 'camera') stopCamera();
  }, [mode, stopCamera]);

  const fullscreen = mobile && mode === 'camera' && immersive;
  immersiveRef.current = fullscreen;
  bottomInsetRef.current = fullscreen ? (images.length ? 248 : 180) : 48;

  const publishLayout = useCallback(() => {
    const video = videoRef.current;
    const vw = video?.videoWidth ?? 0;
    const vh = video?.videoHeight ?? 0;
    const { w: bw, h: bh } = layoutBoxRef.current;
    if (vw < 2 || vh < 2 || bw < 2 || bh < 2) return;
    const top = immersiveRef.current ? 100 : 48;
    const next = fitGuide(vw, vh, bw, bh, top, bottomInsetRef.current);
    setLayout((prev) => (prev && sameLayout(prev, next) ? prev : next));
  }, []);
  publishLayoutRef.current = publishLayout;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      const next = mq.matches;
      setMobile(next);
      if (next) setImmersive(true);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!stream) setLayout(null);
  }, [stream]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || mode !== 'camera') return;
    const readBox = () => {
      if (immersiveRef.current && window.visualViewport) {
        const vv = window.visualViewport;
        layoutBoxRef.current = { w: vv.width, h: vv.height };
        el.style.height = `${vv.height}px`;
        el.style.width = `${vv.width}px`;
        el.style.top = `${vv.offsetTop}px`;
        el.style.left = `${vv.offsetLeft}px`;
      } else {
        el.style.height = '';
        el.style.width = '';
        el.style.top = '';
        el.style.left = '';
        const rect = el.getBoundingClientRect();
        layoutBoxRef.current = { w: rect.width, h: rect.height };
      }
      publishLayout();
    };
    readBox();
    const ro = new ResizeObserver(readBox);
    ro.observe(el);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', readBox);
    vv?.addEventListener('scroll', readBox);
    return () => {
      ro.disconnect();
      vv?.removeEventListener('resize', readBox);
      vv?.removeEventListener('scroll', readBox);
    };
  }, [mode, fullscreen, stream, publishLayout]);

  useEffect(() => {
    publishLayout();
  }, [images.length, fullscreen, publishLayout]);

  function applyStream(nextStream: MediaStream, requested: Facing) {
    const mirror = mirrorFor(nextStream, requested);
    const actual: Facing = mirror ? 'user' : 'environment';
    facingRef.current = actual;
    setFacing(actual);
    setStream((current) => {
      if (current && current !== nextStream) current.getTracks().forEach((track) => track.stop());
      return nextStream;
    });
  }

  async function startCamera() {
    if (starting || switchingRef.current) return;
    setStarting(true);
    setCamError(null);
    setFileError(null);
    setLive(null);
    setPhase({ kind: 'align', text: 'Align your face' });
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('This browser cannot access cameras. Use HTTPS (or localhost) and a modern browser, or upload photos instead.');
      setStarting(false);
      return;
    }
    // Let go of this phone's live-monitoring camera first. Face enrollment uses its own capture.
    setLive(null);
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
    if (!cameraHeld.current) {
      await releaseDeviceCamera();
      cameraHeld.current = true;
    }
    await sleep(200);
    try {
      applyStream(await acquireCamera(facingRef.current), facingRef.current);
    } catch (err) {
      if (cameraHeld.current) {
        cameraHeld.current = false;
        restoreDeviceCamera();
      }
      setCamError(cameraErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  async function switchCamera() {
    if (switchingRef.current || starting) return;
    const next: Facing = facingRef.current === 'user' ? 'environment' : 'user';
    const previousId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const previousFacing = facingRef.current;
    switchingRef.current = true;
    setSwitching(true);
    setFileError(null);
    pauseUntilRef.current = performance.now() + 2000;
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    await sleep(400);
    try {
      applyStream(await acquireCamera(next, previousId), next);
      setLive(null);
      setPhase({ kind: 'align', text: 'Align your face' });
    } catch (err) {
      try {
        applyStream(await acquireCamera(previousFacing), previousFacing);
      } catch {
        setStream(null);
      }
      setFileError(cameraErrorMessage(err, true));
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  }

  async function add(file: File, source: CapturedImage['source'], mirror = false) {
    const url = URL.createObjectURL(file);
    const img: CapturedImage = { id: crypto.randomUUID(), file, url, quality: null, source, mirror };
    const next = [...imagesRef.current, img].slice(0, MAX_IMAGES);
    imagesRef.current = next;
    onChange(next);
    const quality = await assessImage(file).catch(() => null);
    if (!imagesRef.current.some((i) => i.id === img.id)) {
      URL.revokeObjectURL(url);
      return;
    }
    const updated = imagesRef.current.map((i) => (i.id === img.id ? { ...i, quality } : i));
    imagesRef.current = updated;
    onChange(updated);
  }

  shootRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas?.width || inflightRef.current || imagesRef.current.length >= MAX_IMAGES) return false;
    const current = assessCanvasGuide(canvas);
    setLive(current);
    if (current?.warnings.length) return false;
    const { sx, sy, sw, sh } = guideCrop(canvas.width, canvas.height);
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const pose = POSES[Math.min(imagesRef.current.length, POSES.length - 1)].title;
    const mirror = facingRef.current === 'user';
    inflightRef.current = true;
    out.toBlob((blob) => {
      inflightRef.current = false;
      if (blob) void add(new File([blob], `capture-${pose.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'camera', mirror);
    }, 'image/jpeg', 0.95);
    return true;
  };

  function capture() {
    setFileError(null);
    if (!shootRef.current()) {
      const current = live;
      setFileError(current?.warnings[0] ? `${current.warnings[0]}. Hold still in even light with the face inside the guide.` : 'Hold still with your face inside the guide, then try again.');
    } else {
      pauseUntilRef.current = performance.now() + COOLDOWN_MS;
    }
  }

  async function onFiles(list: FileList | null) {
    setFileError(null);
    if (!list) return;
    for (const f of Array.from(list)) {
      if (imagesRef.current.length >= MAX_IMAGES) {
        setFileError(`At most ${MAX_IMAGES} images per enrollment.`);
        break;
      }
      if (!ACCEPT.includes(f.type)) {
        setFileError(`${f.name}: use JPEG, PNG or WebP.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setFileError(`${f.name}: larger than 5 MB.`);
        continue;
      }
      await add(f, 'upload');
    }
  }

  function remove(id: string) {
    const img = imagesRef.current.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.url);
    const next = imagesRef.current.filter((i) => i.id !== id);
    imagesRef.current = next;
    onChange(next);
  }

  const full = images.length >= MAX_IMAGES;
  const pose = images.length >= AUTO_SHOTS ? { title: 'Five guided photos ready', hint: 'Enroll these photos.' } : POSES[images.length];
  const phaseLabel = phase.kind === 'done' ? '5 photos ready' : phase.kind === 'saved' ? 'Saved' : phase.kind === 'count' ? 'Capturing' : phase.kind === 'hold' ? 'Hold still' : phase.text;
  const phaseHint = phase.kind === 'done' ? 'All five guided photos are ready. You can enroll.' : phase.kind === 'saved' ? `Saved. ${pose.hint}` : phase.kind === 'count' || phase.kind === 'hold' ? 'Hold still — taking the photo' : phase.text;
  const phaseReady = phase.kind === 'hold' || phase.kind === 'count' || phase.kind === 'saved' || phase.kind === 'done';

  const stage = (
    <div
      ref={stageRef}
      className={
        fullscreen
          ? 'fixed top-0 left-0 z-[80] h-[100dvh] w-screen overflow-hidden bg-black select-none'
          : 'relative overflow-hidden rounded-xl border border-ink-700 bg-ink-950 select-none max-md:min-h-[72dvh] md:aspect-video'
      }
    >
      {stream ? (
        <>
          <video ref={videoRef} playsInline muted autoPlay className="pointer-events-none absolute h-px w-px opacity-0" />
          <canvas
            ref={canvasRef}
            className={`absolute max-w-none object-contain ${layout ? '' : 'inset-0 h-full w-full'} ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
            style={layout ? { left: layout.canvasLeft, top: layout.canvasTop, width: layout.canvasW, height: layout.canvasH } : undefined}
          />
          {layout && (
            <div className="pointer-events-none absolute" style={{ left: layout.guideLeft, top: layout.guideTop, width: layout.guideW, height: layout.guideH }}>
              <div className="absolute inset-0 rounded-[46%] border-[3px] border-brand-300/95 shadow-[0_0_0_9999px_rgba(2,6,16,0.55)]" />
              <div className="absolute inset-x-[18%] top-[40%] border-t-2 border-brand-200/95" />
              <div className="absolute top-[40%] left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200 shadow-[0_0_0_4px_rgba(147,197,253,0.35)]" />
              <span className="absolute top-[15%] left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium tracking-wide text-white uppercase">Eyes on the line</span>
              {phase.kind === 'hold' && (
                <div className="absolute inset-x-5 -top-4 h-1.5 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full bg-emerald-400" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
                </div>
              )}
              {phase.kind === 'count' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-8xl font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]">{phase.n}</span>
                </div>
              )}
            </div>
          )}
          <div className={`absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 ${fullscreen ? 'px-3 pt-[max(0.75rem,env(safe-area-inset-top))]' : 'px-2 pt-2'}`}>
            <div className="flex min-w-0 items-center gap-2">
              {fullscreen && (
                <button type="button" onClick={() => setImmersive(false)} className="shrink-0 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
                  {images.length >= AUTO_SHOTS ? 'Continue' : 'Back'}
                </button>
              )}
              <p className="min-w-0 truncate rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">{pose.title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void switchCamera()}
                disabled={switching}
                aria-label={facing === 'user' ? 'Use back camera' : 'Use front camera'}
                title={facing === 'user' ? 'Use back camera' : 'Use front camera'}
                className="rounded-full bg-black/70 p-2.5 text-white transition hover:bg-black/85 disabled:opacity-50"
              >
                <SwitchCamera className="h-5 w-5" />
              </button>
              <p className={`rounded px-2 py-1 text-xs font-medium ${phaseReady ? 'bg-emerald-500/90 text-ink-950' : 'bg-amber-500/90 text-ink-950'}`}>{phaseLabel}</p>
            </div>
          </div>
          <div className={`absolute inset-x-0 bottom-0 z-10 space-y-2 ${fullscreen ? 'bg-gradient-to-t from-black via-black/80 to-transparent px-3 pt-10 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'px-2 pb-2'}`}>
            {fullscreen && images.length > 0 && (
              <ul className="flex gap-2 overflow-x-auto">
                {images.map((img) => (
                  <li key={img.id} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-white/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className={`h-full w-full object-cover ${img.mirror ? 'scale-x-[-1]' : ''}`} />
                  </li>
                ))}
              </ul>
            )}
            <p className="rounded bg-black/70 px-2 py-1.5 text-center text-sm text-white">{phaseHint}</p>
            {fullscreen && fileError && <p className="rounded bg-red-950/80 px-2 py-1.5 text-center text-sm text-red-200">{fileError}</p>}
            {fullscreen && (
              <div className="flex gap-2">
                <Button className="min-w-0 flex-1" onClick={capture} disabled={full || switching} icon={<ImagePlus className="h-4 w-4" />}>
                  Capture ({images.length}/{MAX_IMAGES})
                </Button>
                <Button variant="secondary" onClick={stopCamera} disabled={switching} icon={<CameraOff className="h-4 w-4" />}>
                  Stop
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          {fullscreen && (
            <button type="button" onClick={() => setImmersive(false)} className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
              Back
            </button>
          )}
          <CameraOff className={fullscreen ? 'h-14 w-14 text-ink-300' : 'h-8 w-8 text-ink-400'} />
          <p className={fullscreen ? 'max-w-xs text-base text-ink-100' : 'text-sm text-ink-300'}>{starting ? 'Opening camera…' : camError ?? 'Camera is off'}</p>
          {camError && (
            <ul className={`${fullscreen ? 'max-w-xs text-sm' : 'max-w-sm text-xs'} list-disc space-y-1 pl-4 text-left text-ink-300`}>
              <li>Close WhatsApp, Instagram, video calls, and other camera apps</li>
              <li>Close other browser tabs that may be using the camera</li>
              <li>Wait a second, then tap Start camera again</li>
            </ul>
          )}
          {fullscreen && !camError && <p className="max-w-xs text-sm text-ink-300">This capture uses the full screen so the face is large enough to align and recognize.</p>}
          <Button onClick={() => void startCamera()} loading={starting} disabled={starting} icon={<Camera className="h-4 w-4" />}>
            {starting ? 'Starting…' : camError ? 'Retry camera' : 'Start camera'}
          </Button>
          {(fullscreen || camError) && (
            <button type="button" onClick={() => setMode('upload')} className="text-sm text-ink-300 underline-offset-2 hover:underline">
              Upload photos instead
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {!fullscreen && (
        <Tabs
          value={mode}
          onChange={setMode}
          tabs={[
            { value: 'camera', label: 'Capture from camera' },
            { value: 'upload', label: 'Upload photos' },
          ]}
        />
      )}
      {mode === 'camera' ? (
        fullscreen ? (
          createPortal(stage, document.body)
        ) : (
        <div className="space-y-3">
          {stage}
          {mobile && (
            <Button variant="secondary" onClick={() => setImmersive(true)} icon={<Maximize2 className="h-4 w-4" />}>
              Full screen
            </Button>
          )}
          {stream && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button onClick={capture} disabled={full || switching} icon={<ImagePlus className="h-4 w-4" />}>
                  Capture now ({images.length}/{MAX_IMAGES})
                </Button>
                <Button variant="secondary" onClick={() => void switchCamera()} disabled={switching} icon={<SwitchCamera className="h-4 w-4" />}>
                  {switching ? 'Switching…' : facing === 'user' ? 'Use back camera' : 'Use front camera'}
                </Button>
                <Button variant="secondary" onClick={stopCamera} disabled={switching} icon={<CameraOff className="h-4 w-4" />}>
                  Stop camera
                </Button>
              </div>
              <p className="text-xs text-ink-400">On a phone, use the back camera for a sharper enrollment photo. {facing === 'user' ? 'This preview is the front camera.' : 'This preview is the back camera.'}</p>
            </div>
          )}
        </div>
        )
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-600 bg-ink-850/50 px-6 py-10 text-center transition hover:border-brand-500/60">
          <Upload className="h-7 w-7 text-ink-300" />
          <span className="text-sm text-ink-200">Click to choose photos</span>
          <span className="text-xs text-ink-400">JPEG, PNG or WebP · up to 5 MB each · max {MAX_IMAGES} images · one face, eyes level, no one else in the photo</span>
          <input type="file" className="hidden" accept={ACCEPT.join(',')} multiple disabled={full} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        </label>
      )}
      {fileError && <p className="text-sm text-red-300">{fileError}</p>}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((img) => (
            <li key={img.id} className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="Enrollment sample" className={`aspect-square w-full object-cover ${img.mirror ? 'scale-x-[-1]' : ''}`} />
              <button onClick={() => remove(img.id)} className="absolute top-1.5 right-1.5 rounded-md bg-black/70 p-1.5 text-ink-100 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100" aria-label="Remove image">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <div className="space-y-1 p-2">
                {img.quality ? (
                  img.quality.warnings.length ? (
                    img.quality.warnings.map((w) => (
                      <Badge key={w} tone="amber">
                        {w}
                      </Badge>
                    ))
                  ) : (
                    <Badge tone="green">Pre-check OK</Badge>
                  )
                ) : (
                  <Badge>Unchecked</Badge>
                )}
                {img.quality && (
                  <p className="text-[10px] text-ink-400">
                    {img.quality.width}×{img.quality.height}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-400">Fill the oval in even light, eyes on the line. The phone pre-checks blur, brightness, and fill before asking the server for a pose check — this keeps enrollment sharper and reduces server load. Photos auto-capture for straight, left, right, chin up, then chin down. Only encrypted templates are stored.</p>
    </div>
  );
}

'use client';

import { Camera, CameraOff, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Tabs } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { assessCanvasGuide, assessImage, guideCrop, guideSignature, signatureMotion, type LocalQuality } from '@/lib/imageQuality';

export interface CapturedImage {
  id: string;
  file: File;
  url: string;
  quality: LocalQuality | null;
  source: 'camera' | 'upload';
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
const STILL_MAX = 11;
const HOLD_MS = 600;
const COUNT_MS = 900;
const COOLDOWN_MS = 1600;
const POSE_FRESH_MS = 1200;

type AutoPhase = { kind: 'align'; text: string } | { kind: 'hold'; progress: number } | { kind: 'count'; n: number } | { kind: 'saved' } | { kind: 'done' };

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
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [live, setLive] = useState<LocalQuality | null>(null);
  const [phase, setPhase] = useState<AutoPhase>({ kind: 'align', text: 'Align your face' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef(images);
  const shootRef = useRef<() => boolean>(() => false);
  const pauseUntilRef = useRef(0);
  const inflightRef = useRef(false);
  const poseRef = useRef<PoseReading | null>(null);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const stopCamera = useCallback(() => {
    setLive(null);
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

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
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
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
          const poseFresh = Boolean(reading && reading.target === commanded && now - reading.at < POSE_FRESH_MS);
          if (taken >= AUTO_SHOTS) {
            stableSince = 0;
            publish({ kind: 'done' });
          } else if (now < cooldownUntil || now < pauseUntilRef.current || inflightRef.current) {
            stableSince = 0;
            publish({ kind: 'saved' });
          } else if (!clear) {
            stableSince = 0;
            publish({ kind: 'align', text: quality?.warnings[0] ?? 'Checking…' });
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
      cancelAnimationFrame(raf);
    };
  }, [stream]);

  useEffect(() => {
    if (!stream) {
      poseRef.current = null;
      return;
    }
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy || imagesRef.current.length >= AUTO_SHOTS) return;
      const canvas = canvasRef.current;
      if (!canvas?.width) return;
      busy = true;
      const target = POSES[Math.min(imagesRef.current.length, POSES.length - 1)].id;
      try {
        const blob = await guideJpeg(canvas);
        if (!blob || stopped) return;
        const form = new FormData();
        form.append('image', blob, 'pose.jpg');
        form.append('target', target);
        const { data } = await api.post<{ matched: boolean; nudge: string }>('/persons/pose-guide', form);
        if (!stopped) poseRef.current = { target, matched: data.matched, nudge: data.nudge, at: performance.now() };
      } catch {
        if (!stopped) poseRef.current = { target, matched: false, nudge: 'Pose check unavailable — use Capture now', at: performance.now() };
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), 380);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [stream]);

  useEffect(() => {
    if (mode !== 'camera') stopCamera();
  }, [mode, stopCamera]);

  async function startCamera() {
    setCamError(null);
    setLive(null);
    setPhase({ kind: 'align', text: 'Align your face' });
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('This browser cannot access cameras. Use HTTPS (or localhost) and a modern browser, or upload photos instead.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      setStream(s);
    } catch (err) {
      const name = (err as DOMException).name;
      setCamError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser settings.' : name === 'NotFoundError' ? 'No camera was found on this device.' : `Camera unavailable: ${(err as Error).message}`);
    }
  }

  async function add(file: File, source: CapturedImage['source']) {
    const url = URL.createObjectURL(file);
    const img: CapturedImage = { id: crypto.randomUUID(), file, url, quality: null, source };
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
    inflightRef.current = true;
    out.toBlob((blob) => {
      inflightRef.current = false;
      if (blob) void add(new File([blob], `capture-${pose.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'camera');
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

  return (
    <div className="space-y-4">
      <Tabs
        value={mode}
        onChange={setMode}
        tabs={[
          { value: 'camera', label: 'Capture from camera' },
          { value: 'upload', label: 'Upload photos' },
        ]}
      />
      {mode === 'camera' ? (
        <div className="space-y-3">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-ink-700 bg-ink-950">
            {stream ? (
              <>
                <video ref={videoRef} playsInline muted className="pointer-events-none absolute h-px w-px opacity-0" />
                <canvas ref={canvasRef} className="h-full w-full scale-x-[-1] object-contain" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-[78%] aspect-[3/4]">
                    <div className="absolute inset-0 rounded-[46%] border-2 border-brand-300/90 shadow-[0_0_0_9999px_rgba(2,6,16,0.45)]" />
                    <div className="absolute inset-x-[18%] top-[40%] border-t border-brand-200/90" />
                    <div className="absolute top-[40%] left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200" />
                    <span className="absolute top-[18%] left-1/2 -translate-x-1/2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] tracking-wide text-white uppercase">Eyes on the line</span>
                  </div>
                </div>
                <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
                  <p className="rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">{pose.title}</p>
                  <p className={`rounded px-2 py-1 text-xs font-medium ${phase.kind === 'hold' || phase.kind === 'count' || phase.kind === 'saved' || phase.kind === 'done' ? 'bg-emerald-500/90 text-ink-950' : 'bg-amber-500/90 text-ink-950'}`}>
                    {phase.kind === 'done' ? '5 photos ready' : phase.kind === 'saved' ? 'Saved' : phase.kind === 'count' ? 'Capturing' : phase.kind === 'hold' ? 'Hold still' : phase.text}
                  </p>
                </div>
                {phase.kind === 'hold' && (
                  <div className="absolute inset-x-16 top-12 h-1 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
                  </div>
                )}
                {phase.kind === 'count' && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="text-7xl font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">{phase.n}</span>
                  </div>
                )}
                <p className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 text-center text-xs text-white">
                  {phase.kind === 'done' ? 'All five guided photos are ready. You can enroll.' : phase.kind === 'saved' ? `Saved. ${pose.hint}` : phase.kind === 'count' || phase.kind === 'hold' ? 'Hold still — taking the photo' : phase.text}
                </p>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <CameraOff className="h-8 w-8 text-ink-400" />
                <p className="text-sm text-ink-300">{camError ?? 'Camera is off'}</p>
                <Button onClick={() => void startCamera()} icon={<Camera className="h-4 w-4" />}>
                  Start camera
                </Button>
              </div>
            )}
          </div>
          {stream && (
            <div className="flex gap-2">
              <Button onClick={capture} disabled={full} icon={<ImagePlus className="h-4 w-4" />}>
                Capture now ({images.length}/{MAX_IMAGES})
              </Button>
              <Button variant="secondary" onClick={stopCamera} icon={<CameraOff className="h-4 w-4" />}>
                Stop camera
              </Button>
            </div>
          )}
        </div>
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
              <img src={img.url} alt="Enrollment sample" className={`aspect-square w-full object-cover ${img.source === 'camera' ? 'scale-x-[-1]' : ''}`} />
              <button onClick={() => remove(img.id)} className="absolute top-1.5 right-1.5 rounded-md bg-black/70 p-1.5 text-ink-100 opacity-0 transition group-hover:opacity-100 focus:opacity-100" aria-label="Remove image">
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
      <p className="text-xs text-ink-400">Follow the five commands: straight, left, right, chin up, then chin down. The camera takes each photo only when the face matches that command and holds still. The saved photo is only the area inside the guide. Photos of different people, a second face, blur, tilt, or a poor match to someone already enrolled are rejected. Only encrypted templates are stored.</p>
    </div>
  );
}

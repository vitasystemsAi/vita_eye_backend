'use client';

import { Camera, CameraOff, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Tabs } from '@/components/ui/primitives';
import { assessImage, type LocalQuality } from '@/lib/imageQuality';

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

export function FaceCapture({ images, onChange }: { images: CapturedImage[]; onChange: (imgs: CapturedImage[]) => void }) {
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const stopCamera = useCallback(() => {
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
  }, [stream]);
  useEffect(() => {
    if (mode !== 'camera') stopCamera();
  }, [mode, stopCamera]);

  async function startCamera() {
    setCamError(null);
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
    const quality = await assessImage(file).catch(() => null);
    const img: CapturedImage = { id: crypto.randomUUID(), file, url, quality, source };
    onChange([...imagesRef.current, img].slice(0, MAX_IMAGES));
  }

  function capture() {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    canvas.toBlob((blob) => blob && void add(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }), 'camera'), 'image/jpeg', 0.92);
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
    const img = images.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.url);
    onChange(images.filter((i) => i.id !== id));
  }

  const full = images.length >= MAX_IMAGES;

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
                <canvas ref={canvasRef} className="h-full w-full object-contain" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[70%] aspect-[3/4] rounded-[45%] border-2 border-dashed border-brand-400/70" />
                </div>
                <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-ink-100">Centre the face in the guide, look straight ahead, even lighting</p>
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
                Capture ({images.length}/{MAX_IMAGES})
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
          <span className="text-xs text-ink-400">JPEG, PNG or WebP · up to 5 MB each · max {MAX_IMAGES} images · one face per photo</span>
          <input type="file" className="hidden" accept={ACCEPT.join(',')} multiple disabled={full} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        </label>
      )}
      {fileError && <p className="text-sm text-red-300">{fileError}</p>}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((img) => (
            <li key={img.id} className="group relative overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="Enrollment sample" className="aspect-square w-full object-cover" />
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
      <p className="text-xs text-ink-400">Tip: 3–5 frontal photos under different lighting improve recognition. The server performs the final face detection and quality check; photos are processed in memory and only encrypted templates are stored.</p>
    </div>
  );
}

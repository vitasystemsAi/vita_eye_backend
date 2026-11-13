/**
 * Fast client-side pre-checks so operators can retake obviously poor photos before upload.
 * The AI service performs the authoritative detection and quality assessment.
 */
export interface LocalQuality {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
  /** Relative texture in the face guide — low values usually mean empty frame or extreme blur. */
  faceFill: number;
  warnings: string[];
}

/** Centered 3:4 region matching the on-screen enrollment guide (78% of frame height). */
export function guideCrop(width: number, height: number) {
  const sh = Math.min(height, Math.max(1, Math.round(height * 0.78)));
  const sw = Math.min(width, Math.max(1, Math.round(sh * 0.75)));
  const sx = Math.max(0, Math.round((width - sw) / 2));
  const sy = Math.max(0, Math.round((height - sh) / 2));
  return { sx, sy, sw: Math.min(sw, width - sx), sh: Math.min(sh, height - sy) };
}

function centerTexture(gray: Float32Array, width: number, height: number): number {
  const x0 = Math.floor(width * 0.22);
  const x1 = Math.floor(width * 0.78);
  const y0 = Math.floor(height * 0.18);
  const y1 = Math.floor(height * 0.82);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = gray[y * width + x];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

function measure(gray: Float32Array, width: number, height: number, fullWidth: number, fullHeight: number): LocalQuality {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = gray.length ? sum / gray.length : 0;

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = n ? lapSum / n : 0;
  const sharpness = n ? lapSq / n - mean * mean : 0;
  const faceFill = centerTexture(gray, width, height);

  const warnings: string[] = [];
  if (Math.min(fullWidth, fullHeight) < 320) warnings.push('Low resolution — move closer or use the back camera');
  if (brightness < 65) warnings.push('Too dark — face a window or turn on a light');
  if (brightness > 205) warnings.push('Over-exposed — step away from direct light');
  if (sharpness < 48) warnings.push('Possibly blurry — hold still until capture');
  if (faceFill < 14) warnings.push('Fill the oval with your face');
  return { width: fullWidth, height: fullHeight, brightness, sharpness, faceFill, warnings };
}

const SIG_W = 36;
const SIG_H = 48;

/** Tiny grayscale sample of the guide, used to tell a steady face from movement. */
export function guideSignature(canvas: HTMLCanvasElement): Float32Array | null {
  if (canvas.width < 2 || canvas.height < 2) return null;
  const { sx, sy, sw, sh } = guideCrop(canvas.width, canvas.height);
  const sample = document.createElement('canvas');
  sample.width = SIG_W;
  sample.height = SIG_H;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, SIG_W, SIG_H);
  const { data } = ctx.getImageData(0, 0, SIG_W, SIG_H);
  const gray = new Float32Array(SIG_W * SIG_H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return gray;
}

/** Mean absolute difference between two guide samples. A still face stays in the low single digits. */
export function signatureMotion(prev: Float32Array, next: Float32Array): number {
  const n = Math.min(prev.length, next.length);
  if (!n) return 999;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(prev[i] - next[i]);
  return sum / n;
}

function sampleGuideGray(canvas: HTMLCanvasElement): { gray: Float32Array; w: number; h: number } | null {
  if (canvas.width < 2 || canvas.height < 2) return null;
  const { sx, sy, sw, sh } = guideCrop(canvas.width, canvas.height);
  const scale = Math.min(1, 320 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return { gray, w, h };
}

/** Live check of the face inside the guide, so the operator sees a problem before a photo is taken. */
export function assessCanvasGuide(canvas: HTMLCanvasElement): LocalQuality | null {
  const sample = sampleGuideGray(canvas);
  if (!sample) return null;
  return measure(sample.gray, sample.w, sample.h, canvas.width, canvas.height);
}

/**
 * Cheap on-device yaw hint from left/right brightness in the eye band.
 * Used only to skip unnecessary pose-guide uploads when the turn is clearly wrong.
 * Positive ≈ face turned toward the image's right side.
 */
export function estimateGuideYaw(canvas: HTMLCanvasElement): number | null {
  const sample = sampleGuideGray(canvas);
  if (!sample) return null;
  const { gray, w, h } = sample;
  const y0 = Math.floor(h * 0.28);
  const y1 = Math.floor(h * 0.55);
  const mid = Math.floor(w / 2);
  let left = 0;
  let right = 0;
  let ln = 0;
  let rn = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < mid; x++) {
      left += gray[y * w + x];
      ln++;
    }
    for (let x = mid; x < w; x++) {
      right += gray[y * w + x];
      rn++;
    }
  }
  if (!ln || !rn) return null;
  const l = left / ln;
  const r = right / rn;
  const denom = Math.max(1, (l + r) / 2);
  return (r - l) / denom;
}

export async function assessImage(file: Blob): Promise<LocalQuality> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const result = measure(gray, w, h, bitmap.width, bitmap.height);
  bitmap.close();
  return result;
}

export const QUALITY_REASON_TEXT: Record<string, string> = {
  NO_FACE: 'No face was detected',
  MULTIPLE_FACES: 'More than one face is visible — only the person being enrolled may appear',
  FACE_TOO_SMALL: 'Face is too small — move closer to the camera',
  LOW_DETECTION_CONFIDENCE: 'Face could not be detected reliably — even light, eyes open, fill the oval',
  BLURRY: 'Image is blurry — hold still and refocus',
  TOO_DARK: 'Too dark — improve the lighting',
  TOO_BRIGHT: 'Over-exposed — reduce direct light',
  POSE_NOT_FRONTAL: 'Face is turned — look straight at the camera',
  FACE_TILTED: 'Head is tilted — keep the eyes level',
  LANDMARKS_UNRELIABLE: 'Eyes and nose could not be placed accurately — face the camera in even light',
  LOW_QUALITY_SCORE: 'Overall quality is below the enrollment standard',
  UNSUPPORTED_FORMAT: 'Unsupported file format — use JPEG, PNG or WebP',
};

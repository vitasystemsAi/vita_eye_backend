/**
 * Fast client-side pre-checks so operators can retake obviously poor photos before upload.
 * The AI service performs the authoritative detection and quality assessment.
 */
export interface LocalQuality {
  width: number;
  height: number;
  brightness: number;
  sharpness: number;
  warnings: string[];
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
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sum += y;
  }
  const brightness = sum / gray.length;

  // Variance of the Laplacian as a focus measure.
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = n ? lapSum / n : 0;
  const sharpness = n ? lapSq / n - mean * mean : 0;

  const warnings: string[] = [];
  if (Math.min(bitmap.width, bitmap.height) < 360) warnings.push('Low resolution');
  if (brightness < 60) warnings.push('Too dark');
  if (brightness > 210) warnings.push('Over-exposed');
  if (sharpness < 40) warnings.push('Possibly blurry');
  const result = { width: bitmap.width, height: bitmap.height, brightness, sharpness, warnings };
  bitmap.close();
  return result;
}

export const QUALITY_REASON_TEXT: Record<string, string> = {
  NO_FACE: 'No face was detected',
  MULTIPLE_FACES: 'More than one face is visible — only the person being enrolled may appear',
  FACE_TOO_SMALL: 'Face is too small — move closer to the camera',
  LOW_DETECTION_CONFIDENCE: 'Face could not be detected reliably',
  BLURRY: 'Image is blurry — hold still and refocus',
  TOO_DARK: 'Too dark — improve the lighting',
  TOO_BRIGHT: 'Over-exposed — reduce direct light',
  POSE_NOT_FRONTAL: 'Face is turned — look straight at the camera',
  LOW_QUALITY_SCORE: 'Overall quality is below the enrollment standard',
  UNSUPPORTED_FORMAT: 'Unsupported file format — use JPEG, PNG or WebP',
};

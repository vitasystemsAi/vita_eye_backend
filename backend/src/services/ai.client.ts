import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { Semaphore } from '../utils/semaphore';
import type { AppSettings } from '../config/defaultSettings';

export const inferenceSlots = new Semaphore(env.MAX_CONCURRENT_INFERENCE);

export interface FaceQuality {
  score: number;
  faceSize: number;
  sharpness: number;
  brightness: number;
  poseYaw: number;
  detectionScore: number;
  issues: string[];
}

export interface EmbedResult {
  embedding: number[];
  quality: FaceQuality;
  bbox: [number, number, number, number];
  modelName: string;
  modelVersion: string;
}

export type FaceLabel = 'KNOWN' | 'UNKNOWN' | 'UNCERTAIN' | 'LOW_QUALITY' | 'PENDING';

export interface FrameFace {
  trackId: string;
  bbox: [number, number, number, number];
  label: FaceLabel;
  personId: string | null;
  similarity: number | null;
  quality: number;
}

export interface ConfirmedEvent {
  trackId: string;
  eventType: 'KNOWN' | 'UNKNOWN' | 'UNCERTAIN';
  personId: string | null;
  confidence: number | null;
  quality: number;
  framesObserved: number;
  timestamp: string;
  modelVersion: string;
  /** Full scene with the face outlined. */
  evidenceJpegB64?: string | null;
  /** Zoomed face close-up. */
  evidenceFaceJpegB64?: string | null;
}

export interface FrameResult {
  faces: FrameFace[];
  events: ConfirmedEvent[];
  frameSize: [number, number];
  modelVersion: string;
}

export type RecognitionPolicy = AppSettings['recognition'] & {
  unknownCooldownSec: number;
  captureEvidence: boolean;
};

export function policyFrom(settings: AppSettings): RecognitionPolicy {
  return { ...settings.recognition, unknownCooldownSec: settings.events.unknownCooldownSec, captureEvidence: settings.events.captureEvidence };
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      ...init,
      headers: { 'X-Internal-Token': env.INTERNAL_SERVICE_TOKEN, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? env.AI_SERVICE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(503, 'AI_SERVICE_UNAVAILABLE', `AI service unreachable: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (!res.ok) {
    const detail = body?.detail as { code?: string; message?: string; reasons?: string[]; quality?: FaceQuality } | string | undefined;
    if (res.status === 422 && typeof detail === 'object' && detail?.code) {
      throw new AppError(400, detail.code, detail.message ?? 'Face rejected', { reasons: detail.reasons, quality: detail.quality });
    }
    throw new AppError(502, 'AI_SERVICE_ERROR', `AI service error (${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function aiHealth() {
  return call<{ status: string; modelVersion: string; models: Record<string, unknown>; streams: number }>('/health', { timeoutMs: 3000 });
}

export type PoseTarget = 'straight' | 'left' | 'right' | 'up' | 'down';

export interface PoseGuideResult {
  faces: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  ready: PoseTarget[];
  matched: boolean;
  nudge: string;
  issues: string[];
}

/** Live head-pose check for guided enrollment. Detects only — no template is created. */
export function guidePose(image: Buffer, mimeType: string, target: PoseTarget): Promise<PoseGuideResult> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'pose.jpg');
  form.append('target', target);
  return inferenceSlots.run(() => call<PoseGuideResult>('/v1/enroll/pose', { method: 'POST', body: form, timeoutMs: 4000 }));
}

export async function embedFace(image: Buffer, mimeType: string, policy: RecognitionPolicy): Promise<EmbedResult> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'face.jpg');
  form.append('policy', JSON.stringify(policy));
  return inferenceSlots.run(() => call<EmbedResult>('/v1/enroll/embed', { method: 'POST', body: form }));
}

export async function processFrame(
  frame: Buffer,
  meta: { organizationId: string; cameraId: string; galleryVersion: string; policy: RecognitionPolicy },
): Promise<FrameResult> {
  const form = new FormData();
  form.append('frame', new Blob([new Uint8Array(frame)], { type: 'image/jpeg' }), 'frame.jpg');
  form.append('meta', JSON.stringify(meta));
  return call<FrameResult>('/v1/frames/process', { method: 'POST', body: form });
}

export function startStream(body: {
  cameraId: string;
  organizationId: string;
  url: string;
  samplingFps: number;
  galleryVersion: string;
  policy: RecognitionPolicy;
}) {
  return call<{ started: boolean }>('/v1/streams/start', json(body));
}

export function stopStream(cameraId: string) {
  return call<{ stopped: boolean }>('/v1/streams/stop', json({ cameraId }));
}

export function testStream(url: string) {
  return call<{ ok: boolean; width?: number; height?: number; error?: string }>('/v1/streams/test', { ...json({ url }), timeoutMs: 45000 });
}

export interface PreviewFrame {
  ok: true;
  sessionId: string;
  frame: string;
  width: number;
  height: number;
  publicUrl: string;
  path: string;
}

export function startPreview(url: string) {
  return call<PreviewFrame | { ok: false; error: string }>('/v1/streams/preview/start', { ...json({ url }), timeoutMs: 20000 });
}

export function previewFrame(sessionId: string) {
  return call<{ frame: string; width: number; height: number }>(`/v1/streams/preview/${encodeURIComponent(sessionId)}`, { timeoutMs: 8000 });
}

export function stopPreview(sessionId: string) {
  return call<{ stopped: boolean }>('/v1/streams/preview/stop', { ...json({ sessionId }), timeoutMs: 5000 });
}

export function listStreams() {
  return call<{ streams: Array<{ cameraId: string; status: string; error?: string | null; fps?: number }> }>('/v1/streams', { timeoutMs: 5000 });
}

export function pushPolicy(organizationId: string, policy: RecognitionPolicy, galleryVersion: string) {
  return call<{ updated: number }>('/v1/policy', json({ organizationId, policy, galleryVersion }));
}

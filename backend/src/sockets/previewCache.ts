/** Last JPEG sent for a camera, so a viewer who just signed in does not wait for the next capture. */
const latest = new Map<string, { payload: unknown; at: number }>();
const MAX_AGE_MS = 2_000;

export function rememberPreview(cameraId: string, payload: unknown) {
  latest.set(cameraId, { payload, at: Date.now() });
}

export function latestPreview(cameraId: string): unknown | null {
  const row = latest.get(cameraId);
  if (!row || Date.now() - row.at > MAX_AGE_MS) return null;
  return row.payload;
}

export function forgetPreview(cameraId: string) {
  latest.delete(cameraId);
}

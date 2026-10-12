import { Op } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Camera, RegisteredPerson } from '../models';
import type { CameraStatus } from '../models/Camera';
import { emitToOrg, emitToPreview, previewWatcherCount } from '../sockets/emitter';
import { cipher, credentialsAad } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { assertCameraUrlAllowed, parseCidrs, withCredentials } from '../utils/network';
import { isWithinSchedule } from '../utils/schedule';
import { inferenceSlots, listStreams, policyFrom, processFrame, pushPolicy, startStream, stopStream, type FrameFace } from './ai.client';
import { recordEvents } from './detections.service';
import { galleryVersion } from './gallery.service';
import { cameraInScope } from './scope';
import { getSettings, onSettingsChanged } from './settings.service';
import { forEachTenant } from './tenancy.service';
import type { AuthContext } from '../types/auth';

const cidrs = parseCidrs(env.CAMERA_ALLOWED_NETWORKS);
const blockedCidrs = parseCidrs(env.CAMERA_BLOCKED_NETWORKS);
const inFlight = new Set<string>();
const lastSeenWrite = new Map<string, number>();
const lastPreviewAt = new Map<string, number>();
const lastOverlay = new Map<string, { faces: FrameAck['faces']; frameSize: FrameAck['frameSize']; at: number }>();
const OVERLAY_HOLD_MS = 1_500;
/** Cap how often an unannotated picture is mirrored. Annotated results are not throttled. */
const PREVIEW_INTERVAL_MS = 100;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const BROWSER_OFFLINE_AFTER_MS = 45_000;

export const NETWORK_TYPES = new Set(['RTSP', 'ONVIF', 'HTTP_MJPEG']);

export { credentialsAad };

export async function setCameraStatus(camera: Camera, status: CameraStatus, error: string | null = null) {
  const changed = camera.status !== status || camera.lastError !== error;
  const updates: Partial<Camera> = { status, lastError: error };
  if (status === 'ONLINE') updates.lastConnectedAt = new Date();
  await camera.update(updates);
  if (changed) emitToOrg(camera.organizationId, 'camera:status', { cameraId: camera.id, status, error, lastConnectedAt: camera.lastConnectedAt });
}

/** Builds the authenticated stream URL. Only ever sent to the internal AI service. */
export async function resolveStreamUrl(cameraId: string): Promise<string> {
  const cam = await Camera.scope('withCredentials').findByPk(cameraId);
  if (!cam?.streamReference) throw AppError.badRequest('Camera has no stream URL');
  await assertCameraUrlAllowed(cam.streamReference, cam.cameraType, cidrs, blockedCidrs);
  const creds = cam.encryptedCredentials ? JSON.parse(cipher.decryptString(cam.encryptedCredentials, credentialsAad(cam.id))) : null;
  return withCredentials(cam.streamReference, creds);
}

export async function startNetworkStream(camera: Camera) {
  const settings = await getSettings(camera.organizationId);
  await startStream({
    cameraId: camera.id,
    organizationId: camera.organizationId,
    url: await resolveStreamUrl(camera.id),
    samplingFps: camera.samplingFps,
    galleryVersion: await galleryVersion(camera.organizationId),
    policy: policyFrom(settings),
  });
}

export async function stopNetworkStream(camera: Camera) {
  await stopStream(camera.id).catch((err) => logger.warn({ err: (err as Error).message, cameraId: camera.id }, 'stopStream failed'));
}

export async function syncPolicyToStreams(organizationId: string, version?: string) {
  try {
    const settings = await getSettings(organizationId);
    await pushPolicy(organizationId, policyFrom(settings), version ?? (await galleryVersion(organizationId)));
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Policy push to AI service skipped');
  }
}

onSettingsChanged((orgId) => void syncPolicyToStreams(orgId));

export interface FrameAck {
  ok: boolean;
  dropped?: boolean;
  error?: string;
  faces?: Array<FrameFace & { personName?: string | null }>;
  frameSize?: [number, number];
  events?: number;
  /** Confirmed unknown / uncertain events from this frame, so the monitoring device can sound an alarm. */
  alerts?: Array<{ id: string; eventType: 'UNKNOWN' | 'UNCERTAIN' }>;
}

/** Forwards the JPEG already captured to Live Preview viewers. The last identities stay on later frames. */
function relayPreview(cameraId: string, jpeg: Buffer, annotated?: Pick<FrameAck, 'faces' | 'frameSize'>) {
  if (previewWatcherCount(cameraId) === 0) return;
  const now = Date.now();
  let faces = annotated?.faces;
  let frameSize = annotated?.frameSize;
  if (faces && frameSize) lastOverlay.set(cameraId, { faces, frameSize, at: now });
  else {
    const held = lastOverlay.get(cameraId);
    if (held && now - held.at < OVERLAY_HOLD_MS) {
      faces = held.faces;
      frameSize = held.frameSize;
    }
  }
  if (!annotated && now - (lastPreviewAt.get(cameraId) ?? 0) < PREVIEW_INTERVAL_MS) return;
  lastPreviewAt.set(cameraId, now);
  emitToPreview(cameraId, 'camera:preview', { cameraId, image: jpeg, faces, frameSize }, { volatile: true });
}

/**
 * Browser-camera frame ingest (Socket.IO). Applies authz, schedule and backpressure before inference.
 * `ticketId` is set for device-ticket sockets; a stopped or restarted camera no longer matches it.
 */
export async function handleBrowserFrame(ctx: AuthContext, cameraId: string, jpeg: Buffer, ticketId?: string): Promise<FrameAck> {
  if (!ctx.permissions.has('cameras:monitor')) return { ok: false, error: 'FORBIDDEN' };
  if (jpeg.length === 0 || jpeg.length > MAX_FRAME_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return { ok: false, error: 'INVALID_FRAME' };
  }

  const camera = await Camera.findByPk(cameraId);
  if (!camera || !cameraInScope(ctx, camera)) return { ok: false, error: 'CAMERA_NOT_FOUND' };
  if (camera.cameraType !== 'BROWSER') return { ok: false, error: 'NOT_A_BROWSER_CAMERA' };
  if (!camera.isActive) return { ok: false, error: 'CAMERA_INACTIVE' };
  if (!camera.monitoringEnabled) return { ok: false, error: 'MONITORING_NOT_STARTED' };
  if (ticketId !== undefined && camera.monitorTicketId !== ticketId) return { ok: false, error: 'MONITORING_NOT_STARTED' };
  if (!isWithinSchedule(camera.schedule)) return { ok: false, error: 'OUTSIDE_SCHEDULE' };
  if (inFlight.has(cameraId) || !inferenceSlots.tryAcquire()) {
    relayPreview(cameraId, jpeg);
    return { ok: true, dropped: true };
  }

  inFlight.add(cameraId);
  try {
    const now = Date.now();
    if (camera.status !== 'ONLINE' || now - (lastSeenWrite.get(cameraId) ?? 0) > 10_000) {
      lastSeenWrite.set(cameraId, now);
      await setCameraStatus(camera, 'ONLINE');
    }
    const settings = await getSettings(camera.organizationId);
    relayPreview(cameraId, jpeg);
    const result = await processFrame(jpeg, {
      organizationId: camera.organizationId,
      cameraId,
      galleryVersion: await galleryVersion(camera.organizationId),
      policy: policyFrom(settings),
    });
    const saved = result.events.length ? await recordEvents(camera.organizationId, camera, result.events) : [];
    const alerts = saved.filter((e) => e.eventType !== 'KNOWN').map((e) => ({ id: e.id, eventType: e.eventType as 'UNKNOWN' | 'UNCERTAIN' }));

    let names = new Map<string, string>();
    const ids = [...new Set(result.faces.map((f) => f.personId).filter((x): x is string => !!x))];
    if (ids.length && ctx.permissions.has('persons:view')) {
      const persons = await RegisteredPerson.findAll({ where: { id: { [Op.in]: ids }, organizationId: ctx.organizationId }, attributes: ['id', 'personName'] });
      names = new Map(persons.map((p) => [p.id, p.personName]));
    }
    const faces = result.faces.map((f) => ({ ...f, personName: f.personId ? (names.get(f.personId) ?? null) : null }));
    relayPreview(cameraId, jpeg, { faces, frameSize: result.frameSize });
    return {
      ok: true,
      frameSize: result.frameSize,
      events: result.events.length,
      alerts,
      faces,
    };
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'PROCESSING_FAILED';
    logger.warn({ cameraId, err: (err as Error).message }, 'Browser frame processing failed');
    return { ok: false, error: code };
  } finally {
    inFlight.delete(cameraId);
    inferenceSlots.release();
  }
}

type RunningStreams = () => Promise<Map<string, string> | null>;

/**
 * Periodic reconciliation: marks silent browser cameras offline, enforces monitoring schedules and
 * restarts network streams that the AI service lost (e.g. after a restart). Runs inside every
 * organization's database; organizations on hold have their streams stopped.
 */
export async function reconcileCameras() {
  let streams: Promise<Map<string, string> | null> | null = null;
  const running: RunningStreams = () =>
    (streams ??= listStreams()
      .then((r) => new Map(r.streams.map((s) => [s.cameraId, s.status])))
      .catch(() => null));
  await forEachTenant((tenant) => reconcileTenantCameras(running, tenant.status === 'ACTIVE'), { statuses: ['ACTIVE', 'SUSPENDED'] });
}

/** Stops every running network stream of the current tenant (organization put on hold). */
export async function stopTenantStreams(reason: string) {
  const network = await Camera.findAll({ where: { cameraType: { [Op.in]: [...NETWORK_TYPES] }, monitoringEnabled: true } });
  for (const cam of network) {
    await stopNetworkStream(cam);
    await setCameraStatus(cam, 'OFFLINE', reason);
  }
}

async function reconcileTenantCameras(getRunning: RunningStreams, organizationActive: boolean) {
  const stale = await Camera.findAll({
    where: { cameraType: 'BROWSER', status: 'ONLINE', lastConnectedAt: { [Op.lt]: new Date(Date.now() - BROWSER_OFFLINE_AFTER_MS) } },
  });
  for (const cam of stale) await setCameraStatus(cam, 'OFFLINE');

  const network = await Camera.findAll({ where: { cameraType: { [Op.in]: [...NETWORK_TYPES] }, isActive: true, monitoringEnabled: true } });
  if (!network.length) return;
  const running = await getRunning();
  if (!organizationActive) {
    for (const cam of network) {
      if (running?.has(cam.id)) await stopNetworkStream(cam);
      if (cam.status !== 'OFFLINE') await setCameraStatus(cam, 'OFFLINE', 'Organization on hold');
    }
    return;
  }
  if (!running) {
    for (const cam of network) {
      if (cam.status !== 'ERROR') await setCameraStatus(cam, 'ERROR', 'AI service unavailable');
    }
    return;
  }
  for (const cam of network) {
    const inSchedule = isWithinSchedule(cam.schedule);
    if (inSchedule && !running.has(cam.id)) {
      try {
        await startNetworkStream(cam);
      } catch (err) {
        await setCameraStatus(cam, 'ERROR', (err as Error).message.slice(0, 500));
      }
    } else if (!inSchedule && running.has(cam.id)) {
      await stopNetworkStream(cam);
      await setCameraStatus(cam, 'OFFLINE', 'Outside monitoring schedule');
    }
  }
}

export { cidrs as cameraNetworks, blockedCidrs as blockedCameraNetworks };

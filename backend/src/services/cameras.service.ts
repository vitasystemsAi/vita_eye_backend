import crypto from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { Organization, Camera, DetectionEvent, sequelize } from '../models';
import type { CameraSchedule, CameraType } from '../models/Camera';
import { cipher } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { pageMeta } from '../utils/http';
import { assertCameraUrlAllowed, withCredentials } from '../utils/network';
import { isWithinSchedule } from '../utils/schedule';
import { testStream } from './ai.client';
import { audit } from './audit.service';
import {
  LOCAL_TYPES,
  NETWORK_TYPES,
  blockedCameraNetworks,
  cameraNetworks,
  credentialsAad,
  resolveStreamUrl,
  setCameraStatus,
  startNetworkStream,
  stopNetworkStream,
} from './ingestion.service';
import { signMonitorTicket } from './monitorTicket.service';
import { emitToPreview } from '../sockets/emitter';
import { forgetPreview } from '../sockets/previewCache';
import { assertCameraInScope, cameraScopeWhere } from './scope';
import type { AuthContext } from '../types/auth';

export function presentCamera(c: Camera) {
  return {
    id: c.id,
    cameraName: c.cameraName,
    cameraType: c.cameraType,
    location: c.location,
    site: c.site,
    streamReference: c.streamReference,
    hasCredentials: Boolean(c.getDataValue('encryptedCredentials')),
    status: c.status,
    isActive: c.isActive,
    monitoringEnabled: c.monitoringEnabled,
    schedule: c.schedule,
    withinSchedule: isWithinSchedule(c.schedule),
    samplingFps: c.samplingFps,
    lastError: c.lastError,
    lastConnectedAt: c.lastConnectedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function load(ctx: AuthContext, id: string) {
  const c = await Camera.scope('withCredentials').findOne({ where: { id, organizationId: ctx.organizationId } });
  assertCameraInScope(ctx, c);
  return c!;
}

function assertSiteAllowed(ctx: AuthContext, site: string | null | undefined) {
  if (ctx.siteScope && (!site || !ctx.siteScope.includes(site))) {
    throw AppError.forbidden('You can only manage cameras within your assigned sites');
  }
}

export async function listCameras(
  ctx: AuthContext,
  q: { page: number; pageSize: number; order: 'asc' | 'desc'; site?: string; location?: string; status?: string; type?: string; search?: string },
) {
  const where = cameraScopeWhere(ctx) as Record<string | symbol, unknown>;
  if (q.site) where.site = ctx.siteScope && !ctx.siteScope.includes(q.site) ? '__none__' : q.site;
  if (q.location) where.location = { [Op.like]: `%${q.location}%` };
  if (q.status) where.status = q.status;
  if (q.type) where.cameraType = q.type;
  if (q.search) where[Op.or] = [{ cameraName: { [Op.like]: `%${q.search}%` } }, { location: { [Op.like]: `%${q.search}%` } }];
  const { rows, count } = await Camera.scope('withCredentials').findAndCountAll({
    where: where as WhereOptions<Camera>,
    order: [['cameraName', q.order === 'desc' ? 'DESC' : 'ASC']],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const sites = (await Camera.findAll({ where: cameraScopeWhere(ctx), attributes: ['site'], group: ['site'], raw: true }))
    .map((r) => r.site)
    .filter((s): s is string => !!s);
  return { items: rows.map(presentCamera), meta: pageMeta(q.page, q.pageSize, count), sites };
}

export async function getCamera(ctx: AuthContext, id: string) {
  return presentCamera(await load(ctx, id));
}

interface CameraInput {
  cameraName?: string;
  cameraType?: CameraType;
  location?: string;
  site?: string | null;
  streamUrl?: string | null;
  username?: string | null;
  password?: string | null;
  schedule?: CameraSchedule | null;
  samplingFps?: number;
  isActive?: boolean;
  clearCredentials?: boolean;
}

/** Device id chosen in the browser for a camera plugged in by USB or USB-C. Never fetched as a URL. */
function usbDeviceReference(raw: string | null | undefined): string | null {
  const id = raw?.trim() ?? '';
  if (!id) return null;
  if (id.length > 512 || /\s/.test(id) || id.includes('://') || id.includes('@')) {
    throw AppError.validation([{ path: 'streamUrl', message: 'Choose a detected USB or USB-C camera' }]);
  }
  return id;
}

export async function createCamera(ctx: AuthContext, input: CameraInput & { cameraName: string; cameraType: CameraType; location: string }, ip: string | null) {
  assertSiteAllowed(ctx, input.site);
  let streamReference: string | null = null;
  if (NETWORK_TYPES.has(input.cameraType)) {
    streamReference = (await assertCameraUrlAllowed(input.streamUrl!, input.cameraType, cameraNetworks, blockedCameraNetworks)).toString();
  } else if (input.cameraType === 'USB') {
    streamReference = usbDeviceReference(input.streamUrl);
  }
  return sequelize.transaction(async (transaction) => {
    const org = await Organization.findByPk(ctx.organizationId, { transaction });
    if (org?.cameraLimit != null) {
      const existing = await Camera.count({ where: { organizationId: ctx.organizationId }, transaction });
      if (existing >= org.cameraLimit) throw AppError.conflict(`This organization is limited to ${org.cameraLimit} cameras`);
    }
    const cam = await Camera.create(
      {
        organizationId: ctx.organizationId,
        cameraName: input.cameraName,
        cameraType: input.cameraType,
        location: input.location,
        site: input.site || null,
        streamReference,
        schedule: input.schedule ?? null,
        samplingFps: input.samplingFps ?? 8,
      },
      { transaction },
    );
    if (input.username && NETWORK_TYPES.has(input.cameraType)) {
      await cam.update(
        { encryptedCredentials: cipher.encryptString(JSON.stringify({ username: input.username, password: input.password ?? '' }), credentialsAad(cam.id)) },
        { transaction },
      );
    }
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'CAMERA_CREATED', entityType: 'camera', entityId: cam.id, ipAddress: ip, metadata: { name: cam.cameraName, type: cam.cameraType } }, transaction);
    return presentCamera(cam);
  });
}

export async function updateCamera(ctx: AuthContext, id: string, input: CameraInput, ip: string | null) {
  const cam = await load(ctx, id);
  if (input.site !== undefined) assertSiteAllowed(ctx, input.site);
  const changes: Partial<Camera> = {};
  if (input.cameraName !== undefined) changes.cameraName = input.cameraName;
  if (input.location !== undefined) changes.location = input.location;
  if (input.site !== undefined) changes.site = input.site || null;
  if (input.schedule !== undefined) changes.schedule = input.schedule;
  if (input.samplingFps !== undefined) changes.samplingFps = input.samplingFps;
  if (input.isActive !== undefined) {
    changes.isActive = input.isActive;
    if (!input.isActive) Object.assign(changes, { monitoringEnabled: false, monitorTicketId: null, status: 'DISABLED' });
    else if (cam.status === 'DISABLED') changes.status = 'OFFLINE';
  }
  if (cam.cameraType === 'USB') {
    if (input.streamUrl !== undefined) changes.streamReference = usbDeviceReference(input.streamUrl);
  }
  if (NETWORK_TYPES.has(cam.cameraType)) {
    if (input.streamUrl) changes.streamReference = (await assertCameraUrlAllowed(input.streamUrl, cam.cameraType, cameraNetworks, blockedCameraNetworks)).toString();
    if (input.clearCredentials) changes.encryptedCredentials = null;
    else if (input.username) {
      changes.encryptedCredentials = cipher.encryptString(JSON.stringify({ username: input.username, password: input.password ?? '' }), credentialsAad(cam.id));
    }
  }
  const streamAffected = 'streamReference' in changes || 'encryptedCredentials' in changes || 'samplingFps' in changes || 'isActive' in changes;
  await sequelize.transaction(async (transaction) => {
    await cam.update(changes, { transaction });
    await audit(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'CAMERA_UPDATED',
        entityType: 'camera',
        entityId: id,
        ipAddress: ip,
        metadata: { fields: Object.keys(input).filter((k) => k !== 'password'), credentialsChanged: Boolean(input.username || input.clearCredentials) },
      },
      transaction,
    );
  });
  if (NETWORK_TYPES.has(cam.cameraType) && streamAffected) {
    if (!cam.isActive) await stopNetworkStream(cam);
    else if (cam.monitoringEnabled && isWithinSchedule(cam.schedule)) await startNetworkStream(cam).catch((e) => setCameraStatus(cam, 'ERROR', (e as Error).message.slice(0, 500)));
  }
  if (cam.status === 'DISABLED' && 'isActive' in changes) await setCameraStatus(cam, 'DISABLED');
  return getCamera(ctx, id);
}

export async function deleteCamera(ctx: AuthContext, id: string, ip: string | null) {
  const cam = await load(ctx, id);
  const events = await DetectionEvent.count({ where: { cameraId: id } });
  if (events > 0) throw AppError.conflict('This camera has recorded events and cannot be deleted. Deactivate it instead.');
  if (NETWORK_TYPES.has(cam.cameraType)) await stopNetworkStream(cam);
  await sequelize.transaction(async (transaction) => {
    await cam.destroy({ transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'CAMERA_DELETED', entityType: 'camera', entityId: id, ipAddress: ip, metadata: { name: cam.cameraName } }, transaction);
  });
  return { deleted: true };
}

export async function testConnection(ctx: AuthContext, id: string, ip: string | null) {
  const cam = await load(ctx, id);
  if (LOCAL_TYPES.has(cam.cameraType)) {
    return {
      ok: true,
      tested: false,
      message:
        cam.cameraType === 'USB'
          ? 'USB and USB-C cameras are verified on the computer the cable is plugged into, when monitoring starts.'
          : 'Browser cameras are verified on the operator device when monitoring starts.',
    };
  }
  const result = await testStream(await resolveStreamUrl(id));
  if (result.ok) await setCameraStatus(cam, cam.monitoringEnabled ? cam.status : 'OFFLINE', null);
  else await setCameraStatus(cam, 'ERROR', result.error ?? 'Connection failed');
  if (result.ok) await cam.update({ lastConnectedAt: new Date() });
  await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'CAMERA_TESTED', entityType: 'camera', entityId: id, ipAddress: ip, metadata: { ok: result.ok } });
  return { ...result, tested: true };
}

/** Checks the address typed in the form. Does not change the saved camera. */
export async function testDraftConnection(
  ctx: AuthContext,
  input: { cameraId?: string; cameraType: CameraType; streamUrl: string; username?: string | null; password?: string | null; clearCredentials?: boolean },
  ip: string | null,
) {
  await assertCameraUrlAllowed(input.streamUrl, input.cameraType, cameraNetworks, blockedCameraNetworks);
  let creds: { username?: string; password?: string } | null = null;
  if (!input.clearCredentials && input.username) {
    creds = { username: input.username, password: input.password ?? '' };
  } else if (!input.clearCredentials && input.cameraId) {
    const cam = await load(ctx, input.cameraId);
    if (cam.encryptedCredentials) creds = JSON.parse(cipher.decryptString(cam.encryptedCredentials, credentialsAad(cam.id))) as { username?: string; password?: string };
  }
  const result = await testStream(withCredentials(input.streamUrl, creds));
  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'CAMERA_TESTED',
    entityType: 'camera',
    entityId: input.cameraId ?? null,
    ipAddress: ip,
    metadata: { ok: result.ok, draft: true },
  });
  return { ...result, tested: true };
}

export async function startMonitoring(ctx: AuthContext, id: string, ip: string | null) {
  const cam = await load(ctx, id);
  if (!cam.isActive) throw AppError.badRequest('Camera is deactivated');
  if (!ctx.features.has('multiCameraDashboard')) {
    const others = await Camera.count({ where: { organizationId: ctx.organizationId, monitoringEnabled: true, id: { [Op.ne]: cam.id } } });
    if (others >= 1) throw AppError.forbidden('Multi-camera monitoring is not enabled for this organization');
  }
  let monitorTicket: string | undefined;
  if (LOCAL_TYPES.has(cam.cameraType)) {
    // Reuse the live ticket so a second device joining the same camera doesn't cut off the first.
    const ticketId = cam.monitoringEnabled && cam.monitorTicketId ? cam.monitorTicketId : crypto.randomUUID();
    await cam.update({ monitoringEnabled: true, monitorTicketId: ticketId });
    monitorTicket = signMonitorTicket({ userId: ctx.userId, organizationId: ctx.organizationId, cameraId: cam.id, ticketId });
  } else {
    await cam.update({ monitoringEnabled: true });
  }
  let message = 'Monitoring enabled';
  if (NETWORK_TYPES.has(cam.cameraType)) {
    if (!isWithinSchedule(cam.schedule)) {
      await setCameraStatus(cam, 'OFFLINE', 'Outside monitoring schedule');
      message = 'Monitoring enabled; stream will start when the schedule window opens';
    } else {
      try {
        await startNetworkStream(cam);
        message = 'Stream ingestion started';
      } catch (err) {
        await setCameraStatus(cam, 'ERROR', (err as Error).message.slice(0, 500));
        throw err;
      }
    }
  } else if (!isWithinSchedule(cam.schedule)) {
    message = 'Monitoring enabled, but frames are rejected outside the schedule window';
  }
  await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'MONITORING_STARTED', entityType: 'camera', entityId: id, ipAddress: ip });
  return { camera: await getCamera(ctx, id), message, monitorTicket };
}

export async function stopMonitoring(ctx: AuthContext, id: string, ip: string | null, via?: 'monitor-device') {
  const cam = await load(ctx, id);
  await cam.update({ monitoringEnabled: false, monitorTicketId: null });
  forgetPreview(cam.id);
  emitToPreview(cam.id, 'camera:preview:status', { cameraId: cam.id, monitoring: false });
  if (NETWORK_TYPES.has(cam.cameraType)) await stopNetworkStream(cam);
  await setCameraStatus(cam, cam.isActive ? 'OFFLINE' : 'DISABLED');
  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'MONITORING_STOPPED',
    entityType: 'camera',
    entityId: id,
    ipAddress: ip,
    metadata: via ? { via } : null,
  });
  return { camera: await getCamera(ctx, id), message: 'Monitoring stopped' };
}

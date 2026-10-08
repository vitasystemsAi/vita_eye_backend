import type { Request, Response } from 'express';
import { z } from 'zod';
import { Camera, Organization } from '../models';
import { recordEvents } from '../services/detections.service';
import { galleryVersion, loadGallery } from '../services/gallery.service';
import { NETWORK_TYPES, setCameraStatus } from '../services/ingestion.service';
import { forEachTenant, resolveTenant, runInTenant } from '../services/tenancy.service';
import { AppError, parse } from '../utils/errors';
import { ok } from '../utils/http';

const eventSchema = z.object({
  trackId: z.string().max(64),
  eventType: z.enum(['KNOWN', 'UNKNOWN', 'UNCERTAIN']),
  personId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  confidence: z.number().min(-1).max(1).nullable(),
  quality: z.number().min(0).max(1),
  framesObserved: z.number().int().min(1).max(1000),
  timestamp: z.string().max(64),
  modelVersion: z.string().max(128),
  evidenceJpegB64: z.string().max(8 * 1024 * 1024).nullable().optional(),
  evidenceFaceJpegB64: z.string().max(2 * 1024 * 1024).nullable().optional(),
});

export async function gallery(req: Request, res: Response) {
  const { organizationId } = parse(z.object({ organizationId: z.string().uuid() }), req.params);
  const { knownVersion } = parse(z.object({ knownVersion: z.string().max(64).optional() }), req.query);
  if (!(await Organization.findByPk(organizationId))) throw AppError.notFound('Organization');
  await runInTenant(organizationId, async () => {
    const current = await galleryVersion(organizationId);
    if (knownVersion && knownVersion === current) {
      ok(res, { version: current, unchanged: true });
      return;
    }
    ok(res, await loadGallery(organizationId));
  });
}

export async function detections(req: Request, res: Response) {
  const body = parse(
    z.object({ organizationId: z.string().uuid(), cameraId: z.string().uuid(), events: z.array(eventSchema).min(1).max(50) }),
    req.body,
  );
  const tenant = await resolveTenant(body.organizationId);
  if (!tenant) throw AppError.notFound('Organization');
  if (tenant.status !== 'ACTIVE') throw AppError.conflict('Organization is on hold');
  await runInTenant(body.organizationId, async () => {
    const camera = await Camera.findOne({ where: { id: body.cameraId, organizationId: body.organizationId } });
    if (!camera) throw AppError.notFound('Camera');
    if (!camera.isActive || !camera.monitoringEnabled) throw AppError.conflict('Camera is not being monitored');
    const saved = await recordEvents(body.organizationId, camera, body.events);
    ok(res, { saved: saved.length });
  });
}

/** Older AI service builds report status without the organization; find the camera's tenant. */
async function findCameraOrganization(cameraId: string): Promise<string | null> {
  let found: string | null = null;
  await forEachTenant(async (tenant) => {
    if (!found && (await Camera.count({ where: { id: cameraId } }))) found = tenant.organizationId;
  });
  return found;
}

export async function cameraStatus(req: Request, res: Response) {
  const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
  const body = parse(
    z.object({ status: z.enum(['ONLINE', 'ERROR', 'OFFLINE']), error: z.string().max(500).nullable().optional(), organizationId: z.string().uuid().optional() }),
    req.body,
  );
  const organizationId = body.organizationId ?? (await findCameraOrganization(id));
  if (!organizationId) throw AppError.notFound('Camera');
  await runInTenant(organizationId, async () => {
    const camera = await Camera.findOne({ where: { id, organizationId } });
    if (!camera || !NETWORK_TYPES.has(camera.cameraType)) throw AppError.notFound('Camera');
    const ignore = camera.status === 'DISABLED' || (body.status === 'OFFLINE' && camera.monitoringEnabled && camera.status === 'ERROR');
    if (!ignore) await setCameraStatus(camera, body.status, body.error ?? null);
    ok(res, { updated: !ignore });
  });
}

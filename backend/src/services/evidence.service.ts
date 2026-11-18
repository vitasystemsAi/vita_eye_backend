import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Op, type Transaction } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Camera, DetectionEvent, EventEvidence } from '../models';
import type { EvidenceType } from '../models/DetectionEvent';
import { cipher, evidenceAad as aad } from '../utils/cipher';
import { sha256 } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { signToken, verifyToken } from '../utils/signedUrl';
import { audit } from './audit.service';
import { assertCameraInScope, cameraInScope } from './scope';
import type { AuthContext } from '../types/auth';

export function resolveStorage(reference: string): string {
  const full = path.resolve(env.evidenceDir, reference);
  if (!full.startsWith(path.resolve(env.evidenceDir) + path.sep)) throw new Error('Invalid storage reference');
  return full;
}

/** Writes an encrypted evidence file; returns the reference to persist plus a cleanup hook. */
export async function writeEvidenceFile(organizationId: string, jpeg: Buffer) {
  const id = crypto.randomUUID();
  const now = new Date();
  const reference = path.posix.join(organizationId, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${id}.bin`);
  const full = resolveStorage(reference);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, cipher.encryptBuffer(jpeg, aad(id)), { mode: 0o600 });
  return {
    id,
    reference,
    contentHash: sha256(jpeg),
    cleanup: () => fs.rm(full, { force: true }),
  };
}

export async function createEvidenceRow(
  file: { id: string; reference: string; contentHash: string },
  eventId: string,
  retentionDays: number,
  transaction: Transaction,
  evidenceType: EvidenceType = 'SNAPSHOT',
) {
  return EventEvidence.create(
    {
      id: file.id,
      eventId,
      storageReference: file.reference,
      contentHash: file.contentHash,
      evidenceType,
      mimeType: 'image/jpeg',
      expiresAt: new Date(Date.now() + retentionDays * 86400_000),
    },
    { transaction },
  );
}

async function loadAuthorized(ctx: AuthContext, evidenceId: string) {
  const ev = await EventEvidence.scope('withStorage').findByPk(evidenceId, {
    include: [{ model: DetectionEvent, as: 'event', include: [{ model: Camera, as: 'camera', paranoid: false }] }],
  });
  const event = (ev as unknown as { event?: DetectionEvent })?.event;
  if (!ev || !event || event.organizationId !== ctx.organizationId || event.eventType === 'KNOWN') throw AppError.notFound('Evidence');
  assertCameraInScope(ctx, event.camera ?? null);
  if (ev.expiresAt && ev.expiresAt < new Date()) throw new AppError(410, 'EVIDENCE_EXPIRED', 'Evidence has expired under the retention policy');
  return { ev, event };
}

export async function issueEvidenceUrl(ctx: AuthContext, evidenceId: string, ip: string | null) {
  const { event } = await loadAuthorized(ctx, evidenceId);
  const exp = Math.floor(Date.now() / 1000) + env.EVIDENCE_URL_TTL_SECONDS;
  const token = signToken({ e: evidenceId, u: ctx.userId, o: ctx.organizationId, x: exp }, env.EVIDENCE_URL_SECRET);
  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'EVIDENCE_URL_ISSUED',
    entityType: 'evidence',
    entityId: evidenceId,
    ipAddress: ip,
    metadata: { eventId: event.id },
  });
  return { url: `/api/v1/evidence/download?token=${encodeURIComponent(token)}`, expiresAt: new Date(exp * 1000) };
}

/**
 * Batch variant used by list views (thumbnails). Evidence the caller cannot see (other org, out of
 * site scope, expired, missing) is silently omitted rather than failing the whole batch.
 */
export async function issueEvidenceUrls(ctx: AuthContext, evidenceIds: string[], ip: string | null) {
  const rows = await EventEvidence.findAll({
    where: { id: { [Op.in]: evidenceIds } },
    attributes: ['id', 'expiresAt'],
    include: [{ model: DetectionEvent, as: 'event', attributes: ['id', 'organizationId', 'eventType'], include: [{ model: Camera, as: 'camera', paranoid: false }] }],
  });
  const now = new Date();
  const exp = Math.floor(Date.now() / 1000) + env.EVIDENCE_URL_TTL_SECONDS;
  const urls: Record<string, { url: string; expiresAt: Date }> = {};
  for (const ev of rows) {
    const event = (ev as unknown as { event?: DetectionEvent }).event;
    if (!event || event.eventType === 'KNOWN' || event.organizationId !== ctx.organizationId || !cameraInScope(ctx, event.camera ?? null)) continue;
    if (ev.expiresAt && ev.expiresAt < now) continue;
    const token = signToken({ e: ev.id, u: ctx.userId, o: ctx.organizationId, x: exp }, env.EVIDENCE_URL_SECRET);
    urls[ev.id] = { url: `/api/v1/evidence/download?token=${encodeURIComponent(token)}`, expiresAt: new Date(exp * 1000) };
  }
  const issued = Object.keys(urls);
  if (issued.length) {
    await audit({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'EVIDENCE_URL_ISSUED',
      entityType: 'evidence',
      ipAddress: ip,
      metadata: { evidenceIds: issued, batch: true },
    });
  }
  return urls;
}

export async function readEvidence(ctx: AuthContext, token: string, ip: string | null) {
  const payload = verifyToken(token, env.EVIDENCE_URL_SECRET);
  if (!payload || payload.u !== ctx.userId || payload.o !== ctx.organizationId) {
    throw new AppError(403, 'EVIDENCE_LINK_INVALID', 'Evidence link is invalid or has expired');
  }
  const { ev, event } = await loadAuthorized(ctx, payload.e);
  const blob = await fs.readFile(resolveStorage(ev.storageReference));
  const plain = cipher.decryptBuffer(blob, aad(ev.id));
  if (sha256(plain) !== ev.contentHash) {
    logger.error({ evidenceId: ev.id }, 'Evidence integrity check failed');
    throw new AppError(500, 'EVIDENCE_INTEGRITY', 'Evidence integrity verification failed');
  }
  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'EVIDENCE_ACCESSED',
    entityType: 'evidence',
    entityId: ev.id,
    ipAddress: ip,
    metadata: { eventId: event.id },
  });
  return { data: plain, mimeType: ev.mimeType };
}

/**
 * Decrypts many evidence images at once for report exports. Applies the same organization, site-scope,
 * expiry and integrity checks as single downloads; anything that fails is omitted from the result.
 * Auditing is the caller's responsibility (one export entry instead of one row per image).
 */
export async function readEvidenceBatch(ctx: AuthContext, evidenceIds: string[], concurrency = 8): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  if (!evidenceIds.length) return out;
  const rows = await EventEvidence.scope('withStorage').findAll({
    where: { id: { [Op.in]: evidenceIds } },
    include: [{ model: DetectionEvent, as: 'event', attributes: ['id', 'organizationId', 'cameraId', 'eventType'], include: [{ model: Camera, as: 'camera', paranoid: false }] }],
  });
  const now = new Date();
  const allowed = rows.filter((ev) => {
    const event = (ev as unknown as { event?: DetectionEvent }).event;
    return event && event.eventType !== 'KNOWN' && event.organizationId === ctx.organizationId && cameraInScope(ctx, event.camera ?? null) && !(ev.expiresAt && ev.expiresAt < now);
  });
  let next = 0;
  const worker = async () => {
    while (next < allowed.length) {
      const ev = allowed[next++];
      try {
        const plain = cipher.decryptBuffer(await fs.readFile(resolveStorage(ev.storageReference)), aad(ev.id));
        if (sha256(plain) !== ev.contentHash) {
          logger.error({ evidenceId: ev.id }, 'Evidence integrity check failed during export');
          continue;
        }
        out.set(ev.id, plain);
      } catch (err) {
        logger.warn({ evidenceId: ev.id, err: (err as Error).message }, 'Evidence unreadable during export');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, allowed.length) }, worker));
  return out;
}

export async function deleteEvidenceFile(reference: string) {
  try {
    await fs.rm(resolveStorage(reference), { force: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message, reference }, 'Failed to delete evidence file');
  }
}

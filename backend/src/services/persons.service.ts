import crypto from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { logger } from '../config/logger';
import { AuditLog, FaceTemplate, RegisteredPerson, User, sequelize } from '../models';
import { cipher } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { pageMeta } from '../utils/http';
import { embedFace, policyFrom, type EmbedResult } from './ai.client';
import { audit } from './audit.service';
import { bumpGalleryVersion, loadGallery, templateAad } from './gallery.service';
import { getSettings } from './settings.service';
import { syncPolicyToStreams } from './ingestion.service';
import type { AuthContext } from '../types/auth';

const MAX_TEMPLATES_PER_PERSON = 10;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function present(p: RegisteredPerson, templateCount?: number) {
  return {
    id: p.id,
    personName: p.personName,
    referenceId: p.referenceId,
    department: p.department,
    status: p.status,
    enrollmentStatus: p.enrollmentStatus,
    legalBasis: p.legalBasis,
    consentReference: p.consentReference,
    consentRecordedAt: p.consentRecordedAt,
    enrolledBy: p.enroller ? { id: p.enroller.id, name: p.enroller.name } : null,
    templateCount: templateCount ?? p.templates?.length ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function galleryChanged(organizationId: string) {
  try {
    const version = await bumpGalleryVersion(organizationId);
    await syncPolicyToStreams(organizationId, version);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Gallery version bump/sync failed; AI streams will refresh on next poll');
  }
}

export async function listPersons(
  ctx: AuthContext,
  q: {
    page: number;
    pageSize: number;
    order: 'asc' | 'desc';
    sort: 'personName' | 'referenceId' | 'createdAt' | 'updatedAt';
    search?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    enrollmentStatus?: 'PENDING' | 'ENROLLED' | 'FAILED' | 'REVOKED';
    department?: string;
  },
) {
  const where: Record<string | symbol, unknown> = { organizationId: ctx.organizationId };
  if (q.status) where.status = q.status;
  if (q.enrollmentStatus) where.enrollmentStatus = q.enrollmentStatus;
  if (q.department) where.department = q.department;
  if (q.search) {
    const like = { [Op.like]: `%${q.search}%` };
    where[Op.or] = [{ personName: like }, { referenceId: like }, { department: like }];
  }
  const { rows, count } = await RegisteredPerson.findAndCountAll({
    where: where as WhereOptions<RegisteredPerson>,
    include: [{ model: User, as: 'enroller', attributes: ['id', 'name'] }],
    order: [[q.sort, q.order]],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const counts = rows.length
    ? ((await FaceTemplate.findAll({
        attributes: ['registeredPersonId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
        where: { registeredPersonId: rows.map((r) => r.id) },
        group: ['registeredPersonId'],
        raw: true,
      })) as unknown as Array<{ registeredPersonId: string; n: number }>)
    : [];
  const byId = new Map(counts.map((c) => [c.registeredPersonId, Number(c.n)]));
  return { items: rows.map((r) => present(r, byId.get(r.id) ?? 0)), meta: pageMeta(q.page, q.pageSize, count) };
}

async function findPerson(ctx: AuthContext, id: string) {
  const p = await RegisteredPerson.findOne({
    where: { id, organizationId: ctx.organizationId },
    include: [
      { model: FaceTemplate, as: 'templates' },
      { model: User, as: 'enroller', attributes: ['id', 'name'] },
    ],
  });
  if (!p) throw AppError.notFound('Person');
  return p;
}

export async function getPerson(ctx: AuthContext, id: string) {
  const p = await findPerson(ctx, id);
  const history = await AuditLog.findAll({
    where: { organizationId: ctx.organizationId, entityType: 'registered_person', entityId: id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  return {
    ...present(p),
    templates: (p.templates ?? []).map((t) => ({
      id: t.id,
      modelName: t.modelName,
      modelVersion: t.modelVersion,
      qualityScore: t.qualityScore,
      createdAt: t.createdAt,
    })),
    history: history.map((h) => ({ id: String(h.id), action: h.action, metadata: h.metadata, createdAt: h.createdAt, user: h.user ? { id: h.user.id, name: h.user.name } : null })),
  };
}

export async function createPerson(
  ctx: AuthContext,
  input: { personName: string; referenceId: string; department?: string | null; status?: 'ACTIVE' | 'INACTIVE' },
  ip: string | null,
) {
  return sequelize.transaction(async (transaction) => {
    // A soft-deleted record (biometrics already removed) may still hold this reference ID: purge it.
    const stale = await RegisteredPerson.findOne({
      where: { organizationId: ctx.organizationId, referenceId: input.referenceId, deletedAt: { [Op.ne]: null } },
      paranoid: false,
      transaction,
    });
    if (stale) {
      await FaceTemplate.destroy({ where: { registeredPersonId: stale.id }, transaction });
      await stale.destroy({ force: true, transaction });
      await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'BIOMETRIC_PURGE_VERIFIED', entityType: 'registered_person', entityId: stale.id, ipAddress: ip, metadata: { reason: 'reference_reused' } }, transaction);
    }
    const p = await RegisteredPerson.create(
      { organizationId: ctx.organizationId, personName: input.personName, referenceId: input.referenceId, department: input.department ?? null, status: input.status ?? 'ACTIVE' },
      { transaction },
    );
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'PERSON_CREATED', entityType: 'registered_person', entityId: p.id, ipAddress: ip, metadata: { referenceId: p.referenceId } }, transaction);
    return present(p, 0);
  });
}

export async function updatePerson(
  ctx: AuthContext,
  id: string,
  input: Partial<{ personName: string; referenceId: string; department: string | null; status: 'ACTIVE' | 'INACTIVE' }>,
  ip: string | null,
) {
  const p = await findPerson(ctx, id);
  const statusChanged = input.status !== undefined && input.status !== p.status;
  await sequelize.transaction(async (transaction) => {
    await p.update(input, { transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'PERSON_UPDATED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { fields: Object.keys(input) } }, transaction);
  });
  if (statusChanged) await galleryChanged(ctx.organizationId);
  return getPerson(ctx, id);
}

export async function setActive(ctx: AuthContext, id: string, active: boolean, ip: string | null) {
  const p = await findPerson(ctx, id);
  await sequelize.transaction(async (transaction) => {
    await p.update({ status: active ? 'ACTIVE' : 'INACTIVE' }, { transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: active ? 'PERSON_ACTIVATED' : 'PERSON_DEACTIVATED', entityType: 'registered_person', entityId: id, ipAddress: ip }, transaction);
  });
  await galleryChanged(ctx.organizationId);
  return getPerson(ctx, id);
}

export interface EnrollFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export async function enroll(
  ctx: AuthContext,
  id: string,
  files: EnrollFile[],
  consent: { legalBasis: string; consentReference: string; replaceExisting: boolean },
  ip: string | null,
) {
  const p = await findPerson(ctx, id);
  if (p.status !== 'ACTIVE') throw AppError.badRequest('Activate the person before enrolling biometric data');
  if (!files.length) throw AppError.validation([{ path: 'images', message: 'At least one image is required' }]);
  const existing = consent.replaceExisting ? 0 : (p.templates?.length ?? 0);
  if (existing + files.length > MAX_TEMPLATES_PER_PERSON) {
    throw AppError.badRequest(`A person may have at most ${MAX_TEMPLATES_PER_PERSON} templates`);
  }

  const settings = await getSettings(ctx.organizationId);
  const policy = policyFrom(settings);
  const results: Array<{ index: number; fileName: string; accepted: boolean; quality?: unknown; reasons?: string[]; message?: string }> = [];
  const accepted: EmbedResult[] = [];

  for (const [index, f] of files.entries()) {
    if (!ALLOWED_MIME.has(f.mimetype)) {
      results.push({ index, fileName: f.originalname, accepted: false, reasons: ['UNSUPPORTED_FORMAT'], message: 'Use JPEG, PNG or WebP' });
      continue;
    }
    try {
      const r = await embedFace(f.buffer, f.mimetype, policy);
      accepted.push(r);
      results.push({ index, fileName: f.originalname, accepted: true, quality: r.quality });
    } catch (err) {
      if (err instanceof AppError && err.code === 'FACE_QUALITY_REJECTED') {
        const d = err.details as { reasons?: string[]; quality?: unknown } | undefined;
        results.push({ index, fileName: f.originalname, accepted: false, reasons: d?.reasons, quality: d?.quality, message: err.message });
      } else {
        throw err;
      }
    }
  }

  if (!accepted.length) {
    await sequelize.transaction(async (transaction) => {
      if (p.enrollmentStatus !== 'ENROLLED') await p.update({ enrollmentStatus: 'FAILED' }, { transaction });
      await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'ENROLLMENT_FAILED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { images: files.length, results: results.map((r) => ({ accepted: r.accepted, reasons: r.reasons })) } }, transaction);
    });
    throw new AppError(400, 'FACE_QUALITY_REJECTED', 'No image met the enrollment quality requirements', { results });
  }

  // Templates of the new images must agree with each other (same person in every image).
  for (let i = 1; i < accepted.length; i++) {
    const sim = dot(accepted[0].embedding, accepted[i].embedding);
    if (sim < settings.recognition.knownThreshold) {
      throw new AppError(400, 'INCONSISTENT_IDENTITY', 'The supplied images do not appear to show the same person', { results, similarity: round(sim) });
    }
  }

  // Prevent enrolling the same face under a different identity.
  const gallery = await loadGallery(ctx.organizationId);
  for (const t of gallery.templates) {
    if (t.personId === id) continue;
    const sim = Math.max(...accepted.map((a) => dot(a.embedding, t.embedding)));
    if (sim >= settings.recognition.knownThreshold) {
      const other = await RegisteredPerson.findByPk(t.personId);
      throw new AppError(409, 'DUPLICATE_IDENTITY', `This face matches an existing registration (${other?.referenceId ?? 'unknown reference'})`, {
        results,
        matchedPersonId: t.personId,
        similarity: round(sim),
      });
    }
  }

  await sequelize.transaction(async (transaction) => {
    if (consent.replaceExisting) await FaceTemplate.destroy({ where: { registeredPersonId: id }, transaction });
    for (const r of accepted) {
      const templateId = crypto.randomUUID();
      await FaceTemplate.create(
        {
          id: templateId,
          registeredPersonId: id,
          encryptedEmbedding: cipher.encryptEmbedding(r.embedding, templateAad(templateId, id)),
          modelName: r.modelName,
          modelVersion: r.modelVersion,
          qualityScore: r.quality.score,
        },
        { transaction },
      );
    }
    await p.update(
      {
        enrollmentStatus: 'ENROLLED',
        legalBasis: consent.legalBasis,
        consentReference: consent.consentReference,
        consentRecordedAt: new Date(),
        enrolledBy: ctx.userId,
      },
      { transaction },
    );
    await audit(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'PERSON_ENROLLED',
        entityType: 'registered_person',
        entityId: id,
        ipAddress: ip,
        metadata: { templatesAdded: accepted.length, replaced: consent.replaceExisting, rejected: results.filter((r) => !r.accepted).length, legalBasis: consent.legalBasis, modelVersion: accepted[0].modelVersion },
      },
      transaction,
    );
  });
  await galleryChanged(ctx.organizationId);
  return { person: await getPerson(ctx, id), results };
}

/**
 * Deletes a registration: biometric templates are hard-deleted immediately (verified), the person
 * row is soft-deleted and later purged by the retention job.
 */
export async function deletePerson(ctx: AuthContext, id: string, ip: string | null) {
  const p = await findPerson(ctx, id);
  await sequelize.transaction(async (transaction) => {
    const removed = await FaceTemplate.destroy({ where: { registeredPersonId: id }, transaction });
    const remaining = await FaceTemplate.count({ where: { registeredPersonId: id }, transaction });
    if (remaining !== 0) throw new AppError(500, 'PURGE_VERIFICATION_FAILED', 'Biometric deletion could not be verified');
    await p.update({ enrollmentStatus: 'REVOKED', status: 'INACTIVE' }, { transaction });
    await p.destroy({ transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'BIOMETRIC_TEMPLATES_DELETED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { templatesDeleted: removed, verifiedRemaining: remaining } }, transaction);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'PERSON_DELETED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { referenceId: p.referenceId } }, transaction);
  });
  await galleryChanged(ctx.organizationId);
  return { deleted: true };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

import crypto from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { exceedsCapacity, organizationTypeOf } from '../config/organizationTypes';
import { logger } from '../config/logger';
import { AuditLog, FaceTemplate, Organization, RegisteredPerson, User, sequelize } from '../models';
import { cipher } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { pageMeta } from '../utils/http';
import { embedFace, policyFrom, type EmbedResult } from './ai.client';
import { audit } from './audit.service';
import { bumpGalleryVersion, loadGallery, templateAad } from './gallery.service';
import { dot, identityScore } from './identityMatch';
import { readPortrait, removePortraitFiles, writePortrait } from './portrait';
import { getSettings } from './settings.service';
import { syncPolicyToStreams } from './ingestion.service';
import type { AuthContext } from '../types/auth';
import { canDiscardRegistration, deletionHold, statusAuditAction, type PersonStatus } from '../utils/personStatus';

const MAX_TEMPLATES_PER_PERSON = 10;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Enrollment blocks a second identity only when cosine similarity reaches 50%. */
const ENROLL_DUPLICATE_THRESHOLD = 0.5;

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
    statusChangedAt: p.statusChangedAt,
    canDiscard: canDiscardRegistration(p.enrollmentStatus, templateCount ?? p.templates?.length ?? 0),
    ...deletionHold(p.status, p.statusChangedAt),
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
    status?: PersonStatus;
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
      hasPhoto: Boolean(t.previewReference),
    })),
    history: history.map((h) => ({ id: String(h.id), action: h.action, metadata: h.metadata, createdAt: h.createdAt, user: h.user ? { id: h.user.id, name: h.user.name } : null })),
  };
}

async function assertHostelTenant(
  organizationId: string,
  input: { referenceId?: string; department?: string | null },
  adding: number,
) {
  const org = await Organization.findByPk(organizationId);
  if (!org || organizationTypeOf(org.organizationType).master !== 'tenants') return;
  const details: Array<{ path: string; message: string }> = [];
  if (input.referenceId !== undefined && !/^\d{10}$/.test(input.referenceId)) {
    details.push({ path: 'referenceId', message: 'Enter a 10-digit mobile number' });
  }
  if (input.department !== undefined && !input.department?.trim()) {
    details.push({ path: 'department', message: 'Room number is required' });
  }
  if (details.length) throw AppError.validation(details);
  if (adding > 0 && org.capacity != null) {
    const used = await RegisteredPerson.count({ where: { organizationId } });
    if (exceedsCapacity(org.capacity, used, adding)) {
      const remaining = Math.max(0, org.capacity - used);
      throw AppError.conflict(`This exceeds the tenant capacity of ${org.capacity}. ${remaining} ${remaining === 1 ? 'tenant' : 'tenants'} remaining.`);
    }
  }
}

export async function createPerson(
  ctx: AuthContext,
  input: { personName: string; referenceId: string; department?: string | null; status?: PersonStatus },
  ip: string | null,
) {
  await assertHostelTenant(ctx.organizationId, { referenceId: input.referenceId, department: input.department ?? '' }, 1);
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
      { organizationId: ctx.organizationId, personName: input.personName, referenceId: input.referenceId, department: input.department ?? null, status: input.status ?? 'ACTIVE', statusChangedAt: new Date() },
      { transaction },
    );
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'PERSON_CREATED', entityType: 'registered_person', entityId: p.id, ipAddress: ip, metadata: { referenceId: p.referenceId } }, transaction);
    return present(p, 0);
  });
}

export async function updatePerson(
  ctx: AuthContext,
  id: string,
  input: Partial<{ personName: string; referenceId: string; department: string | null; status: PersonStatus }>,
  ip: string | null,
) {
  const patch: { referenceId?: string; department?: string | null } = {};
  if (input.referenceId !== undefined) patch.referenceId = input.referenceId;
  if (input.department !== undefined) patch.department = input.department;
  await assertHostelTenant(ctx.organizationId, patch, 0);
  const p = await findPerson(ctx, id);
  const from = p.status;
  const statusChanged = input.status !== undefined && input.status !== from;
  await sequelize.transaction(async (transaction) => {
    await p.update(statusChanged ? { ...input, statusChangedAt: new Date() } : input, { transaction });
    await audit({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: statusChanged && input.status ? statusAuditAction(from, input.status) : 'PERSON_UPDATED',
      entityType: 'registered_person',
      entityId: id,
      ipAddress: ip,
      metadata: statusChanged ? { from, to: input.status } : { fields: Object.keys(input) },
    }, transaction);
  });
  if (statusChanged && (from === 'ACTIVE' || input.status === 'ACTIVE')) await galleryChanged(ctx.organizationId);
  return getPerson(ctx, id);
}

export async function setStatus(ctx: AuthContext, id: string, status: PersonStatus, ip: string | null) {
  const p = await findPerson(ctx, id);
  if (p.status === status) return getPerson(ctx, id);
  const from = p.status;
  await sequelize.transaction(async (transaction) => {
    await p.update({ status, statusChangedAt: new Date() }, { transaction });
    await audit({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: statusAuditAction(from, status),
      entityType: 'registered_person',
      entityId: id,
      ipAddress: ip,
      metadata: { from, to: status },
    }, transaction);
  });
  if (from === 'ACTIVE' || status === 'ACTIVE') await galleryChanged(ctx.organizationId);
  return getPerson(ctx, id);
}

export async function setActive(ctx: AuthContext, id: string, active: boolean, ip: string | null) {
  return setStatus(ctx, id, active ? 'ACTIVE' : 'INACTIVE', ip);
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
  const accepted: Array<{ result: EmbedResult; file: EnrollFile; index: number }> = [];

  for (const [index, f] of files.entries()) {
    if (!ALLOWED_MIME.has(f.mimetype)) {
      results.push({ index, fileName: f.originalname, accepted: false, reasons: ['UNSUPPORTED_FORMAT'], message: 'Use JPEG, PNG or WebP' });
      continue;
    }
    try {
      const r = await embedFace(f.buffer, f.mimetype, policy);
      accepted.push({ result: r, file: f, index });
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

  // Every photo must be the same person. Compare against the clearest image, and every pair,
  // so a different face cannot hide behind one photo that happens to match the first.
  const anchor = accepted.reduce((best, item) => (item.result.quality.score > best.result.quality.score ? item : best));
  const pairFloor = Math.max(0.4, settings.recognition.knownThreshold - 0.04);
  for (const item of accepted) {
    if (item === anchor) continue;
    const sim = dot(anchor.result.embedding, item.result.embedding);
    if (sim < settings.recognition.knownThreshold) {
      throw new AppError(400, 'INCONSISTENT_IDENTITY', 'The supplied images do not appear to show the same person', { results, similarity: round(sim) });
    }
  }
  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const sim = dot(accepted[i].result.embedding, accepted[j].result.embedding);
      if (sim < pairFloor) {
        throw new AppError(400, 'INCONSISTENT_IDENTITY', 'The supplied images do not appear to show the same person', { results, similarity: round(sim) });
      }
    }
  }

  // Same identity score the live gallery uses, so a face that would be confused in monitoring
  // is refused here instead of being stored under a second name.
  const gallery = await loadGallery(ctx.organizationId);
  const byPerson = new Map<string, Array<{ templateId: string; embedding: number[]; quality: number }>>();
  for (const t of gallery.templates) {
    if (t.personId === id) continue;
    const list = byPerson.get(t.personId) ?? [];
    list.push({ templateId: t.templateId, embedding: t.embedding, quality: typeof t.qualityScore === 'number' && t.qualityScore > 0 ? t.qualityScore : 0.75 });
    byPerson.set(t.personId, list);
  }
  const probes = accepted.map((a) => ({ index: a.index, embedding: a.result.embedding, quality: a.result.quality.score }));
  for (const [personId, templates] of byPerson) {
    const sim = Math.max(...probes.map((probe) => identityScore(probe.embedding, templates)));
    if (sim < ENROLL_DUPLICATE_THRESHOLD) continue;
    let closest = -1;
    let closestTemplateId: string | null = null;
    let matchedImageIndex = probes[0]?.index ?? 0;
    for (const probe of probes) {
      for (const template of templates) {
        const score = dot(probe.embedding, template.embedding);
        if (score > closest) {
          closest = score;
          closestTemplateId = template.templateId;
          matchedImageIndex = probe.index;
        }
      }
    }
    const other = await RegisteredPerson.findByPk(personId, { include: [{ model: FaceTemplate, as: 'templates' }] });
    const pct = Math.round(sim * 100);
    throw new AppError(409, 'DUPLICATE_IDENTITY', `Image ${matchedImageIndex + 1} matches ${other?.personName ?? 'another registration'} (${other?.referenceId ?? 'unknown reference'}) at ${pct}%.`, {
      results,
      matchedPersonId: personId,
      matchedPersonName: other?.personName ?? null,
      referenceId: other?.referenceId ?? null,
      matchedTemplateId: closestTemplateId,
      matchedImageIndex,
      similarity: round(sim),
      matchedFaces: (other?.templates ?? []).map((t) => ({ id: t.id, hasPhoto: Boolean(t.previewReference), qualityScore: t.qualityScore })),
    });
  }

  const written: string[] = [];
  const retired = consent.replaceExisting ? (p.templates ?? []).map((t) => t.previewReference) : [];
  try {
  await sequelize.transaction(async (transaction) => {
    if (consent.replaceExisting) await FaceTemplate.destroy({ where: { registeredPersonId: id }, transaction });
    for (const item of accepted) {
      const templateId = crypto.randomUUID();
      const previewReference = await writePortrait(ctx.organizationId, templateId, id, item.file.buffer);
      written.push(previewReference);
      await FaceTemplate.create(
        {
          id: templateId,
          registeredPersonId: id,
          encryptedEmbedding: cipher.encryptEmbedding(item.result.embedding, templateAad(templateId, id)),
          modelName: item.result.modelName,
          modelVersion: item.result.modelVersion,
          qualityScore: item.result.quality.score,
          previewReference,
          previewMime: item.file.mimetype,
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
        metadata: { templatesAdded: accepted.length, replaced: consent.replaceExisting, rejected: results.filter((r) => !r.accepted).length, legalBasis: consent.legalBasis, modelVersion: accepted[0].result.modelVersion },
      },
      transaction,
    );
  });
  } catch (err) {
    await removePortraitFiles(written);
    throw err;
  }
  await removePortraitFiles(retired);
  await galleryChanged(ctx.organizationId);
  return { person: await getPerson(ctx, id), results };
}

export async function readFacePhoto(ctx: AuthContext, personId: string, templateId: string) {
  const p = await findPerson(ctx, personId);
  const template = (p.templates ?? []).find((t) => t.id === templateId);
  if (!template?.previewReference) throw AppError.notFound('Face photo');
  const data = await readPortrait(template.previewReference, template.id, p.id);
  return { data, mimeType: template.previewMime || 'image/jpeg' };
}

/**
 * Aborts a registration that never received a face. The person row is removed immediately so they
 * do not stay in recognition or occupy the reference ID. Enrolled people still use the hold-period delete.
 */
export async function cancelRegistration(ctx: AuthContext, id: string, ip: string | null) {
  const p = await findPerson(ctx, id);
  const templates = p.templates?.length ?? 0;
  if (!canDiscardRegistration(p.enrollmentStatus, templates)) {
    throw AppError.conflict('This registration already has a face enrolled. Suspend or mark the person inactive, then delete after the hold period.');
  }
  await sequelize.transaction(async (transaction) => {
    await p.update({ enrollmentStatus: 'REVOKED', status: 'INACTIVE' }, { transaction });
    await p.destroy({ transaction });
    await audit(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'REGISTRATION_CANCELLED',
        entityType: 'registered_person',
        entityId: id,
        ipAddress: ip,
        metadata: { referenceId: p.referenceId },
      },
      transaction,
    );
  });
  return { cancelled: true };
}

/**
 * Deletes a registration: biometric templates are hard-deleted immediately (verified), the person
 * row is soft-deleted and later purged by the retention job.
 */
export async function deletePerson(ctx: AuthContext, id: string, ip: string | null) {
  const p = await findPerson(ctx, id);
  const hold = deletionHold(p.status, p.statusChangedAt);
  if (!hold.canDelete) {
    const when = hold.deleteAvailableAt ? new Date(hold.deleteAvailableAt).toISOString().slice(0, 10) : null;
    throw AppError.conflict(
      p.status === 'ACTIVE'
        ? 'Suspend or mark the person inactive before deleting. Deletion is available 7 days after that change.'
        : `Deletion is available on ${when}, 7 days after this person was ${p.status === 'SUSPENDED' ? 'suspended' : 'marked inactive'}.`,
    );
  }
  const portraits = (p.templates ?? []).map((t) => t.previewReference);
  await sequelize.transaction(async (transaction) => {
    const removed = await FaceTemplate.destroy({ where: { registeredPersonId: id }, transaction });
    const remaining = await FaceTemplate.count({ where: { registeredPersonId: id }, transaction });
    if (remaining !== 0) throw new AppError(500, 'PURGE_VERIFICATION_FAILED', 'Biometric deletion could not be verified');
    await p.update({ enrollmentStatus: 'REVOKED', status: 'INACTIVE' }, { transaction });
    await p.destroy({ transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'BIOMETRIC_TEMPLATES_DELETED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { templatesDeleted: removed, verifiedRemaining: remaining } }, transaction);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'PERSON_DELETED', entityType: 'registered_person', entityId: id, ipAddress: ip, metadata: { referenceId: p.referenceId } }, transaction);
  });
  await removePortraitFiles(portraits);
  await galleryChanged(ctx.organizationId);
  return { deleted: true };
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

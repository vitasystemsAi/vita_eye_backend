import crypto from 'node:crypto';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import { organizationTypeOf } from '../config/organizationTypes';
import { logger } from '../config/logger';
import { FaceTemplate, Organization, RegisteredPerson, sequelize } from '../models';
import type { AuthContext } from '../types/auth';
import { cipher, templateAad } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { statusAuditAction, type PersonStatus } from '../utils/personStatus';
import { audit } from './audit.service';
import { openFacePackage, resolveFaceImport, sealFacePackage, type FacePerson, type FacePlanRow, type StoredFace } from './facePackage';
import { bumpGalleryVersion } from './gallery.service';
import { syncPolicyToStreams } from './ingestion.service';
import { enroll } from './persons.service';
import { matchPhotoGroups, readPhotoBundle, type PhotoGroup } from './photoBundle';
import {
  buildPeopleCsv,
  buildPeopleWorkbook,
  readPeopleWorkbook,
  resolvePeopleImport,
  type ImportIssue,
  type PeopleLabels,
  type ResolvedPerson,
} from './peopleWorkbook';
import { getSettings } from './settings.service';

export interface ExchangeReport {
  applied: boolean;
  ready: boolean;
  message: string;
  issues: ImportIssue[];
  notes: string[];
  counts: Record<string, number>;
  rows: Array<{ label: string; action: string; detail: string }>;
}

interface Actor {
  userId: string;
  ip: string | null;
}

function labelsFor(hostel: boolean): PeopleLabels {
  return hostel
    ? { hostel: true, reference: 'Mobile number', department: 'Room number' }
    : { hostel: false, reference: 'Reference ID', department: 'Department' };
}

async function organizationOf(ctx: AuthContext) {
  const org = await Organization.findByPk(ctx.organizationId);
  if (!org) throw AppError.notFound('Organization');
  const hostel = organizationTypeOf(org.organizationType).master === 'tenants';
  return { org, hostel, labels: labelsFor(hostel) };
}

async function refreshGallery(organizationId: string) {
  try {
    const version = await bumpGalleryVersion(organizationId);
    await syncPolicyToStreams(organizationId, version);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Gallery version bump/sync failed; AI streams will refresh on next poll');
  }
}

function present(input: {
  applied: boolean;
  issues: ImportIssue[];
  notes: string[];
  counts: Record<string, number>;
  rows: Array<{ label: string; action: string; detail: string }>;
  message: string;
  writable: number;
}): ExchangeReport {
  const ready = input.issues.length === 0 && input.writable > 0;
  const notes = input.rows.length > 200 ? [...input.notes, `Showing the first 200 of ${input.rows.length} rows.`] : input.notes;
  return {
    applied: input.applied,
    ready,
    message: input.issues[0]?.message && !ready ? input.issues[0].message : input.message,
    issues: input.issues,
    notes,
    counts: input.counts,
    rows: input.rows.slice(0, 200),
  };
}

function countOf(rows: Array<{ action: string }>, action: string) {
  return rows.filter((row) => row.action === action).length;
}

function sentence(parts: string[], tail: string) {
  if (!parts.length) return 'Nothing in this file needs to change.';
  const body = parts.join(' and ');
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}. ${tail}`;
}

export async function peopleTemplate(ctx: AuthContext) {
  const { org, labels } = await organizationOf(ctx);
  const file = await buildPeopleWorkbook({ organizationName: org.name, labels, rows: [], template: true });
  return { ...file, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

export async function exportPeople(
  ctx: AuthContext,
  filter: { format: 'csv' | 'xlsx'; status?: PersonStatus; enrollmentStatus?: 'PENDING' | 'ENROLLED' | 'FAILED' | 'REVOKED' },
  actor: Actor,
) {
  const { org, labels } = await organizationOf(ctx);
  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (filter.status) where.status = filter.status;
  if (filter.enrollmentStatus) where.enrollmentStatus = filter.enrollmentStatus;
  const people = await RegisteredPerson.findAll({
    where,
    include: [{ model: FaceTemplate, as: 'templates', attributes: ['id'] }],
    order: [['personName', 'ASC']],
  });
  const rows = people.map((person) => ({
    personName: person.personName,
    referenceId: person.referenceId,
    department: person.department,
    status: person.status,
    enrollmentStatus: person.enrollmentStatus,
    templateCount: person.templates?.length ?? 0,
    legalBasis: person.legalBasis,
    consentReference: person.consentReference,
    createdAt: person.createdAt,
  }));
  await audit({
    organizationId: ctx.organizationId,
    userId: actor.userId,
    action: 'PEOPLE_EXPORTED',
    entityType: 'organization',
    entityId: ctx.organizationId,
    ipAddress: actor.ip,
    metadata: { format: filter.format, count: rows.length, status: filter.status ?? 'ALL', enrollmentStatus: filter.enrollmentStatus ?? 'ALL' },
  });
  if (filter.format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    return { body: Buffer.from(buildPeopleCsv(rows, labels), 'utf8'), contentType: 'text/csv; charset=utf-8', fileName: `vita-eye-people-${stamp}.csv` };
  }
  const file = await buildPeopleWorkbook({ organizationName: org.name, labels, rows });
  return { body: file.body, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: file.fileName };
}

export async function importPeople(
  ctx: AuthContext,
  buffer: Buffer,
  filename: string,
  input: { mode: 'add' | 'upsert'; dryRun: boolean },
  actor: Actor,
) {
  const { org, hostel, labels } = await organizationOf(ctx);
  const read = await readPeopleWorkbook(buffer, filename, labels);
  if (read.issues.length) return blocked(read.issues, input.dryRun);
  const existing = await RegisteredPerson.findAll({
    where: { organizationId: ctx.organizationId },
    attributes: ['id', 'referenceId', 'personName', 'department', 'status'],
  });
  const used = hostel ? await RegisteredPerson.count({ where: { organizationId: ctx.organizationId } }) : 0;
  const resolved = resolvePeopleImport(read.people, existing.map((person) => ({
    id: person.id,
    referenceId: person.referenceId,
    personName: person.personName,
    department: person.department,
    status: person.status,
  })), input.mode, hostel ? { limit: org.capacity ?? null, used } : null, labels);
  const counts = {
    create: countOf(resolved.rows, 'create'),
    update: countOf(resolved.rows, 'update'),
    unchanged: countOf(resolved.rows, 'unchanged'),
    error: countOf(resolved.rows, 'error'),
  };
  const preview = sentence(
    [
      counts.create ? `${counts.create} ${counts.create === 1 ? 'person' : 'people'} will be added` : '',
      counts.update ? `${counts.update} will be updated` : '',
    ].filter(Boolean),
    'Nothing is deleted, and stored faces stay as they are.',
  );
  if (!input.dryRun) {
    if (resolved.issues.length || counts.create + counts.update === 0) {
      throw AppError.validation(resolved.issues.length ? resolved.issues : [{ path: 'File', message: preview }], preview);
    }
    await applyPeople(ctx, resolved.rows, existing, actor, counts);
  }
  return present({
    applied: !input.dryRun && resolved.issues.length === 0 && counts.create + counts.update > 0,
    issues: resolved.issues,
    notes: counts.error ? [`${counts.error} ${counts.error === 1 ? 'row was' : 'rows were'} left out. The other rows can still be imported.`] : [],
    counts,
    rows: resolved.rows.map((row) => ({ label: `Row ${row.row} · ${row.personName || row.referenceId}`, action: row.action, detail: row.detail })),
    message: input.dryRun
      ? preview
      : sentence(
          [
            counts.create ? `${counts.create} ${counts.create === 1 ? 'person was' : 'people were'} added` : '',
            counts.update ? `${counts.update} ${counts.update === 1 ? 'was' : 'were'} updated` : '',
          ].filter(Boolean),
          'Stored faces were not changed.',
        ),
    writable: counts.create + counts.update,
  });
}

async function applyPeople(
  ctx: AuthContext,
  rows: ResolvedPerson[],
  existing: Array<{ id: string; status: PersonStatus }>,
  actor: Actor,
  counts: Record<string, number>,
) {
  const statusOf = new Map(existing.map((person) => [person.id, person.status]));
  let touchGallery = false;
  try {
    await sequelize.transaction(async (transaction) => {
      for (const row of rows) {
        if (row.action === 'create') {
          const status = row.status ?? 'ACTIVE';
          const created = await RegisteredPerson.create(
            {
              organizationId: ctx.organizationId,
              personName: row.personName,
              referenceId: row.referenceId,
              department: row.department,
              status,
              statusChangedAt: new Date(),
            },
            { transaction },
          );
          await audit({ organizationId: ctx.organizationId, userId: actor.userId, action: 'PERSON_CREATED', entityType: 'registered_person', entityId: created.id, ipAddress: actor.ip, metadata: { referenceId: created.referenceId, source: 'spreadsheet' } }, transaction);
        } else if (row.action === 'update' && row.existingId) {
          const person = await RegisteredPerson.findOne({ where: { id: row.existingId, organizationId: ctx.organizationId }, transaction });
          if (!person) continue;
          const from = statusOf.get(person.id) ?? person.status;
          const statusChanged = Boolean(row.status && row.status !== from);
          await person.update(
            {
              personName: row.personName,
              ...(row.departmentSpecified ? { department: row.department } : {}),
              ...(statusChanged && row.status ? { status: row.status, statusChangedAt: new Date() } : {}),
            },
            { transaction },
          );
          await audit({
            organizationId: ctx.organizationId,
            userId: actor.userId,
            action: statusChanged && row.status ? statusAuditAction(from, row.status) : 'PERSON_UPDATED',
            entityType: 'registered_person',
            entityId: person.id,
            ipAddress: actor.ip,
            metadata: statusChanged ? { from, to: row.status, source: 'spreadsheet' } : { fields: ['personName', ...(row.departmentSpecified ? ['department'] : [])], source: 'spreadsheet' },
          }, transaction);
          if (statusChanged && row.status && (from === 'ACTIVE' || row.status === 'ACTIVE')) touchGallery = true;
        }
      }
      await audit({
        organizationId: ctx.organizationId,
        userId: actor.userId,
        action: 'PEOPLE_IMPORTED',
        entityType: 'organization',
        entityId: ctx.organizationId,
        ipAddress: actor.ip,
        metadata: counts,
      }, transaction);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw AppError.conflict('A reference ID was registered while this file was being checked. Preview it again.');
    throw err;
  }
  if (touchGallery) await refreshGallery(ctx.organizationId);
}

function blocked(issues: ImportIssue[], dryRun: boolean): ExchangeReport {
  if (!dryRun) throw AppError.validation(issues, issues[0]?.message ?? 'Fix the file and import it again.');
  return present({ applied: false, issues, notes: [], counts: {}, rows: [], message: issues[0]?.message ?? 'Fix the file and import it again.', writable: 0 });
}

export async function exportFaces(ctx: AuthContext, input: { passphrase: string; scope: 'all' | 'active' }, actor: Actor) {
  const { org } = await organizationOf(ctx);
  const where: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (input.scope === 'active') {
    where.status = 'ACTIVE';
    where.enrollmentStatus = 'ENROLLED';
  }
  const people = await RegisteredPerson.findAll({
    where,
    include: [{ model: FaceTemplate.scope('withEmbedding'), as: 'templates', required: true }],
    order: [['personName', 'ASC']],
  });
  const packed: FacePerson[] = [];
  for (const person of people) {
    const templates = [];
    for (const template of person.templates ?? []) {
      try {
        templates.push({
          modelName: template.modelName,
          modelVersion: template.modelVersion,
          qualityScore: template.qualityScore,
          embedding: cipher.decryptEmbedding(template.encryptedEmbedding, templateAad(template.id, person.id)),
        });
      } catch {
        throw AppError.badRequest(`A stored face for ${person.referenceId} could not be read. The export was stopped so the package is not missing anyone.`);
      }
    }
    if (templates.length) {
      packed.push({
        referenceId: person.referenceId,
        personName: person.personName,
        department: person.department,
        status: person.status,
        legalBasis: person.legalBasis,
        consentReference: person.consentReference,
        templates,
      });
    }
  }
  let body: Buffer;
  try {
    body = await sealFacePackage({ organizationName: org.name, exportedAt: new Date(), people: packed, passphrase: input.passphrase });
  } catch (err) {
    throw AppError.badRequest((err as Error).message);
  }
  const templateCount = packed.reduce((sum, person) => sum + person.templates.length, 0);
  await audit({
    organizationId: ctx.organizationId,
    userId: actor.userId,
    action: 'FACES_EXPORTED',
    entityType: 'organization',
    entityId: ctx.organizationId,
    ipAddress: actor.ip,
    metadata: { people: packed.length, templates: templateCount, scope: input.scope },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return { body, contentType: 'application/zip', fileName: `vita-eye-faces-${stamp}.zip` };
}

export async function importFaces(
  ctx: AuthContext,
  buffer: Buffer,
  input: { passphrase: string; dryRun: boolean; missingPeople: 'create' | 'skip'; existingFaces: 'replace' | 'skip' | 'add'; acceptModel: boolean },
  actor: Actor,
) {
  const { org, hostel, labels } = await organizationOf(ctx);
  let opened;
  try {
    opened = await openFacePackage(buffer, input.passphrase);
  } catch (err) {
    return blocked([{ path: 'Package', message: (err as Error).message }], input.dryRun);
  }
  if (!input.dryRun && !input.acceptModel) {
    throw AppError.badRequest('Confirm that these templates match the recognition model in use before restoring them.');
  }
  const existing = await RegisteredPerson.findAll({ where: { organizationId: ctx.organizationId } });
  const countsById = await templateCounts(existing.map((person) => person.id));
  const enrolled = await RegisteredPerson.findAll({
    where: { organizationId: ctx.organizationId, enrollmentStatus: 'ENROLLED' },
    include: [{ model: FaceTemplate.scope('withEmbedding'), as: 'templates' }],
  });
  const gallery: StoredFace[] = [];
  for (const person of enrolled) {
    for (const template of person.templates ?? []) {
      try {
        gallery.push({
          personId: person.id,
          referenceId: person.referenceId,
          embedding: cipher.decryptEmbedding(template.encryptedEmbedding, templateAad(template.id, person.id)),
          quality: template.qualityScore ?? 0.75,
        });
      } catch {
        throw AppError.badRequest('A stored face could not be read, so the import was stopped before anything was compared.');
      }
    }
  }
  const settings = await getSettings(ctx.organizationId);
  const used = hostel ? existing.length : 0;
  const plan = resolveFaceImport(
    opened.people,
    existing.map((person) => ({
      id: person.id,
      referenceId: person.referenceId,
      personName: person.personName,
      department: person.department,
      status: person.status,
      templateCount: countsById.get(person.id) ?? 0,
    })),
    gallery,
    {
      missingPeople: input.missingPeople,
      existingFaces: input.existingFaces,
      threshold: settings.recognition.knownThreshold,
      capacity: hostel ? { limit: org.capacity ?? null, used } : null,
    },
    labels,
  );
  const counts = {
    create: countOf(plan.rows, 'create'),
    restore: countOf(plan.rows, 'restore'),
    add: countOf(plan.rows, 'add'),
    skip: countOf(plan.rows, 'skip'),
    conflict: countOf(plan.rows, 'conflict'),
    error: countOf(plan.rows, 'error'),
  };
  const writable = counts.create + counts.restore + counts.add;
  const preview = sentence(faceParts(counts, false), 'Nothing is deleted. People who are left out stay as they are.');
  if (!input.dryRun) {
    if (plan.issues.length || writable === 0) throw AppError.validation(plan.issues.length ? plan.issues : [{ path: 'File', message: preview }], preview);
    await applyFaces(ctx, plan.rows, actor, counts);
  }
  const when = new Date(opened.exportedAt);
  const whenText = Number.isNaN(when.getTime()) ? opened.exportedAt : when.toISOString().slice(0, 16).replace('T', ' ');
  return present({
    applied: !input.dryRun && plan.issues.length === 0 && writable > 0,
    issues: plan.issues,
    notes: [`Package exported from ${opened.organizationName} on ${whenText} UTC.`, ...plan.notes],
    counts,
    rows: plan.rows.map((row) => ({ label: `${row.personName} · ${row.referenceId}`, action: row.action, detail: row.detail })),
    message: input.dryRun ? preview : sentence(faceParts(counts, true), 'Recognition will use the restored faces on the next gallery refresh.'),
    writable,
  });
}

function faceParts(counts: Record<string, number>, applied: boolean) {
  const verb = applied ? 'restored' : 'will be restored';
  const added = applied ? 'added' : 'will be added';
  return [
    counts.restore ? `${counts.restore} ${counts.restore === 1 ? 'face' : 'faces'} ${verb}` : '',
    counts.add ? `${counts.add} ${counts.add === 1 ? 'face set' : 'face sets'} ${applied ? 'extended' : 'will be extended'}` : '',
    counts.create ? `${counts.create} ${counts.create === 1 ? 'person' : 'people'} ${added}` : '',
  ].filter(Boolean);
}

async function templateCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = (await FaceTemplate.findAll({
    attributes: ['registeredPersonId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { registeredPersonId: ids },
    group: ['registeredPersonId'],
    raw: true,
  })) as unknown as Array<{ registeredPersonId: string; n: number }>;
  return new Map(rows.map((row) => [row.registeredPersonId, Number(row.n)]));
}

async function applyFaces(ctx: AuthContext, rows: FacePlanRow[], actor: Actor, counts: Record<string, number>) {
  let touchGallery = false;
  try {
    await sequelize.transaction(async (transaction) => {
      for (const row of rows) {
        if (!row.person || (row.action !== 'create' && row.action !== 'restore' && row.action !== 'add')) continue;
        const face = row.person;
        const from = row.action === 'create' ? null : (await RegisteredPerson.findOne({ where: { id: row.existingId ?? '', organizationId: ctx.organizationId }, transaction }))?.status ?? null;
        const person = row.action === 'create'
          ? await RegisteredPerson.create(
              {
                organizationId: ctx.organizationId,
                personName: face.personName,
                referenceId: face.referenceId,
                department: face.department,
                status: face.status,
                statusChangedAt: new Date(),
                enrollmentStatus: 'ENROLLED',
                legalBasis: clip(face.legalBasis, 120),
                consentReference: clip(face.consentReference, 255),
                consentRecordedAt: face.legalBasis ? new Date() : null,
                enrolledBy: ctx.userId,
              },
              { transaction },
            )
          : await RegisteredPerson.findOne({ where: { id: row.existingId ?? '', organizationId: ctx.organizationId }, transaction });
        if (!person) continue;
        if (row.action === 'create') {
          await audit({ organizationId: ctx.organizationId, userId: actor.userId, action: 'PERSON_CREATED', entityType: 'registered_person', entityId: person.id, ipAddress: actor.ip, metadata: { referenceId: person.referenceId, source: 'facial_package' } }, transaction);
        } else {
          if (row.action === 'restore') await FaceTemplate.destroy({ where: { registeredPersonId: person.id }, transaction });
          const statusChanged = from !== null && face.status !== from;
          await person.update(
            {
              personName: face.personName,
              ...(face.department ? { department: face.department } : {}),
              ...(statusChanged ? { status: face.status, statusChangedAt: new Date() } : {}),
              enrollmentStatus: 'ENROLLED',
              ...(face.legalBasis ? { legalBasis: clip(face.legalBasis, 120) } : {}),
              ...(face.consentReference ? { consentReference: clip(face.consentReference, 255), consentRecordedAt: new Date() } : {}),
              enrolledBy: ctx.userId,
            },
            { transaction },
          );
          if (statusChanged && from) {
            await audit({ organizationId: ctx.organizationId, userId: actor.userId, action: statusAuditAction(from, face.status), entityType: 'registered_person', entityId: person.id, ipAddress: actor.ip, metadata: { from, to: face.status, source: 'facial_package' } }, transaction);
          }
        }
        await writeTemplates(person.id, face, transaction);
        await audit({
          organizationId: ctx.organizationId,
          userId: actor.userId,
          action: 'PERSON_ENROLLED',
          entityType: 'registered_person',
          entityId: person.id,
          ipAddress: actor.ip,
          metadata: { source: 'facial_package', templates: face.templates.length, replaced: row.action === 'restore' },
        }, transaction);
        if (face.status === 'ACTIVE' || from === 'ACTIVE') touchGallery = true;
      }
      await audit({ organizationId: ctx.organizationId, userId: actor.userId, action: 'FACES_IMPORTED', entityType: 'organization', entityId: ctx.organizationId, ipAddress: actor.ip, metadata: counts }, transaction);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw AppError.conflict('A reference ID was registered while this package was being checked. Preview it again.');
    throw err;
  }
  if (touchGallery) await refreshGallery(ctx.organizationId);
}

function clip(value: string | null, max: number) {
  if (!value) return null;
  return value.slice(0, max);
}

async function writeTemplates(personId: string, person: FacePerson, transaction: Transaction) {
  for (const template of person.templates) {
    const templateId = crypto.randomUUID();
    await FaceTemplate.create(
      {
        id: templateId,
        registeredPersonId: personId,
        encryptedEmbedding: cipher.encryptEmbedding(template.embedding, templateAad(templateId, personId)),
        modelName: template.modelName,
        modelVersion: template.modelVersion,
        qualityScore: template.qualityScore,
      },
      { transaction },
    );
  }
}

export async function importFacePhotos(
  ctx: AuthContext,
  buffer: Buffer,
  input: { dryRun: boolean; replaceExisting: boolean; legalBasis?: 'CONSENT' | 'EMPLOYMENT' | 'LEGAL_OBLIGATION' | 'LEGITIMATE_USE' | 'OTHER'; consentReference?: string },
  actor: Actor,
) {
  const read = await readPhotoBundle(buffer);
  if (read.issues.length) return blocked(read.issues, input.dryRun);
  const people = await RegisteredPerson.findAll({ where: { organizationId: ctx.organizationId }, attributes: ['id', 'referenceId', 'personName'] });
  const countsById = await templateCounts(people.map((person) => person.id));
  const matched = matchPhotoGroups(
    read.groups,
    people.map((person) => ({ id: person.id, referenceId: person.referenceId, personName: person.personName, templateCount: countsById.get(person.id) ?? 0 })),
    input.replaceExisting,
  );
  const ready = matched.filter((row) => row.action === 'ready');
  if (input.dryRun) {
    return present({
      applied: false,
      issues: [],
      notes: read.notes,
      counts: { ready: ready.length, missing: countOf(matched, 'missing'), error: countOf(matched, 'error') },
      rows: matched.map((row) => ({ label: `${row.personName} · ${row.referenceId}`, action: row.action, detail: row.detail })),
      message: sentence([ready.length ? `${ready.length} ${ready.length === 1 ? 'person' : 'people'} will be enrolled` : ''], 'Each photo is checked for quality. A photo that fails is reported and is not stored.'),
      writable: ready.length,
    });
  }
  if (!ready.length || !input.legalBasis || !input.consentReference) {
    throw AppError.badRequest('Record the lawful basis and consent reference, and choose a ZIP that matches registered people.');
  }
  const byRef = new Map(read.groups.map((group) => [group.referenceId.trim().toLowerCase(), group]));
  const outcomes: Array<{ label: string; action: string; detail: string }> = [];
  let enrolled = 0;
  let failed = 0;
  for (const row of matched) {
    if (row.action !== 'ready' || !row.personId) {
      outcomes.push({ label: `${row.personName} · ${row.referenceId}`, action: row.action === 'ready' ? 'skipped' : row.action, detail: row.detail });
      continue;
    }
    const group: PhotoGroup | undefined = byRef.get(row.referenceId.trim().toLowerCase());
    if (!group) continue;
    try {
      await enroll(ctx, row.personId, group.files, { legalBasis: input.legalBasis, consentReference: input.consentReference, replaceExisting: input.replaceExisting }, actor.ip);
      enrolled += 1;
      outcomes.push({ label: `${row.personName} · ${row.referenceId}`, action: 'enrolled', detail: `${group.files.length} ${group.files.length === 1 ? 'photo' : 'photos'} accepted.` });
    } catch (err) {
      failed += 1;
      outcomes.push({ label: `${row.personName} · ${row.referenceId}`, action: 'failed', detail: err instanceof AppError ? err.message : 'Enrollment failed' });
    }
  }
  await audit({
    organizationId: ctx.organizationId,
    userId: actor.userId,
    action: 'FACE_PHOTOS_IMPORTED',
    entityType: 'organization',
    entityId: ctx.organizationId,
    ipAddress: actor.ip,
    metadata: { enrolled, failed, legalBasis: input.legalBasis },
  });
  return present({
    applied: enrolled > 0,
    issues: [],
    notes: read.notes,
    counts: { enrolled, failed, skipped: matched.length - ready.length },
    rows: outcomes,
    message: enrolled
      ? `${enrolled} ${enrolled === 1 ? 'person was' : 'people were'} enrolled.${failed ? ` ${failed} could not be enrolled.` : ''}`
      : 'No photos were enrolled.',
    writable: enrolled,
  });
}

import { Op, type Order, type WhereOptions } from 'sequelize';
import { logger } from '../config/logger';
import { redis } from '../config/redis';
import { Camera, DetectionEvent, EventEvidence, EventNote, Organization, RegisteredPerson, User, sequelize } from '../models';
import type { EventType, EvidenceType, ReviewStatus } from '../models/DetectionEvent';
import { emitToOrg } from '../sockets/emitter';
import { AppError } from '../utils/errors';
import { pageMeta } from '../utils/http';
import { audit } from './audit.service';
import type { ConfirmedEvent } from './ai.client';
import { createEvidenceRow, writeEvidenceFile } from './evidence.service';
import { countUnrecognizedToday, notifyForEvent } from './notifications.service';
import { assertCameraInScope, cameraScopeWhere } from './scope';
import { getSettings } from './settings.service';
import { organizationStorageBytes } from './storageUsage.service';
import type { AuthContext } from '../types/auth';

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const EVIDENCE_ORDER: Record<string, number> = { FACE: 0, SNAPSHOT: 1, CLIP: 2 } satisfies Record<EvidenceType, number>;

function decodeJpeg(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  const jpeg = Buffer.from(b64, 'base64');
  return jpeg.length > 0 && jpeg.length <= MAX_EVIDENCE_BYTES && jpeg[0] === 0xff && jpeg[1] === 0xd8 ? jpeg : null;
}

export function presentEventSummary(e: DetectionEvent) {
  // Registered-person events never expose a photo, including ones stored before this rule.
  const all = e.eventType === 'KNOWN' || !Array.isArray(e.evidence) ? [] : e.evidence;
  const face = all.find((v) => v.evidenceType === 'FACE');
  const scene = all.find((v) => v.evidenceType === 'SNAPSHOT');
  const evidence = face ?? scene;
  return {
    id: e.id,
    eventType: e.eventType,
    confidenceScore: e.confidenceScore,
    qualityScore: e.qualityScore,
    eventTimestamp: e.eventTimestamp,
    reviewStatus: e.reviewStatus,
    modelVersion: e.modelVersion,
    framesObserved: e.framesObserved,
    camera: e.camera ? { id: e.camera.id, name: e.camera.cameraName, location: e.camera.location, site: e.camera.site } : null,
    person: e.person
      ? { id: e.person.id, name: e.person.personName, referenceId: e.person.referenceId, department: e.person.department, deleted: !!e.person.deletedAt }
      : null,
    hasEvidence: e.eventType === 'KNOWN' ? false : Array.isArray(e.evidence) ? e.evidence.length > 0 : undefined,
    evidenceId: evidence?.id ?? null,
    faceEvidenceId: face?.id ?? null,
    sceneEvidenceId: scene?.id ?? null,
    evidenceExpired: !!evidence?.expiresAt && evidence.expiresAt < new Date(),
    createdAt: e.createdAt,
  };
}

/**
 * Persist confirmed recognition events (from the browser ingest path or AI stream workers).
 * Order of operations: cooldown check -> encrypted evidence file -> DB transaction -> realtime
 * broadcast -> notifications. Notification failures never roll back the event.
 */
export async function recordEvents(organizationId: string, camera: Camera, events: ConfirmedEvent[]) {
  const settings = await getSettings(organizationId);
  const saved: DetectionEvent[] = [];
  let storageOpen = true;
  if (settings.events.captureEvidence) {
    const org = await Organization.findByPk(organizationId);
    if (org?.storageLimitBytes != null && (await organizationStorageBytes(organizationId)) >= org.storageLimitBytes) {
      storageOpen = false;
      logger.warn({ organizationId, limit: org.storageLimitBytes }, 'Evidence capture paused: storage limit reached');
    }
  }

  for (const ev of events) {
    let eventType: EventType = ev.eventType;
    let personId = ev.personId;

    if (eventType === 'KNOWN') {
      const person = personId
        ? await RegisteredPerson.findOne({ where: { id: personId, organizationId, status: 'ACTIVE' } })
        : null;
      if (!person) {
        // Gallery changed between recognition and persistence; do not attribute identity.
        eventType = 'UNCERTAIN';
        personId = null;
      } else if (!settings.events.recordKnownEvents) {
        continue;
      }
    } else {
      personId = null;
    }

    let cooldownKey: string | null = null;
    if (eventType === 'KNOWN' && settings.events.knownCooldownSec > 0) {
      cooldownKey = `vita:cooldown:known:${camera.id}:${personId}`;
      const fresh = await redis.set(cooldownKey, '1', 'EX', settings.events.knownCooldownSec, 'NX');
      if (!fresh) continue;
    }

    const files: Array<{ type: EvidenceType; file: Awaited<ReturnType<typeof writeEvidenceFile>> }> = [];
    try {
      if (storageOpen && settings.events.captureEvidence && eventType !== 'KNOWN') {
        const images: Array<[EvidenceType, Buffer | null]> = [
          ['FACE', decodeJpeg(ev.evidenceFaceJpegB64)],
          ['SNAPSHOT', decodeJpeg(ev.evidenceJpegB64)],
        ];
        for (const [type, jpeg] of images) {
          if (jpeg) files.push({ type, file: await writeEvidenceFile(organizationId, jpeg) });
        }
      }
      const ts = new Date(ev.timestamp);
      const event = await sequelize.transaction(async (transaction) => {
        const row = await DetectionEvent.create(
          {
            organizationId,
            cameraId: camera.id,
            registeredPersonId: personId,
            eventType,
            confidenceScore: ev.confidence,
            qualityScore: ev.quality,
            modelVersion: ev.modelVersion,
            trackId: ev.trackId,
            framesObserved: ev.framesObserved,
            eventTimestamp: Number.isNaN(ts.getTime()) ? new Date() : ts,
            reviewStatus: eventType === 'KNOWN' ? 'RESOLVED' : 'NEW',
            resolution: eventType === 'KNOWN' ? 'AUTO_KNOWN' : null,
          },
          { transaction },
        );
        for (const { type, file } of files) {
          await createEvidenceRow(file, row.id, settings.retention.evidenceDays, transaction, type);
        }
        return row;
      });
      saved.push(event);

      const full = await DetectionEvent.findByPk(event.id, {
        include: [
          { model: Camera, as: 'camera' },
          { model: RegisteredPerson, as: 'person', paranoid: false },
          { model: EventEvidence, as: 'evidence' },
        ],
      });
      const unrecognizedToday =
        event.eventType === 'UNKNOWN'
          ? await countUnrecognizedToday(organizationId, event.eventTimestamp).catch((err) => {
              logger.warn({ err, eventId: event.id }, 'Unrecognized tally unavailable');
              return undefined;
            })
          : undefined;
      if (full) {
        emitToOrg(organizationId, 'event:new', {
          ...presentEventSummary(full),
          ...(unrecognizedToday != null ? { unrecognizedToday } : {}),
        });
      }
      void notifyForEvent(event, camera, unrecognizedToday);
    } catch (err) {
      if (cooldownKey) await redis.del(cooldownKey).catch(() => undefined);
      await Promise.all(files.map(({ file }) => file.cleanup().catch(() => undefined)));
      logger.error({ err, cameraId: camera.id, eventType }, 'Failed to persist detection event');
      throw err;
    }
  }
  return saved;
}

export interface EventFilters {
  page: number;
  pageSize: number;
  order: 'asc' | 'desc';
  sort: 'eventTimestamp' | 'eventType' | 'reviewStatus' | 'confidenceScore';
  type?: EventType[];
  reviewStatus?: ReviewStatus[];
  cameraId?: string;
  personId?: string;
  site?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

function buildQuery(ctx: AuthContext, f: EventFilters) {
  const where: Record<string | symbol, unknown> = { organizationId: ctx.organizationId };
  if (f.type) where.eventType = { [Op.in]: f.type };
  if (f.reviewStatus) where.reviewStatus = { [Op.in]: f.reviewStatus };
  if (f.cameraId) where.cameraId = f.cameraId;
  if (f.personId) where.registeredPersonId = f.personId;
  if (f.from || f.to) {
    where.eventTimestamp = { ...(f.from ? { [Op.gte]: f.from } : {}), ...(f.to ? { [Op.lte]: f.to } : {}) };
  }
  const cameraWhere = cameraScopeWhere(ctx) as Record<string | symbol, unknown>;
  if (f.site) cameraWhere.site = ctx.siteScope && !ctx.siteScope.includes(f.site) ? '__none__' : f.site;

  const canSeePersons = ctx.permissions.has('persons:view');
  if (f.search) {
    const like = { [Op.like]: `%${f.search}%` };
    where[Op.or] = [
      { id: f.search },
      ...(canSeePersons ? [{ '$person.person_name$': like }, { '$person.reference_id$': like }] : []),
      { '$camera.camera_name$': like },
      { '$camera.location$': like },
    ];
  }
  const include = [
    { model: Camera, as: 'camera', where: cameraWhere as WhereOptions<Camera>, required: true },
    { model: RegisteredPerson, as: 'person', paranoid: false, required: false },
    { model: EventEvidence, as: 'evidence', required: false, attributes: ['id', 'evidenceType', 'expiresAt'] },
  ];
  const order: Order = [[f.sort, f.order], ['id', 'ASC']];
  return { where: where as WhereOptions<DetectionEvent>, include, order };
}

function redactPerson<T extends ReturnType<typeof presentEventSummary>>(ctx: AuthContext, e: T): T {
  if (ctx.permissions.has('persons:view') || !e.person) return e;
  return { ...e, person: { id: e.person.id, name: 'Registered person', referenceId: '', department: null, deleted: e.person.deleted } };
}

export async function listEvents(ctx: AuthContext, f: EventFilters) {
  const q = buildQuery(ctx, f);
  const { rows, count } = await DetectionEvent.findAndCountAll({
    ...q,
    distinct: true,
    subQuery: false,
    limit: f.pageSize,
    offset: (f.page - 1) * f.pageSize,
  });
  return { items: rows.map((r) => redactPerson(ctx, presentEventSummary(r))), meta: pageMeta(f.page, f.pageSize, count) };
}

export type ExportRow = ReturnType<typeof presentEventSummary> & { resolution: string | null };

/** Events matching the filters (same scope and redaction as the list view), for report exports. */
export async function findEventsForExport(ctx: AuthContext, f: EventFilters): Promise<ExportRow[]> {
  const q = buildQuery(ctx, f);
  const rows = await DetectionEvent.findAll({ ...q, subQuery: false, limit: f.pageSize });
  return rows.map((r) => ({ ...redactPerson(ctx, presentEventSummary(r)), resolution: r.resolution }));
}

async function loadEvent(ctx: AuthContext, id: string) {
  const e = await DetectionEvent.findOne({
    where: { id, organizationId: ctx.organizationId },
    include: [
      { model: Camera, as: 'camera' },
      { model: RegisteredPerson, as: 'person', paranoid: false },
      { model: EventEvidence, as: 'evidence' },
      { model: EventNote, as: 'notes', include: [{ model: User, as: 'author', attributes: ['id', 'name'] }] },
      { model: User, as: 'acknowledger', attributes: ['id', 'name'] },
      { model: User, as: 'resolver', attributes: ['id', 'name'] },
    ],
    order: [[{ model: EventNote, as: 'notes' }, 'createdAt', 'ASC']],
  });
  if (!e) throw AppError.notFound('Event');
  assertCameraInScope(ctx, e.camera ?? null);
  return e;
}

export async function getEvent(ctx: AuthContext, id: string) {
  const e = await loadEvent(ctx, id);
  return {
    ...redactPerson(ctx, presentEventSummary(e)),
    trackId: e.trackId,
    acknowledgedBy: e.acknowledger ? { id: e.acknowledger.id, name: e.acknowledger.name } : null,
    acknowledgedAt: e.acknowledgedAt,
    resolvedBy: e.resolver ? { id: e.resolver.id, name: e.resolver.name } : null,
    resolvedAt: e.resolvedAt,
    resolution: e.resolution,
    evidence: (e.eventType === 'KNOWN' ? [] : [...(e.evidence ?? [])]).sort((a, b) => EVIDENCE_ORDER[a.evidenceType] - EVIDENCE_ORDER[b.evidenceType]).map((v) => ({
      id: v.id,
      evidenceType: v.evidenceType,
      contentHash: v.contentHash,
      createdAt: v.createdAt,
      expiresAt: v.expiresAt,
      expired: !!v.expiresAt && v.expiresAt < new Date(),
    })),
    notes: (e.notes ?? []).map((n) => ({ id: n.id, note: n.note, createdAt: n.createdAt, author: n.author ? { id: n.author.id, name: n.author.name } : null })),
  };
}

type ReviewAction = 'acknowledge' | 'investigate' | 'resolve' | 'reopen';

const ALLOWED: Record<ReviewAction, ReviewStatus[]> = {
  acknowledge: ['NEW'],
  investigate: ['NEW', 'ACKNOWLEDGED'],
  resolve: ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING'],
  reopen: ['RESOLVED'],
};

export async function review(
  ctx: AuthContext,
  id: string,
  action: ReviewAction,
  opts: { resolution?: string; note?: string },
  ip: string | null,
) {
  await sequelize.transaction(async (transaction) => {
    const e = await DetectionEvent.findOne({
      where: { id, organizationId: ctx.organizationId },
      include: [{ model: Camera, as: 'camera' }],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!e) throw AppError.notFound('Event');
    assertCameraInScope(ctx, e.camera ?? null);
    if (!ALLOWED[action].includes(e.reviewStatus)) {
      throw AppError.conflict(`Cannot ${action} an event that is ${e.reviewStatus}`);
    }
    const now = new Date();
    const changes: Partial<DetectionEvent> = {};
    if (action === 'acknowledge' || action === 'investigate') {
      changes.reviewStatus = action === 'acknowledge' ? 'ACKNOWLEDGED' : 'INVESTIGATING';
      if (!e.acknowledgedBy) Object.assign(changes, { acknowledgedBy: ctx.userId, acknowledgedAt: now });
    } else if (action === 'resolve') {
      Object.assign(changes, { reviewStatus: 'RESOLVED', resolvedBy: ctx.userId, resolvedAt: now, resolution: opts.resolution ?? 'OTHER' });
      if (!e.acknowledgedBy) Object.assign(changes, { acknowledgedBy: ctx.userId, acknowledgedAt: now });
    } else {
      Object.assign(changes, { reviewStatus: 'INVESTIGATING', resolvedBy: null, resolvedAt: null, resolution: null });
    }
    await e.update(changes, { transaction });
    if (opts.note) await EventNote.create({ eventId: id, userId: ctx.userId, note: opts.note }, { transaction });
    const actionName = { acknowledge: 'EVENT_ACKNOWLEDGED', investigate: 'EVENT_INVESTIGATING', resolve: 'EVENT_RESOLVED', reopen: 'EVENT_REOPENED' }[action];
    await audit(
      { organizationId: ctx.organizationId, userId: ctx.userId, action: actionName, entityType: 'detection_event', entityId: id, ipAddress: ip, metadata: { resolution: opts.resolution } },
      transaction,
    );
  });
  const updated = await getEvent(ctx, id);
  emitToOrg(ctx.organizationId, 'event:updated', { id, reviewStatus: updated.reviewStatus });
  return updated;
}

export async function addNote(ctx: AuthContext, id: string, note: string, ip: string | null) {
  await loadEvent(ctx, id);
  await sequelize.transaction(async (transaction) => {
    await EventNote.create({ eventId: id, userId: ctx.userId, note }, { transaction });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'EVENT_NOTE_ADDED', entityType: 'detection_event', entityId: id, ipAddress: ip }, transaction);
  });
  return getEvent(ctx, id);
}

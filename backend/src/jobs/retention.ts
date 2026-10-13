import { Op } from 'sequelize';
import { logger } from '../config/logger';
import {
  AuditLog,
  DetectionEvent,
  EventEvidence,
  FaceTemplate,
  Notification,
  OrganizationHold,
  PasswordResetToken,
  RefreshToken,
  RegisteredPerson,
  RetentionCleanupLog,
  RetentionCleanupRun,
  User,
  sequelize,
} from '../models';
import { audit } from '../services/audit.service';
import { deleteEvidenceFile } from '../services/evidence.service';
import { getSettings } from '../services/settings.service';
import { forEachTenant, type TenantInfo } from '../services/tenancy.service';
import { PROVISIONED_STATUSES } from '../utils/accountPolicy';
import { deletionDecision, retentionCutoff, type RetentionMode } from '../utils/retentionPolicy';

const BATCH = 500;

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

async function purgeEvidence(where: Record<string | symbol, unknown>) {
  const rows = await EventEvidence.scope('withStorage').findAll({ where, limit: BATCH });
  for (const row of rows) {
    await deleteEvidenceFile(row.storageReference);
    await row.destroy();
  }
  return rows.length;
}

function eligibleWhere(organizationId: string, cutoff: Date) {
  return {
    organizationId,
    eventTimestamp: { [Op.lt]: cutoff },
    legalHold: false,
    reviewStatus: { [Op.ne]: 'INVESTIGATING' },
  };
}

async function purgeOldEvents(organizationId: string, cutoff: Date) {
  let deleted = 0;
  for (;;) {
    const old = await DetectionEvent.findAll({
      where: eligibleWhere(organizationId, cutoff),
      attributes: ['id'],
      limit: BATCH,
    });
    if (!old.length) return deleted;
    const ids = old.map((event) => event.id);
    let purged: number;
    do purged = await purgeEvidence({ eventId: { [Op.in]: ids } });
    while (purged === BATCH);
    deleted += await DetectionEvent.destroy({ where: { id: { [Op.in]: ids } } });
    if (old.length < BATCH) return deleted;
  }
}

interface CleanupCounts {
  mode: 'DRY_RUN' | 'ENFORCE' | 'SKIPPED';
  cutoffAt: Date | null;
  processed: number;
  deleted: number;
  failed: number;
  remaining: number;
  skippedHolds: number;
  error: string | null;
}

async function writeReport(org: TenantInfo, startedAt: Date, counts: CleanupCounts) {
  const finishedAt = new Date();
  const row = {
    organizationId: org.organizationId,
    mode: counts.mode,
    cutoffAt: counts.cutoffAt,
    processed: counts.processed,
    deleted: counts.deleted,
    failed: counts.failed,
    remaining: counts.remaining,
    skippedHolds: counts.skippedHolds,
    error: counts.error,
    startedAt,
    finishedAt,
  };
  await RetentionCleanupRun.create(row);
  await RetentionCleanupLog.create(row).catch((err) => logger.error({ err, organizationId: org.organizationId }, 'Could not write tenant cleanup log'));
  if (counts.deleted > 0 || counts.failed > 0 || counts.mode === 'SKIPPED') {
    await audit({
      organizationId: org.organizationId,
      action: 'RETENTION_RUN',
      entityType: 'system',
      metadata: { ...counts, cutoffAt: counts.cutoffAt?.toISOString() ?? null },
    });
  }
}

async function applyTenantRetention(org: TenantInfo, legalHold: boolean): Promise<CleanupCounts> {
  const startedAt = new Date();
  const settings = (await getSettings(org.organizationId)).retention;
  const mode: RetentionMode = org.retentionMode === 'DRY_RUN' ? 'DRY_RUN' : 'ENFORCE';
  let cutoff: Date;
  try {
    cutoff = retentionCutoff(startedAt, settings.eventDays, org.retentionGraceDays, org.timezone || 'UTC');
  } catch (err) {
    const counts: CleanupCounts = {
      mode: 'SKIPPED',
      cutoffAt: null,
      processed: 0,
      deleted: 0,
      failed: 1,
      remaining: 0,
      skippedHolds: 0,
      error: (err as Error).message.slice(0, 500),
    };
    await writeReport(org, startedAt, counts);
    return counts;
  }

  if (legalHold || deletionDecision({ organizationLegalHold: legalHold, eventLegalHold: false, underInvestigation: false, eligibleByCutoff: true, mode }) === 'SKIP_LEGAL_HOLD') {
    const counts: CleanupCounts = { mode: 'SKIPPED', cutoffAt: cutoff, processed: 0, deleted: 0, failed: 0, remaining: 0, skippedHolds: 0, error: 'Legal or investigation hold' };
    await writeReport(org, startedAt, counts);
    return counts;
  }

  const skippedHolds = await DetectionEvent.count({
    where: {
      organizationId: org.organizationId,
      eventTimestamp: { [Op.lt]: cutoff },
      [Op.or]: [{ legalHold: true }, { reviewStatus: 'INVESTIGATING' }],
    },
  });
  const eligible = await DetectionEvent.count({ where: eligibleWhere(org.organizationId, cutoff) });

  if (mode === 'DRY_RUN') {
    const counts: CleanupCounts = { mode: 'DRY_RUN', cutoffAt: cutoff, processed: eligible, deleted: 0, failed: 0, remaining: eligible, skippedHolds, error: null };
    await writeReport(org, startedAt, counts);
    return counts;
  }

  const counts: CleanupCounts = { mode: 'ENFORCE', cutoffAt: cutoff, processed: 0, deleted: 0, failed: 0, remaining: 0, skippedHolds, error: null };
  try {
    const orgEventIds = (
      await DetectionEvent.findAll({
        where: {
          organizationId: org.organizationId,
          [Op.or]: [{ legalHold: true }, { reviewStatus: 'INVESTIGATING' }],
        },
        attributes: ['id'],
        raw: true,
      })
    ).map((event) => event.id);
    const expiredWhere: Record<string | symbol, unknown> = { expiresAt: { [Op.lt]: new Date() } };
    if (orgEventIds.length) expiredWhere.eventId = { [Op.notIn]: orgEventIds };
    let purged: number;
    do purged = await purgeEvidence(expiredWhere);
    while (purged === BATCH);
    counts.deleted = await purgeOldEvents(org.organizationId, cutoff);
    counts.processed = counts.deleted;

    const orgUsers = (await User.findAll({ where: { organizationId: org.organizationId }, attributes: ['id'], raw: true })).map((user) => user.id);
    if (orgUsers.length) {
      await Notification.destroy({ where: { userId: { [Op.in]: orgUsers }, createdAt: { [Op.lt]: daysAgo(settings.notificationDays) } } });
    }
    await AuditLog.destroy({ where: { organizationId: org.organizationId, createdAt: { [Op.lt]: daysAgo(settings.auditDays) } } });

    const deletedPeople = await RegisteredPerson.findAll({
      where: { organizationId: org.organizationId, deletedAt: { [Op.lt]: daysAgo(settings.deletedPersonPurgeDays) } },
      paranoid: false,
    });
    for (const person of deletedPeople) {
      await sequelize.transaction(async (transaction) => {
        await FaceTemplate.destroy({ where: { registeredPersonId: person.id }, transaction });
        const remaining = await FaceTemplate.count({ where: { registeredPersonId: person.id }, transaction });
        if (remaining !== 0) throw new Error(`Template purge verification failed for ${person.id}`);
        await person.destroy({ force: true, transaction });
        await audit(
          {
            organizationId: org.organizationId,
            action: 'BIOMETRIC_PURGE_VERIFIED',
            entityType: 'registered_person',
            entityId: person.id,
            metadata: { referenceId: person.referenceId, remainingTemplates: 0 },
          },
          transaction,
        );
      });
    }
  } catch (err) {
    counts.failed += 1;
    counts.error = (err as Error).message.slice(0, 500);
    logger.error({ err, organizationId: org.organizationId }, 'Retention batch failed');
  }
  counts.remaining = await DetectionEvent.count({ where: eligibleWhere(org.organizationId, cutoff) });
  await writeReport(org, startedAt, counts);
  return counts;
}

/** Applies each organization's retention policy inside its own database. Safe to run repeatedly. */
export async function runRetention() {
  const holds = new Set((await OrganizationHold.findAll({ where: { active: true }, attributes: ['organizationId'] })).map((hold) => hold.organizationId));
  const totals: Record<string, CleanupCounts> = {};
  const cleanedDatabases = new Set<string>();

  await forEachTenant(
    async (org) => {
      totals[org.organizationId] = await applyTenantRetention(org, holds.has(org.organizationId));
      const dbKey = org.database ?? '<primary>';
      if (!cleanedDatabases.has(dbKey)) {
        cleanedDatabases.add(dbKey);
        await RefreshToken.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: new Date() } }, { revokedAt: { [Op.lt]: daysAgo(7) } }] } });
        await PasswordResetToken.destroy({ where: { expiresAt: { [Op.lt]: daysAgo(1) } } });
      }
    },
    { statuses: [...PROVISIONED_STATUSES] },
  );

  logger.info({ organizations: Object.keys(totals).length }, 'Retention run complete');
  return totals;
}

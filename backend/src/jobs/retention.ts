import { Op } from 'sequelize';
import { logger } from '../config/logger';
import {
  AuditLog,
  DetectionEvent,
  EventEvidence,
  FaceTemplate,
  Notification,
  PasswordResetToken,
  RefreshToken,
  RegisteredPerson,
  User,
  sequelize,
} from '../models';
import { audit } from '../services/audit.service';
import { deleteEvidenceFile } from '../services/evidence.service';
import { getSettings } from '../services/settings.service';
import { forEachTenant, type TenantInfo } from '../services/tenancy.service';

const BATCH = 5000;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

async function purgeEvidence(where: Record<string | symbol, unknown>) {
  const rows = await EventEvidence.scope('withStorage').findAll({ where, limit: BATCH });
  for (const r of rows) {
    await deleteEvidenceFile(r.storageReference);
    await r.destroy();
  }
  return rows.length;
}

/**
 * Deletes detection events (and their evidence files) older than the retention window, in batches,
 * until none remain. The window is the organization setting capped by the platform limit.
 */
async function purgeOldEvents(organizationId: string, days: number) {
  let deleted = 0;
  for (;;) {
    const old = await DetectionEvent.findAll({
      where: { organizationId, eventTimestamp: { [Op.lt]: daysAgo(days) } },
      attributes: ['id'],
      limit: BATCH,
    });
    if (!old.length) return deleted;
    const ids = old.map((e) => e.id);
    let purged: number;
    do purged = await purgeEvidence({ eventId: { [Op.in]: ids } });
    while (purged === BATCH);
    deleted += await DetectionEvent.destroy({ where: { id: { [Op.in]: ids } } });
    if (old.length < BATCH) return deleted;
  }
}

async function applyTenantRetention(org: TenantInfo) {
  const r = (await getSettings(org.organizationId)).retention;
  const counts: Record<string, number> = {};

  const orgEventIds = (await DetectionEvent.findAll({ where: { organizationId: org.organizationId }, attributes: ['id'], raw: true })).map((e) => e.id);
  counts.evidenceExpired = orgEventIds.length
    ? await purgeEvidence({ eventId: { [Op.in]: orgEventIds }, expiresAt: { [Op.lt]: new Date() } })
    : 0;

  counts.eventsDeleted = await purgeOldEvents(org.organizationId, r.eventDays);

  const orgUsers = (await User.findAll({ where: { organizationId: org.organizationId }, attributes: ['id'], raw: true })).map((u) => u.id);
  if (orgUsers.length) {
    counts.notificationsDeleted = await Notification.destroy({ where: { userId: { [Op.in]: orgUsers }, createdAt: { [Op.lt]: daysAgo(r.notificationDays) } } });
  }
  counts.auditDeleted = await AuditLog.destroy({ where: { organizationId: org.organizationId, createdAt: { [Op.lt]: daysAgo(r.auditDays) } } });

  // Verified biometric purge of soft-deleted registrations.
  const deleted = await RegisteredPerson.findAll({
    where: { organizationId: org.organizationId, deletedAt: { [Op.lt]: daysAgo(r.deletedPersonPurgeDays) } },
    paranoid: false,
  });
  counts.personsPurged = 0;
  for (const p of deleted) {
    await sequelize.transaction(async (transaction) => {
      await FaceTemplate.destroy({ where: { registeredPersonId: p.id }, transaction });
      const remaining = await FaceTemplate.count({ where: { registeredPersonId: p.id }, transaction });
      if (remaining !== 0) throw new Error(`Template purge verification failed for ${p.id}`);
      await p.destroy({ force: true, transaction });
      await audit(
        { organizationId: org.organizationId, action: 'BIOMETRIC_PURGE_VERIFIED', entityType: 'registered_person', entityId: p.id, metadata: { referenceId: p.referenceId, remainingTemplates: 0 } },
        transaction,
      );
    });
    counts.personsPurged++;
  }

  if (Object.values(counts).some((v) => v > 0)) {
    await audit({ organizationId: org.organizationId, action: 'RETENTION_RUN', entityType: 'system', metadata: { ...counts, eventDays: r.eventDays, platformLimitDays: org.detectionRetentionDays } });
  }
  return counts;
}

/** Applies each organization's retention policy inside its own database. Safe to run repeatedly. */
export async function runRetention() {
  const totals: Record<string, Record<string, number>> = {};
  const cleanedDatabases = new Set<string>();

  await forEachTenant(
    async (org) => {
      totals[org.organizationId] = await applyTenantRetention(org);
      const dbKey = org.database ?? '<primary>';
      if (!cleanedDatabases.has(dbKey)) {
        cleanedDatabases.add(dbKey);
        await RefreshToken.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: new Date() } }, { revokedAt: { [Op.lt]: daysAgo(7) } }] } });
        await PasswordResetToken.destroy({ where: { expiresAt: { [Op.lt]: daysAgo(1) } } });
      }
    },
    { statuses: ['ACTIVE', 'SUSPENDED'] },
  );

  logger.info({ totals }, 'Retention run complete');
  return totals;
}

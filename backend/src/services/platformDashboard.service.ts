import { Op } from 'sequelize';
import { Organization, PlatformAuditLog } from '../models';
import type { OrganizationStatus } from '../models/Organization';
import { runInTenant } from './tenancy.service';
import { organizationStorageBytes } from './storageUsage.service';
import { Camera, DetectionEvent } from '../models';
import { nextRetentionRun } from '../utils/retentionPolicy';
import { logger } from '../config/logger';

const READABLE: OrganizationStatus[] = ['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED'];

export async function platformDashboard(range: { from: Date; to: Date }) {
  const orgs = await Organization.findAll({ order: [['createdAt', 'DESC']] });
  const byStatus: Record<string, number> = {};
  for (const org of orgs) byStatus[org.status] = (byStatus[org.status] ?? 0) + 1;

  let cameras = 0;
  let camerasOnline = 0;
  let detections = 0;
  let detectionsInRange = 0;
  const storage: Array<{ id: string; name: string; usedBytes: number; limitBytes: number | null; cameraCount: number; cameraLimit: number | null; approaching: boolean }> = [];

  for (const org of orgs) {
    if (!READABLE.includes(org.status)) continue;
    try {
      const usedBytes = await organizationStorageBytes(org.id);
      const counts = await runInTenant(org.id, async () => {
        const [cameraCount, online, events, inRange] = await Promise.all([
          Camera.count({ where: { organizationId: org.id } }),
          Camera.count({ where: { organizationId: org.id, status: 'ONLINE' } }),
          DetectionEvent.count({ where: { organizationId: org.id } }),
          DetectionEvent.count({ where: { organizationId: org.id, eventTimestamp: { [Op.gte]: range.from, [Op.lte]: range.to } } }),
        ]);
        return { cameraCount, online, events, inRange };
      });
      cameras += counts.cameraCount;
      camerasOnline += counts.online;
      detections += counts.events;
      detectionsInRange += counts.inRange;
      const storagePressure = org.storageLimitBytes != null && org.storageLimitBytes > 0 && usedBytes / org.storageLimitBytes >= 0.8;
      const cameraPressure = org.cameraLimit != null && org.cameraLimit > 0 && counts.cameraCount / org.cameraLimit >= 0.8;
      storage.push({
        id: org.id,
        name: org.name,
        usedBytes,
        limitBytes: org.storageLimitBytes ?? null,
        cameraCount: counts.cameraCount,
        cameraLimit: org.cameraLimit ?? null,
        approaching: storagePressure || cameraPressure,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, organizationId: org.id }, 'Dashboard could not read organization');
    }
  }

  const recentActivity = await PlatformAuditLog.findAll({
    where: { createdAt: { [Op.gte]: range.from, [Op.lte]: range.to } },
    order: [['createdAt', 'DESC']],
    limit: 12,
  });

  return {
    generatedAt: new Date().toISOString(),
    nextCleanupAt: nextRetentionRun().toISOString(),
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    organizations: {
      total: orgs.length,
      active: byStatus.ACTIVE ?? 0,
      suspended: byStatus.SUSPENDED ?? 0,
      onHold: byStatus.ON_HOLD ?? 0,
      pending: (byStatus.PENDING ?? 0) + (byStatus.PROVISIONING ?? 0),
      failed: byStatus.FAILED ?? 0,
      deactivated: byStatus.DEACTIVATED ?? 0,
      archived: byStatus.ARCHIVED ?? 0,
      byStatus,
      registeredInRange: orgs.filter((org) => org.createdAt >= range.from && org.createdAt <= range.to).length,
    },
    cameras: { total: cameras, online: camerasOnline, offline: cameras - camerasOnline },
    detections: { total: detections, inRange: detectionsInRange },
    storage: storage.sort((a, b) => b.usedBytes - a.usedBytes),
    approachingLimits: storage.filter((row) => row.approaching),
    recentOrganizations: orgs.slice(0, 8).map((org) => ({
      id: org.id,
      name: org.name,
      code: org.code,
      status: org.status,
      subscriptionPlan: org.subscriptionPlan,
      createdAt: org.createdAt,
    })),
    recentActivity: recentActivity.map((row) => row.get({ plain: true })),
  };
}

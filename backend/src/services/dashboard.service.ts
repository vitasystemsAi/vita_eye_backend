import { Op, QueryTypes } from 'sequelize';
import { AuditLog, Camera, DetectionEvent, Notification, RegisteredPerson, User, sequelize } from '../models';
import { tenantTable } from '../db/tenantContext';
import { presentEventSummary } from './detections.service';
import { cameraScopeWhere } from './scope';
import type { AuthContext } from '../types/auth';
import { EventEvidence } from '../models';

/** "+05:30" style offset for MySQL CONVERT_TZ from minutes east of UTC. */
export function tzOffsetString(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function startOfLocalDay(tzOffsetMin: number, daysAgo = 0): Date {
  const nowLocal = new Date(Date.now() + tzOffsetMin * 60_000);
  const localMidnight = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() - daysAgo);
  return new Date(localMidnight - tzOffsetMin * 60_000);
}

async function scopedCameraIds(ctx: AuthContext): Promise<string[] | null> {
  if (!ctx.siteScope) return null;
  return (await Camera.findAll({ where: cameraScopeWhere(ctx), attributes: ['id'] })).map((c) => c.id);
}

export async function summary(ctx: AuthContext, tzOffsetMin: number) {
  const org = ctx.organizationId;
  const camIds = await scopedCameraIds(ctx);
  const eventWhere = { organizationId: org, ...(camIds ? { cameraId: { [Op.in]: camIds } } : {}) };
  const today = startOfLocalDay(tzOffsetMin);

  const [persons, enrolled, cameras, todayByType, uncertainPending, unresolved, unread] = await Promise.all([
    RegisteredPerson.count({ where: { organizationId: org, status: 'ACTIVE' } }),
    RegisteredPerson.count({ where: { organizationId: org, status: 'ACTIVE', enrollmentStatus: 'ENROLLED' } }),
    Camera.findAll({ where: cameraScopeWhere(ctx), attributes: ['status', 'isActive', 'monitoringEnabled'] }),
    DetectionEvent.findAll({
      where: { ...eventWhere, eventTimestamp: { [Op.gte]: today } },
      attributes: ['eventType', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      group: ['eventType'],
      raw: true,
    }) as unknown as Promise<Array<{ eventType: string; n: number }>>,
    DetectionEvent.count({ where: { ...eventWhere, eventType: 'UNCERTAIN', reviewStatus: { [Op.ne]: 'RESOLVED' } } }),
    DetectionEvent.count({ where: { ...eventWhere, eventType: { [Op.in]: ['UNKNOWN', 'UNCERTAIN'] }, reviewStatus: { [Op.ne]: 'RESOLVED' } } }),
    Notification.count({ where: { userId: ctx.userId, channel: 'IN_APP', readAt: null } }),
  ]);

  const byType = Object.fromEntries(todayByType.map((r) => [r.eventType, Number(r.n)]));
  const active = cameras.filter((c) => c.isActive);
  return {
    registeredPersons: persons,
    enrolledPersons: enrolled,
    activeCameras: active.length,
    onlineCameras: active.filter((c) => c.status === 'ONLINE').length,
    offlineCameras: active.filter((c) => c.status === 'OFFLINE').length,
    errorCameras: active.filter((c) => c.status === 'ERROR').length,
    monitoringCameras: active.filter((c) => c.monitoringEnabled).length,
    today: {
      total: (byType.KNOWN ?? 0) + (byType.UNKNOWN ?? 0) + (byType.UNCERTAIN ?? 0),
      known: byType.KNOWN ?? 0,
      unknown: byType.UNKNOWN ?? 0,
      uncertain: byType.UNCERTAIN ?? 0,
    },
    uncertainPendingReview: uncertainPending,
    unresolvedAlerts: unresolved,
    unreadNotifications: unread,
    generatedAt: new Date(),
  };
}

export async function trends(ctx: AuthContext, days: number, tzOffsetMin: number) {
  const offset = tzOffsetString(tzOffsetMin);
  const from = startOfLocalDay(tzOffsetMin, days - 1);
  const camIds = await scopedCameraIds(ctx);
  if (camIds && !camIds.length) return { days: [], cameras: [], hourly: [] };

  const camFilter = camIds ? 'AND camera_id IN (:camIds)' : '';
  const daily = await sequelize.query<{ day: string; event_type: string; n: number }>(
    `SELECT DATE_FORMAT(CONVERT_TZ(event_timestamp, '+00:00', :offset), '%Y-%m-%d') AS day, event_type, COUNT(*) AS n
       FROM ${tenantTable('detection_events')}
      WHERE organization_id = :org AND event_timestamp >= :from ${camFilter}
      GROUP BY day, event_type ORDER BY day`,
    { replacements: { offset, org: ctx.organizationId, from, camIds }, type: QueryTypes.SELECT },
  );
  const today = startOfLocalDay(tzOffsetMin);
  const hourly = await sequelize.query<{ hour: number; event_type: string; n: number }>(
    `SELECT HOUR(CONVERT_TZ(event_timestamp, '+00:00', :offset)) AS hour, event_type, COUNT(*) AS n
       FROM ${tenantTable('detection_events')}
      WHERE organization_id = :org AND event_timestamp >= :today ${camFilter}
      GROUP BY hour, event_type ORDER BY hour`,
    { replacements: { offset, org: ctx.organizationId, today, camIds }, type: QueryTypes.SELECT },
  );

  const series = new Map<string, { date: string; known: number; unknown: number; uncertain: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfLocalDay(tzOffsetMin, i).getTime() + tzOffsetMin * 60_000).toISOString().slice(0, 10);
    series.set(d, { date: d, known: 0, unknown: 0, uncertain: 0 });
  }
  for (const r of daily) {
    const s = series.get(r.day);
    if (s) s[r.event_type.toLowerCase() as 'known' | 'unknown' | 'uncertain'] = Number(r.n);
  }
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, known: 0, unknown: 0, uncertain: 0 }));
  for (const r of hourly) hours[Number(r.hour)][r.event_type.toLowerCase() as 'known' | 'unknown' | 'uncertain'] = Number(r.n);

  const cameras = await Camera.findAll({ where: cameraScopeWhere(ctx), order: [['cameraName', 'ASC']] });
  const camCounts = (await DetectionEvent.findAll({
    where: { organizationId: ctx.organizationId, eventTimestamp: { [Op.gte]: today } },
    attributes: ['cameraId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['cameraId'],
    raw: true,
  })) as unknown as Array<{ cameraId: string; n: number }>;
  const countMap = new Map(camCounts.map((c) => [c.cameraId, Number(c.n)]));

  return {
    days: [...series.values()],
    hourly: hours,
    cameras: cameras.map((c) => ({
      id: c.id,
      name: c.cameraName,
      location: c.location,
      site: c.site,
      type: c.cameraType,
      status: c.status,
      isActive: c.isActive,
      monitoringEnabled: c.monitoringEnabled,
      lastConnectedAt: c.lastConnectedAt,
      lastError: c.lastError,
      eventsToday: countMap.get(c.id) ?? 0,
    })),
  };
}

export async function activity(ctx: AuthContext, limit = 12) {
  const events = await DetectionEvent.findAll({
    where: { organizationId: ctx.organizationId },
    include: [
      { model: Camera, as: 'camera', where: cameraScopeWhere(ctx), required: true, paranoid: false },
      { model: RegisteredPerson, as: 'person', paranoid: false },
      { model: EventEvidence, as: 'evidence', attributes: ['id', 'evidenceType', 'expiresAt'] },
    ],
    order: [['eventTimestamp', 'DESC']],
    limit,
  });
  const audits = ctx.permissions.has('audit:view')
    ? await AuditLog.findAll({
        where: { organizationId: ctx.organizationId, action: { [Op.notIn]: ['LOGIN_SUCCESS', 'LOGOUT', 'EVIDENCE_URL_ISSUED'] } },
        include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
        order: [['createdAt', 'DESC']],
        limit,
      })
    : [];
  const canSeePersons = ctx.permissions.has('persons:view');
  return {
    events: events.map((e) => {
      const s = presentEventSummary(e);
      return canSeePersons || !s.person ? s : { ...s, person: { ...s.person, name: 'Registered person', referenceId: '' } };
    }),
    audit: audits.map((a) => ({ id: String(a.id), action: a.action, entityType: a.entityType, entityId: a.entityId, createdAt: a.createdAt, user: a.user ? { id: a.user.id, name: a.user.name } : null })),
  };
}

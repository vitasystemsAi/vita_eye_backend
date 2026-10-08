import { Op, type WhereOptions } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { redis } from '../config/redis';
import { Camera, DetectionEvent, Notification, Role, User, UserDevice } from '../models';
import type { NotificationChannel } from '../models/Notification';
import { enqueueNotification } from '../jobs/queues';
import { emitToUser } from '../sockets/emitter';
import { AppError } from '../utils/errors';
import { pageMeta } from '../utils/http';
import { audit } from './audit.service';
import { emailConfigured } from './email.service';
import { pushUnavailableReason } from './push.service';
import { getSettings, updateSettings } from './settings.service';
import type { AuthContext } from '../types/auth';

export function eventLink(eventId: string) {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/events/${eventId}`;
}

function presentNotification(n: Notification) {
  return {
    id: n.id,
    eventId: n.eventId,
    channel: n.channel,
    title: n.title,
    message: n.message,
    deliveryStatus: n.deliveryStatus,
    attempts: n.attempts,
    lastError: n.lastError,
    sentAt: n.sentAt,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

async function recipientsFor(organizationId: string, roles: string[], site: string | null) {
  const users = await User.findAll({
    where: { organizationId, status: 'ACTIVE' },
    include: [{ model: Role, as: 'role', where: { name: { [Op.in]: roles } } }],
  });
  return users.filter((u) => !u.siteScope?.length || (site !== null && u.siteScope.includes(site)));
}

/** Initial state for non-in-app channels; unavailable providers are recorded honestly as SKIPPED. */
async function channelState(channel: NotificationChannel, userId: string): Promise<{ status: 'PENDING' | 'SKIPPED'; reason?: string }> {
  if (channel === 'EMAIL') {
    return emailConfigured() ? { status: 'PENDING' } : { status: 'SKIPPED', reason: 'SMTP not configured' };
  }
  if (channel === 'PUSH') {
    const reason = pushUnavailableReason();
    if (reason) return { status: 'SKIPPED', reason };
    const devices = await UserDevice.count({ where: { userId } });
    return devices ? { status: 'PENDING' } : { status: 'SKIPPED', reason: 'No registered push devices' };
  }
  return { status: 'PENDING' };
}

async function createAndDispatch(
  userIds: string[],
  eventId: string | null,
  channels: NotificationChannel[],
  title: string,
  message: string,
) {
  let created = 0;
  for (const userId of userIds) {
    for (const channel of channels) {
      const state = channel === 'IN_APP' ? { status: 'SENT' as const } : await channelState(channel, userId);
      let row: Notification;
      try {
        row = await Notification.create({
          userId,
          eventId,
          channel,
          title,
          message,
          deliveryStatus: state.status,
          lastError: 'reason' in state ? (state.reason ?? null) : null,
          sentAt: channel === 'IN_APP' ? new Date() : null,
          attempts: channel === 'IN_APP' ? 1 : 0,
        });
      } catch (err) {
        if ((err as Error).name === 'SequelizeUniqueConstraintError') continue; // already notified for this event
        throw err;
      }
      created++;
      if (channel === 'IN_APP') emitToUser(userId, 'notification:new', presentNotification(row));
      else if (row.deliveryStatus === 'PENDING') {
        await enqueueNotification(row.id).catch((e) =>
          logger.error({ err: (e as Error).message, notificationId: row.id }, 'Failed to enqueue notification (will remain PENDING)'),
        );
      }
    }
  }
  return created;
}

/**
 * Called after a detection event has been committed. Never throws: notification problems must
 * not affect the persisted event.
 */
export async function notifyForEvent(event: DetectionEvent, camera: Camera) {
  try {
    const settings = await getSettings(event.organizationId);
    const n = settings.notifications;
    const eligible = (event.eventType === 'UNKNOWN' && n.unknownAlerts) || (event.eventType === 'UNCERTAIN' && n.uncertainAlerts);
    if (!eligible) return;

    if (n.alertCooldownSec > 0) {
      const ok = await redis.set(`vita:alert:cooldown:${camera.id}:${event.eventType}`, event.id, 'EX', n.alertCooldownSec, 'NX');
      if (!ok) {
        logger.info({ eventId: event.id }, 'Alert suppressed by cooldown (event persisted)');
        return;
      }
    }

    const channels: NotificationChannel[] = [];
    if (n.channels.inApp) channels.push('IN_APP');
    if (n.channels.email) channels.push('EMAIL');
    if (n.channels.push) channels.push('PUSH');
    if (!channels.length) return;

    const recipients = await recipientsFor(event.organizationId, n.recipientRoles, camera.site);
    const label = event.eventType === 'UNKNOWN' ? 'Unknown person detected' : 'Uncertain detection requires review';
    const when = event.eventTimestamp.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const title = `${label} — ${camera.cameraName}`;
    const message = `${label} at ${camera.location}${camera.site ? ` (${camera.site})` : ''} on ${when}. Event ID: ${event.id}. Review: ${eventLink(event.id)}`;
    await createAndDispatch(recipients.map((u) => u.id), event.id, channels, title, message);
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Notification orchestration failed (event remains persisted)');
  }
}

export async function listMine(ctx: AuthContext, q: { page: number; pageSize: number; unread?: boolean }) {
  const where: WhereOptions<Notification> = { userId: ctx.userId, channel: 'IN_APP' };
  if (q.unread) Object.assign(where, { readAt: null });
  const [{ rows, count }, unread] = await Promise.all([
    Notification.findAndCountAll({ where, order: [['createdAt', 'DESC']], limit: q.pageSize, offset: (q.page - 1) * q.pageSize }),
    Notification.count({ where: { userId: ctx.userId, channel: 'IN_APP', readAt: null } }),
  ]);
  return { items: rows.map(presentNotification), meta: pageMeta(q.page, q.pageSize, count), unread };
}

export async function markRead(ctx: AuthContext, id: string) {
  const [n] = await Notification.update({ readAt: new Date() }, { where: { id, userId: ctx.userId, readAt: null } });
  if (!n && !(await Notification.findOne({ where: { id, userId: ctx.userId } }))) throw AppError.notFound('Notification');
}

export async function markAllRead(ctx: AuthContext) {
  const [n] = await Notification.update({ readAt: new Date() }, { where: { userId: ctx.userId, channel: 'IN_APP', readAt: null } });
  return n;
}

export async function deliveryLogs(
  ctx: AuthContext,
  q: { page: number; pageSize: number; channel?: NotificationChannel; status?: string; eventId?: string },
) {
  const where: WhereOptions<Notification> = {};
  if (q.channel) Object.assign(where, { channel: q.channel });
  if (q.status) Object.assign(where, { deliveryStatus: q.status });
  if (q.eventId) Object.assign(where, { eventId: q.eventId });
  const { rows, count } = await Notification.findAndCountAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'], where: { organizationId: ctx.organizationId } }],
    order: [['createdAt', 'DESC']],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  return {
    items: rows.map((n) => ({ ...presentNotification(n), recipient: n.user ? { id: n.user.id, name: n.user.name, email: n.user.email } : null })),
    meta: pageMeta(q.page, q.pageSize, count),
  };
}

export async function getNotificationSettings(ctx: AuthContext) {
  const s = await getSettings(ctx.organizationId);
  return {
    ...s.notifications,
    knownCooldownSec: s.events.knownCooldownSec,
    unknownCooldownSec: s.events.unknownCooldownSec,
    providers: { email: emailConfigured(), push: !pushUnavailableReason(), pushReason: pushUnavailableReason() },
  };
}

export async function patchNotificationSettings(
  ctx: AuthContext,
  patch: { knownCooldownSec?: number; unknownCooldownSec?: number } & Record<string, unknown>,
  ip: string | null,
) {
  const { knownCooldownSec, unknownCooldownSec, ...notifications } = patch;
  const events: Record<string, number> = {};
  if (knownCooldownSec !== undefined) events.knownCooldownSec = knownCooldownSec;
  if (unknownCooldownSec !== undefined) events.unknownCooldownSec = unknownCooldownSec;
  await updateSettings(ctx.organizationId, { notifications, events }, { userId: ctx.userId, ip }, 'NOTIFICATION_SETTINGS_UPDATED');
  return getNotificationSettings(ctx);
}

export async function sendTest(ctx: AuthContext, ip: string | null) {
  const s = await getSettings(ctx.organizationId);
  const channels: NotificationChannel[] = ['IN_APP'];
  if (s.notifications.channels.email) channels.push('EMAIL');
  if (s.notifications.channels.push) channels.push('PUSH');
  const ts = new Date();
  const created = await createAndDispatch(
    [ctx.userId],
    null,
    channels,
    'VITA EYE test notification',
    `This is a test notification requested by ${ctx.name} at ${ts.toISOString()}. No detection event is associated with it.`,
  );
  await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'NOTIFICATION_TEST_SENT', entityType: 'notification', ipAddress: ip, metadata: { channels } });
  const rows = await Notification.findAll({ where: { userId: ctx.userId, eventId: null, createdAt: { [Op.gte]: new Date(ts.getTime() - 1000) } }, order: [['createdAt', 'DESC']], limit: channels.length });
  return { created, notifications: rows.map(presentNotification) };
}

export async function registerDevice(ctx: AuthContext, token: string, userAgent: string | null) {
  const existing = await UserDevice.findOne({ where: { fcmToken: token } });
  if (existing) {
    await existing.update({ userId: ctx.userId, userAgent: userAgent?.slice(0, 255) ?? null });
    return;
  }
  await UserDevice.create({ userId: ctx.userId, fcmToken: token, userAgent: userAgent?.slice(0, 255) ?? null });
}

export { presentNotification };

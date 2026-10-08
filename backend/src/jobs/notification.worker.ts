import { Worker, type Job } from 'bullmq';
import { bullConnection } from '../config/redis';
import { logger } from '../config/logger';
import { Notification, User } from '../models';
import { NOTIFICATION_QUEUE } from './queues';
import { escapeHtml, sendEmail } from '../services/email.service';
import { sendPushToUser } from '../services/push.service';
import { eventLink } from '../services/notifications.service';
import { runInTenant } from '../services/tenancy.service';

type DeliverJob = Job<{ notificationId: string; organizationId?: string | null }>;

function deliverInTenant(job: DeliverJob) {
  return runInTenant(job.data.organizationId ?? null, () => deliver(job));
}

async function deliver(job: DeliverJob) {
  const n = await Notification.findByPk(job.data.notificationId, { include: [{ model: User, as: 'user' }] });
  if (!n || n.deliveryStatus === 'SENT' || n.deliveryStatus === 'SKIPPED') return;
  if (!n.user || n.user.status !== 'ACTIVE') {
    await n.update({ deliveryStatus: 'SKIPPED', lastError: 'Recipient inactive' });
    return;
  }

  await n.update({ attempts: n.attempts + 1 });
  try {
    if (n.channel === 'EMAIL') {
      const link = n.eventId ? eventLink(n.eventId) : null;
      await sendEmail(
        n.user.email,
        n.title,
        n.message,
        `<div style="font-family:Arial,sans-serif"><h2 style="color:#0f172a">${escapeHtml(n.title)}</h2><p>${escapeHtml(n.message)}</p>${
          link ? `<p><a href="${escapeHtml(link)}">Open the event in VITA EYE</a> (sign-in required)</p>` : ''
        }<p style="color:#64748b;font-size:12px">This alert is decision support only. Verify before taking any action.</p></div>`,
      );
    } else if (n.channel === 'PUSH') {
      const delivered = await sendPushToUser(n.user.id, n.title, n.message.slice(0, 180), {
        notificationId: n.id,
        eventId: n.eventId ?? '',
        link: n.eventId ? eventLink(n.eventId) : '',
      });
      if (delivered === 0) {
        await n.update({ deliveryStatus: 'SKIPPED', lastError: 'No valid push devices' });
        return;
      }
    }
    await n.update({ deliveryStatus: 'SENT', sentAt: new Date(), lastError: null });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await n.update({ lastError: message, deliveryStatus: finalAttempt ? 'FAILED' : 'PENDING' });
    throw err;
  }
}

export function startNotificationWorker() {
  const worker = new Worker(NOTIFICATION_QUEUE, deliverInTenant, { connection: bullConnection(), concurrency: 5 });
  worker.on('failed', (job, err) =>
    logger.warn({ notificationId: job?.data.notificationId, attempt: job?.attemptsMade, err: err.message }, 'Notification delivery attempt failed'),
  );
  return worker;
}

import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis';
import { currentTenant } from '../db/tenantContext';

export const NOTIFICATION_QUEUE = 'vita-notifications';
export const MAINTENANCE_QUEUE = 'vita-maintenance';

let notificationQueue: Queue | null = null;
let maintenanceQueue: Queue | null = null;

export function getNotificationQueue(): Queue {
  notificationQueue ??= new Queue(NOTIFICATION_QUEUE, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 6,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 5000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return notificationQueue;
}

export function getMaintenanceQueue(): Queue {
  maintenanceQueue ??= new Queue(MAINTENANCE_QUEUE, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 },
  });
  return maintenanceQueue;
}

/**
 * Notification jobs use the notification id as jobId, so the same alert is never queued twice.
 * The organization travels with the job so the worker reads the right tenant database.
 */
export async function enqueueNotification(notificationId: string) {
  const organizationId = currentTenant()?.organizationId ?? null;
  await getNotificationQueue().add('deliver', { notificationId, organizationId }, { jobId: `n-${notificationId}` });
}

export async function scheduleMaintenance() {
  const q = getMaintenanceQueue();
  await q.upsertJobScheduler('camera-health', { every: 30_000 }, { name: 'camera-health' });
  // Hourly, so a day of detection history disappears soon after it passes the retention limit.
  await q.upsertJobScheduler('retention', { pattern: '15 * * * *' }, { name: 'retention' });
}

export async function queueStats() {
  const [n, m] = await Promise.all([
    getNotificationQueue().getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
    getMaintenanceQueue().getJobCounts('waiting', 'active', 'delayed', 'failed'),
  ]);
  return { notifications: n, maintenance: m };
}

export async function closeQueues() {
  await Promise.all([notificationQueue?.close(), maintenanceQueue?.close()]);
}

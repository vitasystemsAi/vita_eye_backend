import { Worker } from 'bullmq';
import { bullConnection } from '../config/redis';
import { logger } from '../config/logger';
import { MAINTENANCE_QUEUE } from './queues';
import { runRetention } from './retention';
import { reconcileCameras } from '../services/ingestion.service';

export function startMaintenanceWorker() {
  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === 'camera-health') return reconcileCameras();
      if (job.name === 'retention') return runRetention();
      return undefined;
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'Maintenance job failed'));
  return worker;
}

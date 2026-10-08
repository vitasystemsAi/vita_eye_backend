import http from 'node:http';
import fs from 'node:fs/promises';
import { env } from './config/env';
import { logger } from './config/logger';
import { redis } from './config/redis';
import { sequelize } from './models';
import { createApp } from './app';
import { createSocketServer } from './sockets';
import { closeQueues, scheduleMaintenance } from './jobs/queues';
import { startNotificationWorker } from './jobs/notification.worker';
import { startMaintenanceWorker } from './jobs/maintenance.worker';

async function main() {
  await sequelize.authenticate();
  await redis.ping();
  const version = /redis_version:(\d+)\.(\d+)/.exec(await redis.info('server'));
  if (version && (Number(version[1]) < 6 || (Number(version[1]) === 6 && Number(version[2]) < 2))) {
    throw new Error(`Redis ${version[1]}.${version[2]} detected at REDIS_URL; VITA EYE requires Redis >= 6.2 (BullMQ). See README "Redis on Windows".`);
  }
  await fs.mkdir(env.evidenceDir, { recursive: true });

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  const workers = [startNotificationWorker(), startMaintenanceWorker()];
  await scheduleMaintenance();

  server.listen(env.BACKEND_PORT, env.BACKEND_HOST, () => logger.info(`VITA EYE API listening on http://${env.BACKEND_HOST}:${env.BACKEND_PORT}`));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    io.close();
    server.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await sequelize.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start VITA EYE API');
  process.exit(1);
});

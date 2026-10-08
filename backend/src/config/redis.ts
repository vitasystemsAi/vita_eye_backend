import { Redis } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err) => logger.error({ err: err.message }, 'Redis connection error'));

/** Connection options for BullMQ (each queue/worker needs its own connection). */
export function bullConnection() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redis } from '../config/redis';
import { env } from '../config/env';

function store(prefix: string) {
  if (env.isTest) return undefined;
  return new RedisStore({
    prefix: `vita:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

const handler: Options['handler'] = (_req, res) => {
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } });
};

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: store('api'),
  handler,
});

/** Brute-force protection for credential endpoints (complements per-account lockout). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: store('auth'),
  handler,
});

export const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: store('sensitive'),
  handler,
});

import type { Request, Response } from 'express';
import { sequelize } from '../models';
import { redis } from '../config/redis';
import { ok } from '../utils/http';
import { aiHealth } from '../services/ai.client';
import { emailConfigured } from '../services/email.service';
import { pushConfigured } from '../services/push.service';
import { queueStats } from '../jobs/queues';
import { env } from '../config/env';

const startedAt = new Date();

async function check<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; detail?: T; error?: string }> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - t, detail };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: (err as Error).message };
  }
}

export async function liveness(_req: Request, res: Response) {
  const [db, cache] = await Promise.all([check(() => sequelize.authenticate()), check(() => redis.ping())]);
  const healthy = db.ok && cache.ok;
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: { status: healthy ? 'ok' : 'degraded', service: 'vita-eye-backend', uptimeSec: Math.round(process.uptime()) },
  });
}

export async function details(_req: Request, res: Response) {
  const [db, cache, ai, queues] = await Promise.all([
    check(async () => {
      const [[row]] = (await sequelize.query('SELECT VERSION() AS version')) as [Array<{ version: string }>, unknown];
      return { version: row.version };
    }),
    check(() => redis.ping()),
    check(() => aiHealth()),
    check(() => queueStats()),
  ]);
  ok(res, {
    startedAt,
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    environment: env.NODE_ENV,
    database: db,
    redis: cache,
    aiService: ai,
    queues,
    notifications: { email: emailConfigured(), push: pushConfigured() },
  });
}

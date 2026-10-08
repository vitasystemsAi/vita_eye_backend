import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import { aiHealth } from '../services/ai.client';
import { getSettings, updateSettings } from '../services/settings.service';
import { clientIp, ok } from '../utils/http';
import { AppError } from '../utils/errors';
import { DEFAULT_SETTINGS } from '../config/defaultSettings';

export async function get(req: Request, res: Response) {
  const ctx = authOf(req);
  const settings = await getSettings(ctx.organizationId);
  let model: unknown = null;
  try {
    const h = await aiHealth();
    model = { status: h.status, version: h.modelVersion, models: h.models };
  } catch (err) {
    model = { status: 'unavailable', error: (err as Error).message };
  }
  ok(res, { settings, defaults: DEFAULT_SETTINGS, model });
}

export async function patch(req: Request, res: Response) {
  const ctx = authOf(req);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw AppError.badRequest('Expected a settings object');
  const allowed = ['recognition', 'events', 'notifications', 'retention'];
  const unknown = Object.keys(req.body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw AppError.validation(unknown.map((k) => ({ path: k, message: 'Unknown settings section' })));
  const settings = await updateSettings(ctx.organizationId, req.body, { userId: ctx.userId, ip: clientIp(req) });
  ok(res, { settings });
}

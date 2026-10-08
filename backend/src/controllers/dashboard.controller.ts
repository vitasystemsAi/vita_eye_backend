import type { Request, Response } from 'express';
import { z } from 'zod';
import { authOf } from '../middleware/auth';
import * as dashboard from '../services/dashboard.service';
import { parse } from '../utils/errors';
import { ok } from '../utils/http';

const tz = z.coerce.number().int().min(-720).max(840).default(0);

export async function summary(req: Request, res: Response) {
  const { tzOffset } = parse(z.object({ tzOffset: tz }), req.query);
  ok(res, await dashboard.summary(authOf(req), tzOffset));
}

export async function trends(req: Request, res: Response) {
  const { days, tzOffset } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7), tzOffset: tz }), req.query);
  ok(res, await dashboard.trends(authOf(req), days, tzOffset));
}

export async function activity(req: Request, res: Response) {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }), req.query);
  ok(res, await dashboard.activity(authOf(req), limit));
}

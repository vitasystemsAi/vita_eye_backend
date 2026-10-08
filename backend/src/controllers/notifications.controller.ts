import type { Request, Response } from 'express';
import { z } from 'zod';
import { authOf } from '../middleware/auth';
import * as notifications from '../services/notifications.service';
import { parse } from '../utils/errors';
import { clientIp, ok, paginationSchema } from '../utils/http';
import { idParam } from '../validators/users.validators';
import { ROLE_NAMES } from '../config/rbac';

const listSchema = paginationSchema.extend({ unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });
const logsSchema = paginationSchema.extend({
  channel: z.enum(['IN_APP', 'EMAIL', 'PUSH']).optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  eventId: z.string().uuid().optional(),
});
const settingsPatch = z
  .object({
    unknownAlerts: z.boolean().optional(),
    uncertainAlerts: z.boolean().optional(),
    channels: z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() }).partial().optional(),
    recipientRoles: z.array(z.enum(ROLE_NAMES)).min(1).optional(),
    alertCooldownSec: z.number().int().min(0).max(86400).optional(),
    knownCooldownSec: z.number().int().min(0).max(86400).optional(),
    unknownCooldownSec: z.number().int().min(0).max(86400).optional(),
  })
  .strict();

export async function list(req: Request, res: Response) {
  const result = await notifications.listMine(authOf(req), parse(listSchema, req.query));
  res.json({ success: true, data: result.items, meta: result.meta, unread: result.unread });
}

export async function read(req: Request, res: Response) {
  await notifications.markRead(authOf(req), parse(idParam, req.params).id);
  ok(res, { read: true });
}

export async function readAll(req: Request, res: Response) {
  ok(res, { updated: await notifications.markAllRead(authOf(req)) });
}

export async function getSettings(req: Request, res: Response) {
  ok(res, await notifications.getNotificationSettings(authOf(req)));
}

export async function patchSettings(req: Request, res: Response) {
  ok(res, await notifications.patchNotificationSettings(authOf(req), parse(settingsPatch, req.body), clientIp(req)));
}

export async function logs(req: Request, res: Response) {
  const { items, meta } = await notifications.deliveryLogs(authOf(req), parse(logsSchema, req.query));
  ok(res, items, meta);
}

export async function test(req: Request, res: Response) {
  ok(res, await notifications.sendTest(authOf(req), clientIp(req)));
}

export async function registerDevice(req: Request, res: Response) {
  const { token } = parse(z.object({ token: z.string().min(20).max(512) }), req.body);
  await notifications.registerDevice(authOf(req), token, req.get('user-agent') ?? null);
  ok(res, { registered: true });
}

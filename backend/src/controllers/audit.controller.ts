import type { Request, Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { authOf } from '../middleware/auth';
import { AuditLog, User } from '../models';
import { parse } from '../utils/errors';
import { ok, pageMeta, paginationSchema } from '../utils/http';

const listSchema = paginationSchema.extend({
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  userId: z.string().uuid().optional(),
  category: z.enum(['auth', 'biometric', 'evidence', 'admin', 'events', 'cameras']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const CATEGORY_ACTIONS: Record<string, string[]> = {
  auth: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'LOGOUT', 'LOGIN_BLOCKED_LOCKED', 'LOGIN_BLOCKED_DISABLED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'REFRESH_TOKEN_REUSE'],
  biometric: ['PERSON_ENROLLED', 'ENROLLMENT_FAILED', 'BIOMETRIC_TEMPLATES_DELETED', 'PERSON_DELETED', 'REGISTRATION_CANCELLED', 'BIOMETRIC_PURGE_VERIFIED', 'PERSON_DEACTIVATED', 'PERSON_SUSPENDED', 'PERSON_ACTIVATED', 'PERSON_RETRIEVED', 'PERSON_CREATED', 'PERSON_UPDATED'],
  evidence: ['EVIDENCE_URL_ISSUED', 'EVIDENCE_ACCESSED', 'EVENTS_EXPORTED', 'EVIDENCE_PURGED'],
  admin: ['USER_CREATED', 'USER_UPDATED', 'USER_SEEDED', 'SETTINGS_UPDATED', 'NOTIFICATION_SETTINGS_UPDATED', 'NOTIFICATION_TEST_SENT', 'RETENTION_RUN'],
  events: ['EVENT_ACKNOWLEDGED', 'EVENT_INVESTIGATING', 'EVENT_RESOLVED', 'EVENT_REOPENED', 'EVENT_NOTE_ADDED'],
  cameras: ['CAMERA_CREATED', 'CAMERA_UPDATED', 'CAMERA_DELETED', 'CAMERA_TESTED', 'MONITORING_STARTED', 'MONITORING_STOPPED'],
};

export async function list(req: Request, res: Response) {
  const ctx = authOf(req);
  const q = parse(listSchema, req.query);
  const where: WhereOptions<AuditLog> = { organizationId: ctx.organizationId };
  if (q.action) Object.assign(where, { action: q.action });
  else if (q.category) Object.assign(where, { action: { [Op.in]: CATEGORY_ACTIONS[q.category] } });
  if (q.entityType) Object.assign(where, { entityType: q.entityType });
  if (q.entityId) Object.assign(where, { entityId: q.entityId });
  if (q.userId) Object.assign(where, { userId: q.userId });
  if (q.from || q.to) {
    Object.assign(where, { createdAt: { ...(q.from ? { [Op.gte]: q.from } : {}), ...(q.to ? { [Op.lte]: q.to } : {}) } });
  }
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    order: [['createdAt', q.order], ['id', q.order]],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  ok(
    res,
    rows.map((r) => ({
      id: String(r.id),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
      metadata: r.metadata,
      createdAt: r.createdAt,
      user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email } : null,
    })),
    pageMeta(q.page, q.pageSize, count),
  );
}

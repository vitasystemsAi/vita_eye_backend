import type { Request, Response } from 'express';
import { env } from '../config/env';
import { parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from '../validators/auth.validators';
import {
  accountSchema,
  auditQuerySchema,
  dashboardQuerySchema,
  detectionQuerySchema,
  holdIdParam,
  impersonateSchema,
  listClientsSchema,
  orgIdParam,
  registerOrganizationSchema,
  resetClientPasswordSchema,
  updateOrganizationSchema,
} from '../validators/platform.validators';
import * as platformAuth from '../services/platformAuth.service';
import * as clients from '../services/platformClients.service';
import { platformDashboard } from '../services/platformDashboard.service';
import { clearPlatformCookie, platformAdminOf, setPlatformCookie } from '../middleware/platformAuth';
import { setSessionCookies } from '../middleware/auth';

const actor = (req: Request) => ({ admin: platformAdminOf(req), ip: clientIp(req), userAgent: req.get('user-agent') ?? null });
const idOf = (req: Request) => parse(orgIdParam, req.params).id;

export async function login(req: Request, res: Response) {
  const { email, password } = parse(loginSchema, req.body);
  const result = await platformAuth.platformLogin(email, password, clientIp(req));
  setPlatformCookie(res, result.token);
  ok(res, { admin: result.admin });
}

export async function logout(req: Request, res: Response) {
  if (req.platformAdmin) await platformAuth.platformLogout(req.platformAdmin.id, clientIp(req));
  clearPlatformCookie(res);
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  ok(res, { admin: platformAdminOf(req) });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = parse(forgotPasswordSchema, req.body);
  const result = await platformAuth.requestPlatformPasswordReset(email, clientIp(req));
  ok(res, {
    message: 'If an account exists for that email, a reset link has been sent.',
    ...(result.devLink && !env.isProduction ? { devLink: result.devLink } : {}),
  });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = parse(resetPasswordSchema, req.body);
  await platformAuth.resetPlatformPassword(token, password, clientIp(req));
  ok(res, { message: 'Password updated. Please sign in.' });
}

export async function features(_req: Request, res: Response) {
  ok(res, clients.featureCatalog());
}

export async function plans(_req: Request, res: Response) {
  ok(res, clients.subscriptionPlans());
}

export async function dashboard(req: Request, res: Response) {
  const query = parse(dashboardQuerySchema, req.query);
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86400_000);
  ok(res, await platformDashboard({ from, to }));
}

export async function listClients(req: Request, res: Response) {
  const query = parse(listClientsSchema, req.query);
  const result = await clients.listClients(query);
  ok(res, result.rows, result.meta);
}

export async function getClient(req: Request, res: Response) {
  ok(res, await clients.getClient(idOf(req)));
}

export async function detections(req: Request, res: Response) {
  const query = parse(detectionQuerySchema, req.query);
  const result = await clients.listClientDetections(idOf(req), query);
  ok(res, result.rows, result.meta);
}

export async function register(req: Request, res: Response) {
  const input = parse(registerOrganizationSchema, req.body);
  created(res, await clients.registerOrganization(input, actor(req)));
}

export async function retry(req: Request, res: Response) {
  ok(res, await clients.retryProvisioning(idOf(req), actor(req)));
}

export async function update(req: Request, res: Response) {
  const input = parse(updateOrganizationSchema, req.body);
  ok(res, await clients.updateOrganization(idOf(req), input, actor(req)));
}

export async function account(req: Request, res: Response) {
  const input = parse(accountSchema, req.body);
  ok(res, await clients.setAccountStatus(idOf(req), input, actor(req)));
}

export async function releaseHold(req: Request, res: Response) {
  const { holdId } = parse(holdIdParam, req.params);
  ok(res, await clients.releaseHold(idOf(req), holdId, actor(req)));
}

export async function resetPasswordForClient(req: Request, res: Response) {
  const input = parse(resetClientPasswordSchema, req.body ?? {});
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await clients.resetClientPassword(idOf(req), input, actor(req)));
}

/** Replaces any organization session in this browser with a "view as" session for the client. */
export async function impersonate(req: Request, res: Response) {
  const input = parse(impersonateSchema, req.body ?? {});
  const result = await clients.impersonate(idOf(req), input, actor(req));
  setSessionCookies(res, result.tokens);
  ok(res, { user: result.user });
}

export async function auditLog(req: Request, res: Response) {
  const query = parse(auditQuerySchema, req.query);
  const result = await clients.listPlatformAudit({ organizationId: query.organizationId, limit: query.limit, page: query.page });
  ok(res, result.rows, result.meta);
}

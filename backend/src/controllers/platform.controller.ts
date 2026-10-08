import type { Request, Response } from 'express';
import { parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { loginSchema } from '../validators/auth.validators';
import {
  auditQuerySchema,
  holdSchema,
  impersonateSchema,
  orgIdParam,
  registerOrganizationSchema,
  resetClientPasswordSchema,
  updateOrganizationSchema,
} from '../validators/platform.validators';
import * as platformAuth from '../services/platformAuth.service';
import * as clients from '../services/platformClients.service';
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

export async function features(_req: Request, res: Response) {
  ok(res, clients.featureCatalog());
}

export async function listClients(_req: Request, res: Response) {
  ok(res, await clients.listClients());
}

export async function getClient(req: Request, res: Response) {
  ok(res, await clients.getClient(idOf(req)));
}

export async function register(req: Request, res: Response) {
  const input = parse(registerOrganizationSchema, req.body);
  created(res, await clients.registerOrganization(input, actor(req)));
}

export async function update(req: Request, res: Response) {
  const input = parse(updateOrganizationSchema, req.body);
  ok(res, await clients.updateOrganization(idOf(req), input, actor(req)));
}

export async function hold(req: Request, res: Response) {
  const input = parse(holdSchema, req.body);
  ok(res, await clients.setHold(idOf(req), input, actor(req)));
}

export async function revealPassword(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await clients.revealPassword(idOf(req), actor(req)));
}

export async function resetPassword(req: Request, res: Response) {
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
  ok(res, await clients.listPlatformAudit(parse(auditQuerySchema, req.query)));
}

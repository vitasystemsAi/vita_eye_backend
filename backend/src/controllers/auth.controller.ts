import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { parse } from '../utils/errors';
import { clientIp, ok } from '../utils/http';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from '../validators/auth.validators';
import { COOKIE_REFRESH, authOf, clearSessionCookies, setSessionCookies } from '../middleware/auth';
import { issueCsrfCookie } from '../middleware/csrf';
import { Organization } from '../models';
import { runInTenant } from '../services/tenancy.service';
import { AppError } from '../utils/errors';
import type { AuthContext } from '../types/auth';

async function presentUser(ctx: AuthContext) {
  const org = await Organization.findByPk(ctx.organizationId);
  return {
    id: ctx.userId,
    name: ctx.name,
    email: ctx.email,
    role: ctx.role,
    permissions: [...ctx.permissions].sort(),
    features: [...ctx.features].sort(),
    siteScope: ctx.siteScope,
    impersonatedBy: ctx.impersonatedBy,
    organization: org ? { id: org.id, name: org.name, status: org.status, detectionRetentionDays: org.detectionRetentionDays } : null,
  };
}

const client = (req: Request) => ({ ip: clientIp(req), userAgent: req.get('user-agent') ?? null });

export async function csrf(_req: Request, res: Response) {
  ok(res, { csrfToken: issueCsrfCookie(res) });
}

export async function login(req: Request, res: Response) {
  const { email, password } = parse(loginSchema, req.body);
  const result = await authService.login(email, password, client(req));
  setSessionCookies(res, result);
  const ctx = await runInTenant(result.organizationId, () => authService.buildAuthContext(result.userId, null));
  if (!ctx) throw AppError.unauthenticated();
  ok(res, { user: await presentUser(ctx) });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE_REFRESH] as string | undefined;
  if (!token) throw AppError.unauthenticated('No session');
  try {
    const result = await authService.refresh(token, client(req));
    setSessionCookies(res, result);
    ok(res, { refreshed: true });
  } catch (err) {
    clearSessionCookies(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.cookies?.[COOKIE_REFRESH], req.auth, clientIp(req));
  clearSessionCookies(res);
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  ok(res, { user: await presentUser(authOf(req)) });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = parse(forgotPasswordSchema, req.body);
  await authService.requestPasswordReset(email, clientIp(req));
  ok(res, { message: 'If an account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = parse(resetPasswordSchema, req.body);
  await authService.resetPassword(token, password, clientIp(req));
  ok(res, { message: 'Password updated. Please sign in.' });
}

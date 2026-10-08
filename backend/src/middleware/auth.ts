import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/errors';
import { buildAuthContext, verifyAccessToken } from '../services/auth.service';
import { resolveTenant } from '../services/tenancy.service';
import { runWithTenant, type TenantStore } from '../db/tenantContext';
import type { Permission } from '../config/rbac';
import { env } from '../config/env';

export const COOKIE_ACCESS = 'vita_at';
export const COOKIE_REFRESH = 'vita_rt';
export const COOKIE_CSRF = 'vita_csrf';

const TENANT_STORE = Symbol('vitaTenantStore');
type TenantAwareRequest = Request & { [TENANT_STORE]?: TenantStore };

export function cookieBase() {
  return { secure: env.cookieSecure, sameSite: 'strict' as const, path: '/' };
}

export function setSessionCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res.cookie(COOKIE_ACCESS, tokens.accessToken, {
    ...cookieBase(),
    httpOnly: true,
    maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
    ...cookieBase(),
    httpOnly: true,
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
  });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(COOKIE_ACCESS, { ...cookieBase(), httpOnly: true });
  res.clearCookie(COOKIE_REFRESH, { ...cookieBase(), httpOnly: true, path: '/api/v1/auth' });
}

/**
 * Verifies the session and binds the rest of the request to the organization's database: every
 * tenant-scoped query issued by downstream handlers is routed there automatically.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_ACCESS] as string | undefined;
  if (!token) return next(AppError.unauthenticated());
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return next(new AppError(401, 'TOKEN_EXPIRED', 'Access token expired'));
    return next(AppError.unauthenticated('Invalid session'));
  }
  const tenant = await resolveTenant(claims.org);
  if (!tenant) return next(AppError.unauthenticated('Session no longer valid'));
  const store: TenantStore = { organizationId: claims.org, database: tenant.database, impersonatedBy: claims.imp ?? null };
  (req as TenantAwareRequest)[TENANT_STORE] = store;
  return runWithTenant(store, async () => {
    const ctx = await buildAuthContext(claims.sub, claims.sid, { impersonatedBy: claims.imp ?? null });
    if (!ctx || ctx.organizationId !== claims.org) return next(AppError.unauthenticated('Session no longer valid'));
    req.auth = ctx;
    next();
  });
}

/**
 * Re-enters the request's tenant context. Needed after middleware that resumes from stream events
 * (multipart uploads), where async context from `authenticate` is not propagated.
 */
export function restoreTenant(req: Request, _res: Response, next: NextFunction) {
  const store = (req as TenantAwareRequest)[TENANT_STORE];
  if (!store) return next();
  runWithTenant(store, () => next());
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(AppError.unauthenticated());
    const missing = perms.filter((p) => !req.auth!.permissions.has(p));
    if (missing.length) return next(AppError.forbidden());
    next();
  };
}

/** Narrow helper for controllers: guarantees an authenticated context. */
export function authOf(req: Request) {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

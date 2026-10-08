import type { NextFunction, Request, Response } from 'express';
import { randomToken, timingSafeEqualStr } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { COOKIE_CSRF, cookieBase } from './auth';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(res: Response): string {
  const token = randomToken(24);
  res.cookie(COOKIE_CSRF, token, { ...cookieBase(), httpOnly: false, maxAge: 7 * 86400_000 });
  return token;
}

/**
 * Double-submit cookie CSRF protection. Session cookies are already SameSite=Strict; this adds a
 * second layer for any state-changing request authenticated by cookies.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const cookie = req.cookies?.[COOKIE_CSRF] as string | undefined;
  if (SAFE.has(req.method)) {
    if (!cookie) issueCsrfCookie(res);
    return next();
  }
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !timingSafeEqualStr(cookie, header)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
}

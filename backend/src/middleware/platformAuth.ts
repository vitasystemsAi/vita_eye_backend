import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { platformSessionSeconds, verifyPlatformSession } from '../services/platformAuth.service';
import { cookieBase } from './auth';

export const COOKIE_PLATFORM = 'vita_pa';
const PLATFORM_PATH = '/api/v1/platform';

export function setPlatformCookie(res: Response, token: string) {
  res.cookie(COOKIE_PLATFORM, token, { ...cookieBase(), httpOnly: true, path: PLATFORM_PATH, maxAge: platformSessionSeconds() * 1000 });
}

export function clearPlatformCookie(res: Response) {
  res.clearCookie(COOKIE_PLATFORM, { ...cookieBase(), httpOnly: true, path: PLATFORM_PATH });
}

export async function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_PLATFORM] as string | undefined;
  if (!token) return next(AppError.unauthenticated('Platform sign-in required'));
  const admin = await verifyPlatformSession(token);
  if (!admin) return next(AppError.unauthenticated('Platform session expired'));
  req.platformAdmin = admin;
  next();
}

export function platformAdminOf(req: Request) {
  if (!req.platformAdmin) throw AppError.unauthenticated('Platform sign-in required');
  return req.platformAdmin;
}

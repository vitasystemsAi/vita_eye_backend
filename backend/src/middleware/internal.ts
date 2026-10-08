import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { timingSafeEqualStr } from '../utils/crypto';
import { AppError } from '../utils/errors';

/** Authenticates service-to-service calls from the AI service (never exposed through Nginx). */
export function requireInternalToken(req: Request, _res: Response, next: NextFunction) {
  const token = req.get('x-internal-token');
  if (!token || !timingSafeEqualStr(token, env.INTERNAL_SERVICE_TOKEN)) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid internal service token'));
  }
  next();
}

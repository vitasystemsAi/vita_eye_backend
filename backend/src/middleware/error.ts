import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { UniqueConstraintError, ValidationError, ForeignKeyConstraintError } from 'sequelize';
import { AppError } from '../utils/errors';
import { logger } from '../config/logger';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let appErr: AppError;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof UniqueConstraintError) {
    appErr = AppError.conflict('A record with the same unique value already exists');
  } else if (err instanceof ForeignKeyConstraintError) {
    appErr = AppError.conflict('Operation violates a data relationship');
  } else if (err instanceof ValidationError) {
    appErr = AppError.validation(err.errors.map((e) => ({ path: e.path, message: e.message })));
  } else if (err instanceof multer.MulterError) {
    appErr = AppError.badRequest(`Upload error: ${err.message}`);
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    appErr = AppError.badRequest('Malformed JSON body');
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  } else {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    appErr = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  if (appErr.status >= 500 && err instanceof AppError) {
    logger.warn({ code: appErr.code, path: req.path }, appErr.message);
  }

  res.status(appErr.status).json({
    success: false,
    error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
  });
}

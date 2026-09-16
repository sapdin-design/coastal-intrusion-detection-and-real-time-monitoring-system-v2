import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';

/** Application-level error carrying an HTTP status and optional machine code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message, 'FORBIDDEN');
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }
  static conflict(message: string) {
    return new ApiError(409, message, 'CONFLICT');
  }
  static unprocessable(message: string, details?: unknown) {
    return new ApiError(422, message, 'UNPROCESSABLE', details);
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} does not exist` },
  });
};

/**
 * Single exit point for every failure. Zod issues, known ApiErrors, services that
 * attached a bare `status` property and genuine crashes all become the same
 * envelope, so the dashboard only ever has one error shape to parse.
 */
export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (error instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (error instanceof ApiError) {
    status = error.status;
    code = error.code ?? 'API_ERROR';
    message = error.message;
    details = error.details;
  } else if (error instanceof Error) {
    const withStatus = error as Error & { status?: number; code?: string };
    status = typeof withStatus.status === 'number' ? withStatus.status : 500;
    code = withStatus.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    message = status === 500 && env.isProd ? 'An unexpected error occurred' : error.message;
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${status}: ${message}`, {
      stack: (error as Error)?.stack,
    });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} → ${status}: ${message}`);
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
};

/** Wraps async route handlers so rejected promises reach the error handler. */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(fn(req as T, res, next)).catch(next);
  };

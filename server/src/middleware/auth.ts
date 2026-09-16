import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../types/domain';
import { authService, type AuthTokenPayload } from '../services/auth.service';
import { ApiError } from './error';

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // Socket.IO-style handshake token, useful for <img>/download links.
  const queryToken = req.query.token;
  return typeof queryToken === 'string' && queryToken ? queryToken : null;
};

/** Verifies the JWT and attaches the decoded principal to `req.user`. */
export const requireAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
  const token = extractToken(req);
  if (!token) {
    next(ApiError.unauthorized());
    return;
  }
  try {
    req.user = authService.verifyToken(token);
    next();
  } catch {
    next(ApiError.unauthorized('Session expired or token invalid'));
  }
};

/**
 * Role gate. ADMIN passes everything; OPERATOR can act on operational data;
 * ANALYST is read-only, which the route tables enforce by only listing it on GETs.
 */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(
        ApiError.forbidden(
          `This action requires one of: ${roles.join(', ')}. Your role is ${req.user.role}.`,
        ),
      );
      return;
    }
    next();
  };

export const ADMIN_ONLY = requireRole('ADMIN');
export const OPERATIONAL = requireRole('ADMIN', 'OPERATOR');

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

/** Compact access log: method, url, status, duration and the caller's role. */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const actor = (req as Request & { user?: { role?: string } }).user?.role;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms${
      actor ? ` [${actor}]` : ''
    }`;

    // Realtime position frames arrive at ~1 Hz per vessel; keep them out of the log.
    if (req.originalUrl.startsWith('/api/v1/telemetry')) {
      logger.debug(line);
      return;
    }
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.http(line);
  });

  next();
};

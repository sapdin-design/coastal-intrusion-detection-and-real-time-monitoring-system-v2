import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Two limiters with different budgets:
 *  - `apiLimiter`     : the general REST surface.
 *  - `authLimiter`    : deliberately tight, to blunt credential stuffing.
 *  - `telemetryLimiter`: generous, because a real GNSS bridge posts at ~1 Hz per
 *    vessel and must not be throttled by the general budget.
 */
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' },
  },
});

export const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    },
  },
});

export const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20_000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Telemetry ingestion rate exceeded.' },
  },
});

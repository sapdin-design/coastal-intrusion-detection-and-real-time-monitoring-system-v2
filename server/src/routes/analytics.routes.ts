import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { alertService } from '../services/alert.service';
import { analyticsService } from '../services/analytics.service';
import { auditService } from '../services/audit.service';
import { incidentService } from '../services/incident.service';
import { vesselService } from '../services/vessel.service';
import { zoneService } from '../services/zone.service';
import { ok } from '../utils/http';
import { analyticsQuerySchema, auditQuerySchema } from '../validators';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

/** GET /api/v1/analytics/overview — the headline counters on the dashboard. */
analyticsRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => ok(res, await analyticsService.overview())),
);

/** GET /api/v1/analytics/full — one call that hydrates the whole analytics page. */
analyticsRouter.get(
  '/full',
  validate({ query: analyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { hours, days } = req.query as { hours?: number; days?: number };
    return ok(res, await analyticsService.full(hours ?? 24, days ?? 7));
  }),
);

analyticsRouter.get(
  '/hourly',
  validate({ query: analyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { hours } = req.query as { hours?: number };
    return ok(res, await analyticsService.hourly(hours ?? 24));
  }),
);

analyticsRouter.get(
  '/daily',
  validate({ query: analyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { days } = req.query as { days?: number };
    return ok(res, await analyticsService.daily(days ?? 7));
  }),
);

/** GET /api/v1/analytics/summary — lightweight roll-up for the top bar ticker. */
analyticsRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const [vessels, alerts, incidents] = await Promise.all([
      vesselService.summary(),
      alertService.summary(),
      incidentService.summary(),
    ]);
    return ok(res, { vessels, alerts, incidents });
  }),
);

/** GET /api/v1/analytics/zones — zone-activity table. */
analyticsRouter.get(
  '/zones',
  asyncHandler(async (_req, res) => ok(res, await zoneService.activity())),
);

/** GET /api/v1/analytics/audit — operator activity feed. */
analyticsRouter.get(
  '/audit',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit } = req.query as { limit?: number };
    return ok(res, await auditService.list(limit ?? 150));
  }),
);

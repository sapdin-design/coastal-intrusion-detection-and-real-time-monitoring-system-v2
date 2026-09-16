import { Router } from 'express';
import { OPERATIONAL, ADMIN_ONLY, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { auditService } from '../services/audit.service';
import { analyticsService } from '../services/analytics.service';
import { ingestionService } from '../services/ingestion.service';
import { vesselService } from '../services/vessel.service';
import { clientIp, ok, paginate } from '../utils/http';
import {
  createVesselSchema,
  idParamSchema,
  trackQuerySchema,
  updateVesselSchema,
  vesselQuerySchema,
} from '../validators';

export const vesselRouter = Router();
vesselRouter.use(requireAuth);

/** GET /api/v1/vessels — filterable, paginated fleet listing. */
vesselRouter.get(
  '/',
  validate({ query: vesselQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filters } = req.query as Record<string, never>;
    const rows = await vesselService.list(filters);
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

/** GET /api/v1/vessels/summary — the dashboard's fleet counters. */
vesselRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => ok(res, await vesselService.summary())),
);

/** GET /api/v1/vessels/:id — full record for the detail drawer. */
vesselRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => ok(res, await vesselService.require(req.params.id))),
);

/** GET /api/v1/vessels/:id/track — polyline history for the map. */
vesselRouter.get(
  '/:id/track',
  validate({ params: idParamSchema, query: trackQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit } = req.query as { limit?: number };
    return ok(res, await ingestionService.track(req.params.id, limit ?? 300));
  }),
);

/** GET /api/v1/vessels/:id/stats — trip statistics for the detail drawer. */
vesselRouter.get(
  '/:id/stats',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => ok(res, await analyticsService.vesselStats(req.params.id))),
);

vesselRouter.post(
  '/',
  OPERATIONAL,
  validate({ body: createVesselSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const created = await vesselService.create(req.body, req.user!);
    await auditService.record(
      req.user!,
      'CREATE',
      'vessel',
      created.vesselId,
      `Registered ${created.name} (${created.vesselType})`,
      clientIp(req),
    );
    return ok(res, created, undefined, 201);
  }),
);

vesselRouter.patch(
  '/:id',
  OPERATIONAL,
  validate({ params: idParamSchema, body: updateVesselSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const updated = await vesselService.update(req.params.id, req.body);
    await auditService.record(
      req.user!,
      'UPDATE',
      'vessel',
      updated.vesselId,
      `Updated ${updated.name}`,
      clientIp(req),
    );
    return ok(res, updated);
  }),
);

vesselRouter.delete(
  '/:id',
  ADMIN_ONLY,
  validate({ params: idParamSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await vesselService.remove(req.params.id);
    await auditService.record(req.user!, 'DELETE', 'vessel', req.params.id, 'Vessel removed', clientIp(req));
    return ok(res, { deleted: true });
  }),
);

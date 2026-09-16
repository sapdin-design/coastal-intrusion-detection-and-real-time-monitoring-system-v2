import { Router } from 'express';
import { OPERATIONAL, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { auditService } from '../services/audit.service';
import { zoneService } from '../services/zone.service';
import { clientIp, ok, paginate } from '../utils/http';
import {
  createZoneSchema,
  idParamSchema,
  updateZoneSchema,
  zoneQuerySchema,
} from '../validators';

export const zoneRouter = Router();
zoneRouter.use(requireAuth);

/** GET /api/v1/zones — every polygon, with derived area and centroid. */
zoneRouter.get(
  '/',
  validate({ query: zoneQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filters } = req.query as Record<string, never>;
    const rows = await zoneService.list(filters);
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

/** GET /api/v1/zones/activity — alerts / intrusions / vessels per zone. */
zoneRouter.get(
  '/activity',
  asyncHandler(async (_req, res) => ok(res, await zoneService.activity())),
);

zoneRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => ok(res, await zoneService.require(req.params.id))),
);

zoneRouter.post(
  '/',
  OPERATIONAL,
  validate({ body: createZoneSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const created = await zoneService.create(req.body, req.user!);
    await auditService.record(
      req.user!,
      'CREATE',
      'zone',
      created.zoneId,
      `Drew ${created.name} (${created.zoneType}, ${created.severity}) with ${created.coordinates.length} vertices`,
      clientIp(req),
    );
    return ok(res, created, undefined, 201);
  }),
);

zoneRouter.patch(
  '/:id',
  OPERATIONAL,
  validate({ params: idParamSchema, body: updateZoneSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const updated = await zoneService.update(req.params.id, req.body);
    await auditService.record(req.user!, 'UPDATE', 'zone', updated.zoneId, `Updated ${updated.name}`, clientIp(req));
    return ok(res, updated);
  }),
);

/** POST /api/v1/zones/:id/toggle — flip ENABLED / DISABLED without a full update. */
zoneRouter.post(
  '/:id/toggle',
  OPERATIONAL,
  validate({ params: idParamSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const updated = await zoneService.toggleStatus(req.params.id);
    await auditService.record(
      req.user!,
      'TOGGLE',
      'zone',
      updated.zoneId,
      `${updated.name} is now ${updated.status}`,
      clientIp(req),
    );
    return ok(res, updated);
  }),
);

zoneRouter.delete(
  '/:id',
  OPERATIONAL,
  validate({ params: idParamSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await zoneService.remove(req.params.id);
    await auditService.record(req.user!, 'DELETE', 'zone', req.params.id, 'Zone removed', clientIp(req));
    return ok(res, { deleted: true });
  }),
);

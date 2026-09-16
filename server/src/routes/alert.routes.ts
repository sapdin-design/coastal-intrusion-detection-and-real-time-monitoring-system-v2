import { Router } from 'express';
import { OPERATIONAL, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { alertService } from '../services/alert.service';
import { auditService } from '../services/audit.service';
import { clientIp, ok, paginate } from '../utils/http';
import { alertActionSchema, alertQuerySchema, idParamSchema } from '../validators';

export const alertRouter = Router();
alertRouter.use(requireAuth);

/** GET /api/v1/alerts — the alert console. `?status=ACTIVE` hides resolved rows. */
alertRouter.get(
  '/',
  validate({ query: alertQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filters } = req.query as Record<string, never>;
    const rows = await alertService.list(filters);
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

alertRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => ok(res, await alertService.summary())),
);

alertRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const alert = await alertService.getByAlertId(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } });
    }
    return ok(res, alert);
  }),
);

/** POST /api/v1/alerts/:id/acknowledge — NEW → ACKNOWLEDGED. */
alertRouter.post(
  '/:id/acknowledge',
  OPERATIONAL,
  validate({ params: idParamSchema, body: alertActionSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const alert = await alertService.acknowledge(req.params.id, req.user!);
    await auditService.record(
      req.user!,
      'ACKNOWLEDGE',
      'alert',
      alert.alertId,
      `Acknowledged ${alert.alertType} for ${alert.vesselId}`,
      clientIp(req),
    );
    return ok(res, alert);
  }),
);

/** POST /api/v1/alerts/:id/resolve — closes the alert out. */
alertRouter.post(
  '/:id/resolve',
  OPERATIONAL,
  validate({ params: idParamSchema, body: alertActionSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const alert = await alertService.resolve(req.params.id, req.user!);
    await auditService.record(
      req.user!,
      'RESOLVE',
      'alert',
      alert.alertId,
      `Resolved ${alert.alertType} for ${alert.vesselId}`,
      clientIp(req),
    );
    return ok(res, alert);
  }),
);

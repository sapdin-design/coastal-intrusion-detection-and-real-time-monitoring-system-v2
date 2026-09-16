import { Router } from 'express';
import { OPERATIONAL, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { auditService } from '../services/audit.service';
import { incidentService } from '../services/incident.service';
import { clientIp, ok, paginate } from '../utils/http';
import {
  idParamSchema,
  incidentAssignSchema,
  incidentQuerySchema,
  incidentTransitionSchema,
} from '../validators';

export const incidentRouter = Router();
incidentRouter.use(requireAuth);

incidentRouter.get(
  '/',
  validate({ query: incidentQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filters } = req.query as Record<string, never>;
    const rows = await incidentService.list(filters);
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

incidentRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => ok(res, await incidentService.summary())),
);

incidentRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const incident = await incidentService.getByIncidentId(req.params.id);
    if (!incident) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Incident not found' } });
    }
    return ok(res, incident);
  }),
);

/**
 * PATCH /api/v1/incidents/:id/status — drives the workflow
 * OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED.
 * Illegal jumps return 409 with the allowed transitions in the message.
 */
incidentRouter.patch(
  '/:id/status',
  OPERATIONAL,
  validate({ params: idParamSchema, body: incidentTransitionSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { status, note } = req.body as { status: never; note?: string };
    const incident = await incidentService.transition(req.params.id, status, req.user!, note);
    await auditService.record(
      req.user!,
      'TRANSITION',
      'incident',
      incident.incidentId,
      `Moved to ${incident.status}${note ? ` — ${note}` : ''}`,
      clientIp(req),
    );
    return ok(res, incident);
  }),
);

incidentRouter.patch(
  '/:id/assign',
  OPERATIONAL,
  validate({ params: idParamSchema, body: incidentAssignSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { assignedTo } = req.body as { assignedTo: string };
    const incident = await incidentService.assign(req.params.id, assignedTo, req.user!);
    await auditService.record(
      req.user!,
      'ASSIGN',
      'incident',
      incident.incidentId,
      `Assigned to ${assignedTo}`,
      clientIp(req),
    );
    return ok(res, incident);
  }),
);

import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { ApiError, asyncHandler } from '../middleware/error';
import { telemetryLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { ingestionService } from '../services/ingestion.service';
import { ok } from '../utils/http';
import { idParamSchema, telemetryBatchSchema, telemetrySchema, trackQuerySchema } from '../validators';

export const telemetryRouter = Router();

/**
 * Accepts either a user JWT or the device key. This is what lets the same
 * endpoint serve the browser simulator today and an ESP32 / Raspberry Pi GNSS
 * node tomorrow with zero API changes.
 */
const requireDeviceOrUser = (req: Request, res: Response, next: NextFunction): void => {
  const deviceKey = req.headers['x-device-key'];
  if (typeof deviceKey === 'string' && deviceKey && deviceKey === env.deviceApiKey) {
    next();
    return;
  }
  requireAuth(req, res, next);
};

telemetryRouter.use(telemetryLimiter);

/**
 * POST /api/v1/telemetry
 *
 * The single location-ingestion contract of the system. Replace the simulator
 * with real hardware by pointing it here:
 *
 *   curl -X POST http://<host>:4000/api/v1/telemetry \
 *     -H "Content-Type: application/json" \
 *     -H "x-device-key: cidrtm-device-key" \
 *     -d '{"vesselId":"VSL-AB12CD","latitude":8.4712,"longitude":77.5231,
 *          "speed":11.4,"direction":87,"source":"GNSS_DEVICE"}'
 */
telemetryRouter.post(
  '/',
  requireDeviceOrUser,
  validate({ body: telemetrySchema }),
  asyncHandler(async (req, res) => {
    const result = await ingestionService.ingest(req.body);
    return ok(
      res,
      {
        vessel: result.vessel,
        evaluations: result.evaluations,
        alertsRaised: result.createdAlerts.map((a) => ({
          alertId: a.alertId,
          alertType: a.alertType,
          severity: a.severity,
        })),
        incidentsRaised: result.createdIncidents.map((i) => i.incidentId),
      },
      undefined,
      202,
    );
  }),
);

/** POST /api/v1/telemetry/batch — one round-trip for a whole fleet tick. */
telemetryRouter.post(
  '/batch',
  requireDeviceOrUser,
  validate({ body: telemetryBatchSchema }),
  asyncHandler(async (req, res) => {
    const { updates } = req.body as { updates: never[] };
    const results = await ingestionService.ingestMany(updates);
    return ok(
      res,
      {
        accepted: results.length,
        alertsRaised: results.reduce((sum, r) => sum + r.createdAlerts.length, 0),
        incidentsRaised: results.reduce((sum, r) => sum + r.createdIncidents.length, 0),
      },
      undefined,
      202,
    );
  }),
);

/** GET /api/v1/telemetry/latest — seeds the map instantly on dashboard load. */
telemetryRouter.get(
  '/latest',
  requireAuth,
  asyncHandler(async (_req, res) => ok(res, await ingestionService.latestByVessel())),
);

/** GET /api/v1/telemetry/tracks/:id — position history for the route polyline. */
telemetryRouter.get(
  '/tracks/:id',
  requireAuth,
  validate({ params: idParamSchema, query: trackQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit } = req.query as { limit?: number };
    const vesselId = req.params.id;
    if (!vesselId) throw ApiError.badRequest('A vessel id is required');
    return ok(res, await ingestionService.track(vesselId, limit ?? 300));
  }),
);

import { Router } from 'express';
import { env } from '../config/env';
import { getStore } from '../repositories';
import { geofenceEngine } from '../services/geofence.service';
import { simulationEngine } from '../services/simulation.service';
import { analyticsRouter } from './analytics.routes';
import { alertRouter } from './alert.routes';
import { authRouter, userRouter } from './auth.routes';
import { incidentRouter } from './incident.routes';
import { simulationRouter } from './simulation.routes';
import { telemetryRouter } from './telemetry.routes';
import { vesselRouter } from './vessel.routes';
import { zoneRouter } from './zone.routes';
import { asyncHandler } from '../middleware/error';
import { ok } from '../utils/http';

export const apiRouter = Router();

/** GET /api/v1/health — liveness probe used by Docker and by the status widget. */
apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const stats = await getStore().stats();
    return ok(res, {
      status: 'ok',
      version: '1.0.0',
      environment: env.nodeEnv,
      driver: stats.driver,
      uptimeSeconds: Math.round(process.uptime()),
      simulation: simulationEngine.state().status,
      geofencePairs: geofenceEngine.snapshotSize(),
      timestamp: new Date().toISOString(),
    });
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/vessels', vesselRouter);
apiRouter.use('/zones', zoneRouter);
apiRouter.use('/alerts', alertRouter);
apiRouter.use('/incidents', incidentRouter);
apiRouter.use('/telemetry', telemetryRouter);
apiRouter.use('/simulation', simulationRouter);
apiRouter.use('/analytics', analyticsRouter);

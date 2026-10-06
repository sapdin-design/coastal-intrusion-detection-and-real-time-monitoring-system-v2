import { Router } from 'express';
import { OPERATIONAL, requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validate';
import { auditService } from '../services/audit.service';
import { simulationEngine } from '../services/simulation.service';
import { clientIp, ok } from '../utils/http';
import {
  simulationResetSchema,
  simulationScenarioSchema,
  simulationSpeedSchema,
} from '../validators';

export const simulationRouter = Router();
simulationRouter.use(requireAuth);

/** GET /api/v1/simulation/state — poll target for the simulator console. */
simulationRouter.get(
  '/state',
  asyncHandler(async (_req, res) =>
    ok(res, {
      ...(await simulationEngine.snapshot()),
      routes: simulationEngine.routeTable(),
      scenarios: simulationEngine.scenarios(),
      timeline: simulationEngine.activeScenario().timeline,
    }),
  ),
);

/**
 * PATCH /api/v1/simulation/scenario — stage a demonstration scenario.
 * Rewinds the participating fleet to the head of its assigned lane.
 */
simulationRouter.patch(
  '/scenario',
  OPERATIONAL,
  validate({ body: simulationScenarioSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { scenario } = req.body as { scenario: string };
    const state = await simulationEngine.setScenario(scenario);
    await auditService.record(
      req.user!,
      'SIM_SCENARIO',
      'simulation',
      'engine',
      `Simulation scenario staged: ${state.scenarioName}`,
      clientIp(req),
    );
    return ok(res, state);
  }),
);

/** POST /api/v1/simulation/start — begins the GPS tick loop. */
simulationRouter.post(
  '/start',
  OPERATIONAL,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const state = await simulationEngine.start();
    await auditService.record(req.user!, 'SIM_START', 'simulation', 'engine', 'GPS simulator started', clientIp(req));
    return ok(res, state);
  }),
);

simulationRouter.post(
  '/pause',
  OPERATIONAL,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const state = simulationEngine.pause();
    await auditService.record(req.user!, 'SIM_PAUSE', 'simulation', 'engine', 'GPS simulator paused', clientIp(req));
    return ok(res, state);
  }),
);

simulationRouter.post(
  '/resume',
  OPERATIONAL,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const state = simulationEngine.resume();
    await auditService.record(req.user!, 'SIM_RESUME', 'simulation', 'engine', 'GPS simulator resumed', clientIp(req));
    return ok(res, state);
  }),
);

simulationRouter.post(
  '/stop',
  OPERATIONAL,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const state = simulationEngine.stop();
    await auditService.record(req.user!, 'SIM_STOP', 'simulation', 'engine', 'GPS simulator stopped', clientIp(req));
    return ok(res, state);
  }),
);

/** POST /api/v1/simulation/step — advance exactly one tick. */
simulationRouter.post(
  '/step',
  OPERATIONAL,
  asyncHandler(async (_req, res) => ok(res, await simulationEngine.step())),
);

/** PATCH /api/v1/simulation/speed — 1× / 2× / 5× / 10×. */
simulationRouter.patch(
  '/speed',
  OPERATIONAL,
  validate({ body: simulationSpeedSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { multiplier } = req.body as { multiplier: number };
    const state = simulationEngine.setSpeed(multiplier);
    await auditService.record(
      req.user!,
      'SIM_SPEED',
      'simulation',
      'engine',
      `Simulation speed set to ${multiplier}×`,
      clientIp(req),
    );
    return ok(res, state);
  }),
);

/**
 * POST /api/v1/simulation/reset — rewinds positions and tracks.
 * `purgeAlerts: true` also clears the alert and incident history, which is the
 * clean starting point for a fresh demo or a project evaluation run.
 */
simulationRouter.post(
  '/reset',
  OPERATIONAL,
  validate({ body: simulationResetSchema }),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { purgeAlerts } = req.body as { purgeAlerts?: boolean };
    const state = await simulationEngine.reset(Boolean(purgeAlerts));
    await auditService.record(
      req.user!,
      'SIM_RESET',
      'simulation',
      'engine',
      purgeAlerts ? 'Simulation and history reset' : 'Simulation reset',
      clientIp(req),
    );
    return ok(res, state);
  }),
);

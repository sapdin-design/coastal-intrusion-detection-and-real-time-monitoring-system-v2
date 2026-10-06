import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import type {
  LatLng,
  LocationUpdateInput,
  SimulationSpeed,
  SimulationStatus,
  Vessel,
  Zone,
} from '../types/domain';
import {
  angleDelta,
  clamp,
  nowIso,
  normalizeAngle,
  randRange,
  round,
} from '../utils/ids';
import {
  bearingDegrees,
  destinationPoint,
  haversineMeters,
  pointInPolygon,
  speedToStepMeters,
} from '../utils/geo';
import {
  MARITIME_ROUTES,
  type MaritimeRoute,
  type RouteScenario,
  routeById,
} from '../utils/maritime';
import {
  DEFAULT_SCENARIO,
  SCENARIO_LIST,
  type ScenarioDefinition,
  type SimulationScenario,
  isScenario,
  scenarioById,
} from '../utils/scenarios';
import { alertService } from './alert.service';
import { geofenceEngine } from './geofence.service';
import { ingestionService } from './ingestion.service';

type Behavior = 'PATROL' | 'TRANSIT' | 'INTRUDER';

interface RouteState {
  behavior: Behavior;
  /**
   * The predefined offshore route this vessel is following.
   *
   * Replacing the old "pick a random point in the bounding box and steer at it"
   * approach is what keeps vessels off the land: the routes in `MARITIME_ROUTES`
   * are hand-drawn sea lanes, validated against the coastline before use.
   */
  route: MaritimeRoute;
  /** Index of the waypoint currently being steered toward. */
  waypointIndex: number;
  target: LatLng;
  /** Zone the intruder is currently converging on. */
  targetZoneId: string | null;
  cruiseSpeed: number;
  /** Ticks remaining in a deliberate loiter, used to demo SUSPICIOUS_MOVEMENT. */
  loiterTicks: number;
  /** Ticks during which the vessel stops reporting, to demo VESSEL_OFFLINE. */
  darkTicks: number;
  /** Ticks left before a fresh decision is taken. */
  decisionCooldown: number;
  /**
   * Held at berth for the active scenario.
   *
   * A held contact stays on the plot — it is real, it is just not under way. It
   * keeps a fresh last-seen stamp so the health sweep does not raise a spurious
   * VESSEL_OFFLINE alert, but it emits no telemetry and does not move.
   */
  held: boolean;
}

/** One vessel's slot in the active scenario. */
interface ParticipantSlot {
  route: MaritimeRoute;
  held: boolean;
}

export interface ScenarioSummary {
  id: SimulationScenario;
  name: string;
  summary: string;
  timeline: ScenarioDefinition['timeline'];
}

export interface SimulationState {
  status: SimulationStatus;
  scenario: SimulationScenario;
  scenarioName: string;
  speedMultiplier: SimulationSpeed | number;
  tickMs: number;
  ticks: number;
  elapsedSimSeconds: number;
  startedAt: string | null;
  lastTickAt: string | null;
  trackedVessels: number;
  zonesAvailable: number;
  ticksPerSecond: number;
  intrusionsGenerated: number;
  alertsGenerated: number;
}

const MAX_TURN_PER_TICK_DEG = 14;
const WAYPOINT_RADIUS_M = 180;
/**
 * Distance added to a lane's score for every contact already on it.
 *
 * Keeps a multi-vessel run spread across the sector: a lane needs to be 4 km
 * closer than an empty one before it takes a second contact.
 */
const LANE_SPREAD_PENALTY_M = 4000;
/**
 * Distance added to a lane's score when its target zone already has a contact
 * heading for it. Larger than the whole theatre, so a fresh restricted area
 * always beats a second run at one already being exercised.
 */
const TARGET_REUSE_PENALTY_M = 40000;

/** Identifies what a lane is "for" — its target zone, or the lane itself. */
const targetKey = (route: MaritimeRoute): string => route.targetZoneName ?? route.id;
/** Fraction of simulated vessels that intentionally run dark to exercise offline detection. */
const DARK_VESSEL_RATIO = 0.12;

/**
 * GPS simulator.
 *
 * Design decision worth calling out: the multiplier changes *simulated time per
 * tick*, not the tick frequency. The bus therefore always carries ~1 update per
 * vessel per second — the map animates smoothly, the socket stays cheap, and 10×
 * genuinely means "ten times further along the route" rather than "ten times more
 * traffic".
 *
 * Behaviours are assigned per vessel:
 *   PATROL   – authorized vessels cruising between offshore waypoints.
 *   TRANSIT  – straight-line passage across the sector.
 *   INTRUDER – unauthorized vessels that deliberately converge on a restricted
 *              zone, loiter inside it, then withdraw. This is what exercises the
 *              full GPS → geofence → intrusion → alert → incident pipeline.
 */
class SimulationEngine {
  private status: SimulationStatus = 'IDLE';
  private scenario: SimulationScenario = DEFAULT_SCENARIO;
  private speedMultiplier: number = env.simulation.speedMultiplier;
  private tickMs: number = env.simulation.tickMs;
  private ticks = 0;
  private startedAt: string | null = null;
  private lastTickAt: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  private readonly routes = new Map<string, RouteState>();
  private intrusionsGenerated = 0;
  private alertsGenerated = 0;
  private knownAlertIds = new Set<string>();

  /* ───────────────────────────── Controls ───────────────────────────── */

  async start(): Promise<SimulationState> {
    if (this.status === 'RUNNING') return this.state();
    await this.ensureRoutes();
    this.status = 'RUNNING';
    this.startedAt = this.startedAt ?? nowIso();
    this.scheduleLoop();
    logger.info(`GPS simulator started at ${this.speedMultiplier}× (tick ${this.tickMs} ms)`);
    return this.broadcastState();
  }

  pause(): SimulationState {
    if (this.status !== 'RUNNING') return this.state();
    this.status = 'PAUSED';
    this.clearLoop();
    logger.info('GPS simulator paused');
    return this.broadcastState();
  }

  resume(): SimulationState {
    if (this.status !== 'PAUSED') return this.state();
    this.status = 'RUNNING';
    this.scheduleLoop();
    logger.info('GPS simulator resumed');
    return this.broadcastState();
  }

  stop(): SimulationState {
    this.status = 'STOPPED';
    this.clearLoop();
    logger.info('GPS simulator stopped');
    return this.broadcastState();
  }

  /**
   * Stages a scenario.
   *
   * Switching scenario deliberately rewinds the participating fleet to the head
   * of its assigned sea lane. That is an operator action with a visible, stated
   * effect — "stage the demo" — not the silent random teleporting the upgrade
   * brief rules out. Movement *within* a run is always continuous waypoint
   * interpolation; nothing jumps mid-scenario.
   */
  async setScenario(id: string): Promise<SimulationState> {
    if (!isScenario(id)) {
      throw new Error(`Unknown simulation scenario: ${id}`);
    }
    this.scenario = id;
    this.routes.clear();
    await this.stageScenario();
    logger.info(`GPS simulator scenario set to ${id}`);
    return this.broadcastState();
  }

  /** Parks every scenario participant at the head of its assigned lane. */
  private async stageScenario(): Promise<void> {
    const store = getStore();
    const vessels = (await store.vessels.list()).filter((v) => v.simulated);
    const zones = (await store.zones.list()).filter((z) => z.status === 'ENABLED');
    const plan = await this.ensureRoutes(vessels, zones);

    for (const vessel of vessels) {
      const slot = plan.get(vessel.vesselId);
      if (!slot) continue;

      if (slot.held) {
        // A contact benched by the new scenario must not carry a stale INTRUSION
        // or WARNING flag from the previous run — otherwise the map shows a
        // stationary boat badged as an intruder and the dashboard counts stay
        // inflated until the health sweep happens to clear them.
        await store.vessels.update(vessel._id, {
          speed: 0,
          status: 'ACTIVE',
          riskScore: vessel.authorizationStatus === 'UNAUTHORIZED' ? 30 : 5,
          lastSeen: nowIso(),
        });
        continue;
      }

      const start = slot.route.waypoints[0];
      const next = slot.route.waypoints[1] ?? start;
      await store.vessels.update(vessel._id, {
        currentLatitude: round(start.lat, 5),
        currentLongitude: round(start.lng, 5),
        speed: round(slot.route.cruiseSpeedKmh, 1),
        direction: round(bearingDegrees(start, next), 0),
        status: 'ACTIVE',
        riskScore: vessel.authorizationStatus === 'UNAUTHORIZED' ? 45 : 10,
        lastSeen: nowIso(),
      });
    }

    // A fresh scenario starts from a clean geofence memory, otherwise the
    // 45-second duplicate-suppression window would swallow the first intrusion
    // of the new run.
    geofenceEngine.reset();
  }

  setSpeed(multiplier: number): SimulationState {
    const allowed = [1, 2, 5, 10];
    const safe = allowed.includes(multiplier) ? multiplier : 1;
    this.speedMultiplier = safe;
    logger.info(`GPS simulator speed set to ${safe}×`);
    return this.broadcastState();
  }

  /** Rewinds positions, tracks and engine state. Keeps zones and vessels. */
  async reset(purgeAlerts = false): Promise<SimulationState> {
    this.clearLoop();
    this.status = 'IDLE';
    this.ticks = 0;
    this.startedAt = null;
    this.lastTickAt = null;
    this.intrusionsGenerated = 0;
    this.alertsGenerated = 0;
    this.routes.clear();
    this.knownAlertIds = new Set();
    geofenceEngine.reset();

    const store = getStore();
    await store.tracks.removeAll();

    // Park every participant at the head of its own lane for the active
    // scenario. Starting on the route — rather than at a random point in the
    // bounding box — is what guarantees a clean, land-free opening picture.
    await this.stageScenario();

    if (purgeAlerts) {
      await store.alerts.removeAll();
      await store.incidents.removeAll();
    }

    logger.info('GPS simulator reset');
    return this.broadcastState();
  }

  /** One manual step — handy for demos and for deterministic testing. */
  async step(): Promise<SimulationState> {
    await this.tick();
    return this.state();
  }

  /* ─────────────────────────── The tick loop ────────────────────────── */

  private scheduleLoop(): void {
    this.clearLoop();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    // Never keep the Node process alive just for the simulator.
    this.timer.unref?.();
  }

  private clearLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return; // never overlap ticks on a slow machine
    this.busy = true;
    try {
      const store = getStore();
      const vessels = (await store.vessels.list()).filter((v) => v.simulated);
      const zones = (await store.zones.list()).filter((z) => z.status === 'ENABLED');

      if (!vessels.length) {
        this.busy = false;
        return;
      }

      await this.ensureRoutes(vessels, zones);

      const dtSeconds = (this.tickMs / 1000) * this.speedMultiplier;
      const updates: LocationUpdateInput[] = [];

      for (const vessel of vessels) {
        const route = this.routes.get(vessel.vesselId);
        if (!route) continue;

        // Contacts benched by the active scenario stay at berth. They keep a
        // fresh last-seen stamp so the offline sweep leaves them alone, but they
        // emit no telemetry and never move.
        if (route.held) {
          await store.vessels.update(vessel._id, { lastSeen: nowIso(), speed: 0 });
          continue;
        }

        // Vessels that are "dark" simply stop reporting — the health sweep will
        // flag them OFFLINE, which exercises the VESSEL_OFFLINE alert path.
        if (route.darkTicks > 0) {
          route.darkTicks -= 1;
          continue;
        }

        const next = this.advance(vessel, route, zones, dtSeconds);

        await store.vessels.update(vessel._id, {
          currentLatitude: round(next.position.lat, 5),
          currentLongitude: round(next.position.lng, 5),
          direction: round(next.heading, 1),
        });

        updates.push({
          vesselId: vessel.vesselId,
          latitude: next.position.lat,
          longitude: next.position.lng,
          speed: round(next.speed, 1),
          direction: round(next.heading, 1),
          recordedAt: nowIso(),
          source: 'SIMULATOR',
        });
      }

      const results = await ingestionService.ingestMany(updates);
      for (const result of results) {
        for (const alert of result.createdAlerts) {
          if (this.knownAlertIds.has(alert.alertId)) continue;
          this.knownAlertIds.add(alert.alertId);
          this.alertsGenerated += 1;
          if (alert.alertType === 'UNAUTHORIZED_ENTRY') this.intrusionsGenerated += 1;
        }
      }

      this.ticks += 1;
      this.lastTickAt = nowIso();

      emitEvent(
        SOCKET_EVENTS.SIMULATION_TICK,
        {
          ticks: this.ticks,
          elapsedSimSeconds: Math.round(this.elapsedSimSeconds),
          activeVessels: updates.length,
          lastTickAt: this.lastTickAt,
        },
        SOCKET_ROOMS.MONITORING,
      );

      // Health sweep every 10 ticks keeps the OFFLINE transition prompt.
      if (this.ticks % 10 === 0) {
        const offline = await (await import('./vessel.service')).vesselService.sweepOffline();
        for (const vessel of offline) {
          await alertService.create({
            vessel,
            zone: null,
            alertType: 'VESSEL_OFFLINE',
            severity: 'MEDIUM',
            latitude: vessel.currentLatitude,
            longitude: vessel.currentLongitude,
            message: `Telemetry lost with ${vessel.name} ${vessel.vesselCode ?? vessel.vesselId} — last contact ${
              vessel.lastSeen ?? 'unknown'
            }.`,
            metadata: { lastSeen: vessel.lastSeen },
          });
          this.alertsGenerated += 1;
        }
      }

      if (this.ticks % 60 === 0) void this.broadcastState();
    } catch (error) {
      logger.error(`simulator tick failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /* ───────────────────────── Movement & behaviour ───────────────────── */

  private advance(
    vessel: Vessel,
    route: RouteState,
    zones: Zone[],
    dtSeconds: number,
  ): { position: LatLng; heading: number; speed: number } {
    const current: LatLng = { lat: vessel.currentLatitude, lng: vessel.currentLongitude };
    let speed = route.cruiseSpeed;

    /* Behaviour decisions */
    if (route.loiterTicks > 0) {
      route.loiterTicks -= 1;
      speed = randRange(0.4, 2.6); // slow drift → triggers the loitering detector
    } else if (route.behavior === 'INTRUDER' && route.targetZoneId) {
      // An intruder that is inside its target zone throttles back and holds
      // station for a spell, which exercises the loitering detector.
      const targetZone = zones.find((z) => z.zoneId === route.targetZoneId);
      if (
        targetZone &&
        pointInPolygon(current, targetZone.coordinates) &&
        route.decisionCooldown <= 0
      ) {
        route.loiterTicks = Math.round(randRange(8, 18));
        route.decisionCooldown = 40;
      }
    }

    if (route.decisionCooldown > 0) route.decisionCooldown -= 1;

    /* Steering: turn toward the current waypoint, capped by the turn rate. */
    const desired = bearingDegrees(current, route.target);
    const delta = clamp(angleDelta(vessel.direction, desired), -MAX_TURN_PER_TICK_DEG, MAX_TURN_PER_TICK_DEG);
    const heading = normalizeAngle(vessel.direction + delta);

    /* Advance along the heading for the simulated time slice. */
    const stepMeters = speedToStepMeters(speed, dtSeconds);
    const position = destinationPoint(current, heading, stepMeters);

    /* On reaching a waypoint, take the next one. The route loops, so a vessel that
       clears a restricted area turns around and runs the lane again — which is
       what produces the natural EXITED → re-approach cycle. */
    if (haversineMeters(position, route.target) < WAYPOINT_RADIUS_M && route.loiterTicks === 0) {
      this.assignTarget(route);
    }

    /* Gentle speed noise so the telemetry looks like a real GNSS feed. */
    route.cruiseSpeed = clamp(route.cruiseSpeed + randRange(-0.6, 0.6), 3, 40);

    return { position, heading, speed };
  }

  /** Steps to the next waypoint on the vessel's route, wrapping at the end. */
  private assignTarget(route: RouteState): void {
    route.decisionCooldown = Math.round(randRange(8, 20));
    const count = route.route.waypoints.length;
    route.waypointIndex = (route.waypointIndex + 1) % count;
    route.target = route.route.waypoints[route.waypointIndex];
  }

  /**
   * Builds (or refreshes) one route per simulated vessel.
   *
   * Route choice is by proximity: each vessel takes the sea lane whose first
   * waypoint is nearest to where it currently is. Because the seeded spawn points
   * sit on the heads of the routes they belong to, this lands the right vessel on
   * the right lane deterministically — V005, spawned at the mouth of the cape
   * intrusion run, gets that run every time rather than by luck.
   */
  private async ensureRoutes(
    vessels?: Vessel[],
    zones?: Zone[],
  ): Promise<Map<string, ParticipantSlot>> {
    const store = getStore();
    const list = vessels ?? (await store.vessels.list()).filter((v) => v.simulated);
    const activeZones = zones ?? (await store.zones.list()).filter((z) => z.status === 'ENABLED');
    const zoneByName = new Map(activeZones.map((z) => [z.name, z]));

    const plan = this.planParticipants(list, zoneByName);

    for (const [vesselId, slot] of plan) {
      const vessel = list.find((v) => v.vesselId === vesselId);
      if (!vessel) continue;
      const existing = this.routes.get(vesselId);
      // Reuse the live route state while it still matches the plan, so a tick
      // never resets a vessel's progress or its waypoint index.
      if (existing && existing.route.id === slot.route.id && existing.held === slot.held) continue;
      this.routes.set(vesselId, this.buildRouteState(vessel, slot.route, zoneByName, slot.held));
    }

    // Drop routes for vessels that vanished, stopped being simulated, or were
    // benched by the active scenario.
    for (const id of [...this.routes.keys()]) {
      if (!plan.has(id)) {
        this.routes.delete(id);
        geofenceEngine.forgetVessel(id);
      }
    }

    return plan;
  }

  /**
   * Works out who is under way and on which lane.
   *
   * Route choice within the allowed pool is still by proximity — the same
   * deterministic rule as before — but the pool is now narrowed by the scenario,
   * so an intrusion demo cannot accidentally send its lead contact down a patrol
   * box, and a patrol demo cannot produce an intrusion at all.
   */
  private planParticipants(
    vessels: Vessel[],
    zoneByName: Map<string, Zone>,
  ): Map<string, ParticipantSlot> {
    const definition = scenarioById(this.scenario) ?? scenarioById(DEFAULT_SCENARIO)!;
    const rule = definition.participants;
    const plan = new Map<string, ParticipantSlot>();
    /** How many contacts are already on each lane — used to spread the fleet. */
    const load = new Map<string, number>();
    /** Which target zones already have a contact heading for them. */
    const usedTargets = new Set<string>();

    const assign = (vessel: Vessel, route: MaritimeRoute, held: boolean): void => {
      plan.set(vessel.vesselId, { route, held });
      load.set(route.id, (load.get(route.id) ?? 0) + 1);
      if (!held) usedTargets.add(targetKey(route));
    };

    // 1. Choose the lead contact.
    const lead =
      (rule.leadVesselCode ? vessels.find((v) => v.vesselCode === rule.leadVesselCode) : undefined) ??
      (rule.leadPrefersUnauthorized
        ? vessels.find((v) => v.authorizationStatus === 'UNAUTHORIZED')
        : vessels[0]);

    if (lead) {
      const route = this.pickRoute(
        lead,
        rule.leadRouteScenarios,
        zoneByName,
        load,
        usedTargets,
        rule.leadRouteId,
      );
      if (route) assign(lead, route, false);
    }

    // 2. Fill the background traffic from the remaining contacts.
    const rest = vessels.filter((v) => v.vesselId !== lead?.vesselId);
    const backgroundCount = rule.all ? rest.length : rule.background;
    const background = rest.slice(0, Math.max(0, backgroundCount));

    for (const vessel of background) {
      const route = this.pickRoute(vessel, rule.backgroundRouteScenarios, zoneByName, load, usedTargets);
      if (route) assign(vessel, route, false);
    }

    // 3. Everyone else is held at berth.
    for (const vessel of vessels) {
      if (plan.has(vessel.vesselId)) continue;
      const fallback = this.pickRoute(vessel, ['PATROL', 'TRANSIT'], zoneByName, load, usedTargets);
      if (fallback) assign(vessel, fallback, true);
    }

    return plan;
  }

  /**
   * Picks a lane for a contact.
   *
   * Two filters narrow the choice before proximity decides it. First, the
   * scenario's allowed set. Second, what the contact's authorization makes
   * sense for: an unauthorized boat belongs on an intrusion or approach lane,
   * a licensed unit on a patrol box or a transit lane.
   *
   * The nearest lane wins, but two penalties push the fleet apart: a large one
   * for a target zone that already has a contact heading for it, and a small one
   * per contact already on the same lane. Without them, every unauthorized
   * contact piles onto whichever restricted area happens to be closest — a
   * multi-vessel run would hit one zone twenty times and leave the other
   * untouched, which is not much of a "multiple vessel" demonstration.
   */
  private pickRoute(
    vessel: Vessel,
    allowed: RouteScenario[],
    zoneByName: Map<string, Zone>,
    load: Map<string, number>,
    usedTargets: Set<string>,
    forcedRouteId?: string,
  ): MaritimeRoute | null {
    if (forcedRouteId) {
      const forced = routeById(forcedRouteId);
      if (forced && (!forced.targetZoneName || zoneByName.has(forced.targetZoneName))) {
        return forced;
      }
    }

    const appropriate: RouteScenario[] =
      vessel.authorizationStatus === 'UNAUTHORIZED'
        ? ['INTRUSION', 'APPROACH', 'TRANSIT']
        : ['PATROL', 'TRANSIT', 'WITHDRAWAL'];
    const narrowed = allowed.filter((scenario) => appropriate.includes(scenario));
    const effective = narrowed.length ? narrowed : appropriate;

    const pool = MARITIME_ROUTES.filter(
      (route) =>
        effective.includes(route.scenario) &&
        // A route that names a zone is only usable while that zone exists.
        (!route.targetZoneName || zoneByName.has(route.targetZoneName)),
    );

    const usable = pool.length ? pool : MARITIME_ROUTES.filter((r) => !r.targetZoneName);
    if (!usable.length) return null;

    const here: LatLng = { lat: vessel.currentLatitude, lng: vessel.currentLongitude };
    let best = usable[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of usable) {
      const score =
        haversineMeters(here, candidate.waypoints[0]) +
        (usedTargets.has(targetKey(candidate)) ? TARGET_REUSE_PENALTY_M : 0) +
        (load.get(candidate.id) ?? 0) * LANE_SPREAD_PENALTY_M;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private buildRouteState(
    vessel: Vessel,
    route: MaritimeRoute,
    zoneByName: Map<string, Zone>,
    held = false,
  ): RouteState {
    const zone = route.targetZoneName ? zoneByName.get(route.targetZoneName) : undefined;
    const behavior: Behavior =
      route.scenario === 'INTRUSION' ? 'INTRUDER' : route.scenario === 'TRANSIT' ? 'TRANSIT' : 'PATROL';

    return {
      behavior,
      route,
      waypointIndex: 0,
      target: route.waypoints[0],
      targetZoneId: zone?.zoneId ?? null,
      // The lane dictates the speed: a patrol box is worked slowly, a contact
      // running a restricted-area lane does 30 km/h. Without this the demo took
      // a quarter of an hour to reach the boundary at 10×.
      cruiseSpeed: clamp(route.cruiseSpeedKmh || vessel.speed || randRange(8, 18), 4, 40),
      loiterTicks: 0,
      darkTicks:
        !held && Math.random() < DARK_VESSEL_RATIO ? Math.round(randRange(20, 45)) : 0,
      decisionCooldown: Math.round(randRange(5, 30)),
      held,
    };
  }

  /* ───────────────────────────── Reporting ──────────────────────────── */

  get elapsedSimSeconds(): number {
    return (this.ticks * this.tickMs * this.speedMultiplier) / 1000;
  }

  state(): SimulationState {
    return {
      status: this.status,
      scenario: this.scenario,
      scenarioName: scenarioById(this.scenario)?.name ?? this.scenario,
      speedMultiplier: this.speedMultiplier,
      tickMs: this.tickMs,
      ticks: this.ticks,
      elapsedSimSeconds: Math.round(this.elapsedSimSeconds),
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      trackedVessels: this.routes.size,
      zonesAvailable: 0,
      ticksPerSecond: round(1000 / this.tickMs, 2),
      intrusionsGenerated: this.intrusionsGenerated,
      alertsGenerated: this.alertsGenerated,
    };
  }

  async snapshot(): Promise<SimulationState> {
    const zones = await getStore().zones.list();
    return { ...this.state(), zonesAvailable: zones.filter((z) => z.status === 'ENABLED').length };
  }

  private broadcastState(): SimulationState {
    const payload = this.state();
    emitEvent(SOCKET_EVENTS.SIMULATION_STATE, payload, SOCKET_ROOMS.MONITORING);
    return payload;
  }

  /** The scenario catalogue, for the simulator's scenario selector. */
  scenarios(): ScenarioSummary[] {
    return SCENARIO_LIST.map((definition) => ({
      id: definition.id,
      name: definition.name,
      summary: definition.summary,
      timeline: definition.timeline,
    }));
  }

  activeScenario(): ScenarioDefinition {
    return scenarioById(this.scenario) ?? scenarioById(DEFAULT_SCENARIO)!;
  }

  /** Route assignment per vessel — shown in the simulator console. */
  routeTable(): Array<{
    vesselId: string;
    behavior: Behavior;
    routeId: string;
    routeName: string;
    scenario: MaritimeRoute['scenario'];
    waypointIndex: number;
    waypointCount: number;
    held: boolean;
    targetZoneId: string | null;
  }> {
    return [...this.routes.entries()].map(([vesselId, route]) => ({
      vesselId,
      behavior: route.behavior,
      routeId: route.route.id,
      routeName: route.route.name,
      scenario: route.route.scenario,
      waypointIndex: route.waypointIndex,
      waypointCount: route.route.waypoints.length,
      held: route.held,
      targetZoneId: route.targetZoneId,
    }));
  }

  isRunning(): boolean {
    return this.status === 'RUNNING';
  }

  async autostartIfConfigured(): Promise<void> {
    if (!env.simulation.autostart) return;
    await this.start();
  }
}

export const simulationEngine = new SimulationEngine();

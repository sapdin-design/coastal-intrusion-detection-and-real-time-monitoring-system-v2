import { SOCKET_EVENTS, SOCKET_ROOMS, THEATRE } from '../config/constants';
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
  polygonCentroid,
  randomPointInBounds,
  speedToStepMeters,
} from '../utils/geo';
import { alertService } from './alert.service';
import { geofenceEngine } from './geofence.service';
import { ingestionService } from './ingestion.service';

type Behavior = 'PATROL' | 'TRANSIT' | 'INTRUDER';

interface RouteState {
  behavior: Behavior;
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
}

export interface SimulationState {
  status: SimulationStatus;
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

    const vessels = await store.vessels.list();
    for (const vessel of vessels) {
      if (!vessel.simulated) continue;
      const start = randomPointInBounds(THEATRE.bounds);
      await store.vessels.update(vessel._id, {
        currentLatitude: round(start.lat, 5),
        currentLongitude: round(start.lng, 5),
        speed: round(randRange(5, 16), 1),
        direction: round(randRange(0, 360), 0),
        status: 'ACTIVE',
        riskScore: vessel.authorizationStatus === 'UNAUTHORIZED' ? 45 : 10,
        lastSeen: nowIso(),
      });
    }

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
            message: `Telemetry lost for ${vessel.name} (${vessel.vesselId}) — last contact ${
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
    } else if (route.behavior === 'INTRUDER') {
      const targetZone = zones.find((z) => z.zoneId === route.targetZoneId);
      if (targetZone) {
        const inside =
          haversineMeters(current, polygonCentroid(targetZone.coordinates)) <
          Math.sqrt(
            zones.find((z) => z.zoneId === targetZone.zoneId)!.coordinates.reduce(
              (acc, v) => acc + haversineMeters(polygonCentroid(targetZone.coordinates), v),
              0,
            ) / targetZone.coordinates.length,
          );
        route.target = polygonCentroid(targetZone.coordinates);
        if (inside && route.decisionCooldown <= 0) {
          route.loiterTicks = Math.round(randRange(8, 18));
          route.decisionCooldown = 40;
        }
      }
    }

    if (route.decisionCooldown > 0) route.decisionCooldown -= 1;

    /* Steering: turn toward the target, capped by the turn rate. */
    const desired = bearingDegrees(current, route.target);
    const delta = clamp(angleDelta(vessel.direction, desired), -MAX_TURN_PER_TICK_DEG, MAX_TURN_PER_TICK_DEG);
    const heading = normalizeAngle(vessel.direction + delta);

    /* Advance along the heading for the simulated time slice. */
    const stepMeters = speedToStepMeters(speed, dtSeconds);
    const position = destinationPoint(current, heading, stepMeters);

    /* Re-target when the waypoint is reached. */
    if (haversineMeters(position, route.target) < WAYPOINT_RADIUS_M && route.loiterTicks === 0) {
      this.assignTarget(vessel, route, zones);
    }

    /* Keep every vessel inside the theatre bounding box. */
    if (
      position.lat < THEATRE.bounds.minLat ||
      position.lat > THEATRE.bounds.maxLat ||
      position.lng < THEATRE.bounds.minLng ||
      position.lng > THEATRE.bounds.maxLng
    ) {
      route.target = randomPointInBounds(THEATRE.bounds);
    }

    /* Gentle speed noise so the telemetry looks like a real GNSS feed. */
    route.cruiseSpeed = clamp(route.cruiseSpeed + randRange(-0.6, 0.6), 3, 26);

    return { position, heading, speed };
  }

  private assignTarget(vessel: Vessel, route: RouteState, zones: Zone[]): void {
    route.decisionCooldown = Math.round(randRange(15, 45));

    if (route.behavior === 'INTRUDER' && zones.length) {
      const next = zones[Math.floor(Math.random() * zones.length)];
      route.targetZoneId = next.zoneId;
      route.target = polygonCentroid(next.coordinates);
      return;
    }

    route.target = randomPointInBounds(THEATRE.bounds);
    route.targetZoneId = null;
  }

  /**
   * Builds (or refreshes) one route per simulated vessel. Behaviours are derived
   * from the vessel record, so adding an unauthorized vessel in the UI
   * automatically produces an intruder on the next tick.
   */
  private async ensureRoutes(vessels?: Vessel[], zones?: Zone[]): Promise<void> {
    const store = getStore();
    const list = vessels ?? (await store.vessels.list()).filter((v) => v.simulated);
    const activeZones = zones ?? (await store.zones.list()).filter((z) => z.status === 'ENABLED');
    const zoneCentroids = activeZones.map((z) => ({ zoneId: z.zoneId, point: polygonCentroid(z.coordinates) }));

    for (const vessel of list) {
      const existing = this.routes.get(vessel.vesselId);
      const wanted: Behavior =
        vessel.authorizationStatus === 'UNAUTHORIZED'
          ? Math.random() < 0.65
            ? 'INTRUDER'
            : 'TRANSIT'
          : Math.random() < 0.25
            ? 'TRANSIT'
            : 'PATROL';

      if (existing) {
        // Promote a patrol vessel to intruder the moment it loses authorization.
        if (vessel.authorizationStatus === 'UNAUTHORIZED' && existing.behavior !== 'INTRUDER') {
          existing.behavior = 'INTRUDER';
          if (zoneCentroids.length) {
            const pick = zoneCentroids[Math.floor(Math.random() * zoneCentroids.length)];
            existing.targetZoneId = pick.zoneId;
            existing.target = pick.point;
          }
        } else if (vessel.authorizationStatus === 'AUTHORIZED' && existing.behavior === 'INTRUDER') {
          existing.behavior = 'PATROL';
          existing.targetZoneId = null;
          existing.target = randomPointInBounds(THEATRE.bounds);
        }
        continue;
      }

      const target =
        wanted === 'INTRUDER' && zoneCentroids.length
          ? zoneCentroids[Math.floor(Math.random() * zoneCentroids.length)]
          : null;

      this.routes.set(vessel.vesselId, {
        behavior: wanted,
        target: target?.point ?? randomPointInBounds(THEATRE.bounds),
        targetZoneId: target?.zoneId ?? null,
        cruiseSpeed: clamp(vessel.speed || randRange(8, 18), 4, 24),
        loiterTicks: 0,
        darkTicks: Math.random() < DARK_VESSEL_RATIO ? Math.round(randRange(20, 45)) : 0,
        decisionCooldown: Math.round(randRange(5, 30)),
      });
    }

    // Drop routes for vessels that vanished or stopped being simulated.
    const live = new Set(list.map((v) => v.vesselId));
    for (const id of [...this.routes.keys()]) if (!live.has(id)) this.routes.delete(id);
  }

  /* ───────────────────────────── Reporting ──────────────────────────── */

  get elapsedSimSeconds(): number {
    return (this.ticks * this.tickMs * this.speedMultiplier) / 1000;
  }

  state(): SimulationState {
    return {
      status: this.status,
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

  /** Route assignment per vessel — shown in the simulator console. */
  routeTable(): Array<{ vesselId: string; behavior: Behavior; targetZoneId: string | null }> {
    return [...this.routes.entries()].map(([vesselId, route]) => ({
      vesselId,
      behavior: route.behavior,
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

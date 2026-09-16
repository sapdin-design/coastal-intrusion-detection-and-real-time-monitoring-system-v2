import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import type {
  Alert,
  Incident,
  IngestionResult,
  LocationUpdateInput,
  Vessel,
  Zone,
} from '../types/domain';
import { businessId, normalizeAngle, nowIso, round } from '../utils/ids';
import { bearingDegrees, haversineMeters } from '../utils/geo';
import { alertService } from './alert.service';
import { geofenceEngine } from './geofence.service';
import { incidentService } from './incident.service';
import { vesselService } from './vessel.service';

/** Compact payload broadcast to the live map on every accepted position. */
export interface LocationBroadcast {
  vesselId: string;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  direction: number;
  status: Vessel['status'];
  authorizationStatus: Vessel['authorizationStatus'];
  vesselType: Vessel['vesselType'];
  riskScore: number;
  lastSeen: string;
  nearestZone: string | null;
  nearestDistanceMeters: number | null;
  state: 'OUTSIDE' | 'APPROACHING' | 'INSIDE';
  verdict: 'NORMAL' | 'WARNING' | 'AUTHORIZED_ENTRY' | 'INTRUSION';
}

/**
 * The single entry point for vessel positions — the seam that makes the whole
 * architecture future-proof.
 *
 * Today the GPS simulator posts here. Tomorrow a Raspberry Pi reading a real GNSS
 * module posts the *same* JSON to `POST /api/v1/telemetry` (see the GNSS bridge in
 * the README) and every downstream capability — geofencing, alerts, incidents,
 * realtime dashboard, history — keeps working untouched. No hardware dependency
 * exists in this codebase; the simulator is just one client of this API.
 */
class IngestionService {
  private readonly appendCounters = new Map<string, number>();

  async ingest(input: LocationUpdateInput): Promise<IngestionResult> {
    const store = getStore();

    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw Object.assign(new Error('latitude must be a number between -90 and 90'), { status: 422 });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw Object.assign(new Error('longitude must be a number between -180 and 180'), {
        status: 422,
      });
    }

    const vessel = await vesselService.require(input.vesselId);
    const previousPosition = { lat: vessel.currentLatitude, lng: vessel.currentLongitude };
    const recordedAt = input.recordedAt ?? nowIso();

    /* ── 1. derive motion ─────────────────────────────────────────────── */

    const moved = haversineMeters(previousPosition, { lat: latitude, lng: longitude });
    const derivedDirection =
      moved > 5 ? bearingDegrees(previousPosition, { lat: latitude, lng: longitude }) : vessel.direction;
    const direction = normalizeAngle(round(input.direction ?? derivedDirection, 1));
    const speed = round(Math.max(0, input.speed ?? vessel.speed), 1);

    /* ── 2. persist the new state ─────────────────────────────────────── */

    const updatedVessel = await store.vessels.update(vessel._id, {
      currentLatitude: round(latitude, 5),
      currentLongitude: round(longitude, 5),
      speed,
      direction,
      lastSeen: recordedAt,
    });
    if (!updatedVessel) throw Object.assign(new Error('Vessel not found'), { status: 404 });

    /* ── 3. append to the track history (capped, pruned periodically) ─── */

    await store.tracks.append({
      _id: businessId('track'),
      vesselId: vessel.vesselId,
      lat: round(latitude, 5),
      lng: round(longitude, 5),
      speed,
      direction,
      recordedAt,
      source: input.source ?? 'SIMULATOR',
    });
    await this.maybePrune(vessel.vesselId);

    /* ── 4. run the geofencing engine ─────────────────────────────────── */

    const zones = await store.zones.list();
    const { evaluations, events } = geofenceEngine.process(updatedVessel, zones);

    /* ── 5. escalate events into alerts and incidents ─────────────────── */

    const createdAlerts: Alert[] = [];
    const createdIncidents: Incident[] = [];

    for (const event of events) {
      if (!event.alertType) {
        logger.debug(`geofence ${event.kind}: ${event.message}`);
        continue;
      }

      const alert = await alertService.create({
        vessel: event.vessel,
        zone: event.zone,
        alertType: event.alertType,
        severity: event.severity,
        latitude: event.vessel.currentLatitude,
        longitude: event.vessel.currentLongitude,
        message: event.message,
        metadata: {
          geofenceState: event.state,
          verdict: event.verdict,
          distanceMeters: event.distanceMeters,
          speedKmh: event.vessel.speed,
          heading: event.vessel.direction,
        },
      });
      createdAlerts.push(alert);

      if (event.opensIncident) {
        const incident = await incidentService.createFromIntrusion({
          alert,
          vessel: event.vessel,
          zone: event.zone,
          severity: event.severity,
        });
        createdIncidents.push(incident);
        await alertService.linkIncident(alert.alertId, incident.incidentId);

        emitEvent(
          SOCKET_EVENTS.INTRUSION_DETECTED,
          {
            alert,
            incident,
            vessel: event.vessel,
            zone: { zoneId: event.zone.zoneId, name: event.zone.name, zoneType: event.zone.zoneType },
            detectedAt: nowIso(),
          },
          SOCKET_ROOMS.MONITORING,
        );
      }
    }

    /* ── 6. recompute the vessel's operational status ─────────────────── */

    const nextStatus = geofenceEngine.statusFromEvaluations(evaluations);
    const withStatus = await vesselService.setStatus(updatedVessel, nextStatus);
    const withRisk = await vesselService.setRiskScore(
      withStatus,
      this.riskDelta(evaluations.some((e) => e.verdict === 'INTRUSION'), createdAlerts.length > 0),
    );

    /* ── 7. broadcast ─────────────────────────────────────────────────── */

    const nearest = evaluations[0] ?? null;
    const broadcast: LocationBroadcast = {
      vesselId: withRisk.vesselId,
      name: withRisk.name,
      latitude: withRisk.currentLatitude,
      longitude: withRisk.currentLongitude,
      speed: withRisk.speed,
      direction: withRisk.direction,
      status: withRisk.status,
      authorizationStatus: withRisk.authorizationStatus,
      vesselType: withRisk.vesselType,
      riskScore: withRisk.riskScore,
      lastSeen: withRisk.lastSeen ?? recordedAt,
      nearestZone: nearest?.zoneName ?? null,
      nearestDistanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
      state: nearest?.state ?? 'OUTSIDE',
      verdict: nearest?.verdict ?? 'NORMAL',
    };
    emitEvent(SOCKET_EVENTS.VESSEL_LOCATION_UPDATED, broadcast, SOCKET_ROOMS.MONITORING);

    return {
      vessel: withRisk,
      evaluations,
      createdAlerts,
      createdIncidents,
      statusChanged: withStatus.status !== updatedVessel.status || nextStatus !== vessel.status,
    };
  }

  /** Batch helper for the simulator: one store round-trip per tick instead of N. */
  async ingestMany(inputs: LocationUpdateInput[]): Promise<IngestionResult[]> {
    const results: IngestionResult[] = [];
    for (const input of inputs) {
      try {
        results.push(await this.ingest(input));
      } catch (error) {
        logger.warn(`telemetry rejected for ${input.vesselId}: ${(error as Error).message}`);
      }
    }
    return results;
  }

  /** Risk grows with confirmed intrusions, decays slowly when the vessel is clean. */
  private riskDelta(intrusion: boolean, alerted: boolean): number {
    if (intrusion) return 12;
    if (alerted) return 4;
    return -1;
  }

  private async maybePrune(vesselId: string): Promise<void> {
    const count = (this.appendCounters.get(vesselId) ?? 0) + 1;
    if (count % 100 === 0) {
      await getStore().tracks.prune(vesselId, env.vessel.trackPointsPerVessel);
      this.appendCounters.set(vesselId, 0);
      return;
    }
    this.appendCounters.set(vesselId, count);
  }

  /** Route history for the map's track polyline. */
  async track(vesselId: string, limit = 300) {
    return getStore().tracks.listByVessel(vesselId, limit);
  }

  /** Most recent accepted position per vessel, used to seed the dashboard on load. */
  async latestByVessel(): Promise<Record<string, LocationBroadcast>> {
    const vessels = await getStore().vessels.list();
    const zones: Zone[] = await getStore().zones.list();
    const out: Record<string, LocationBroadcast> = {};

    for (const vessel of vessels) {
      const evaluations = geofenceEngine.evaluateVessel(vessel, zones);
      const nearest = evaluations[0] ?? null;
      out[vessel.vesselId] = {
        vesselId: vessel.vesselId,
        name: vessel.name,
        latitude: vessel.currentLatitude,
        longitude: vessel.currentLongitude,
        speed: vessel.speed,
        direction: vessel.direction,
        status: vessel.status,
        authorizationStatus: vessel.authorizationStatus,
        vesselType: vessel.vesselType,
        riskScore: vessel.riskScore,
        lastSeen: vessel.lastSeen ?? vessel.updatedAt,
        nearestZone: nearest?.zoneName ?? null,
        nearestDistanceMeters: nearest ? Math.round(nearest.distanceMeters) : null,
        state: nearest?.state ?? 'OUTSIDE',
        verdict: nearest?.verdict ?? 'NORMAL',
      };
    }
    return out;
  }
}

export const ingestionService = new IngestionService();

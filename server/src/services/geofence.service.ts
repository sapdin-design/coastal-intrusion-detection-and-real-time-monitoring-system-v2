import { APPROACH_SEVERITY } from '../config/constants';
import { env } from '../config/env';
import { logger } from '../config/logger';
import type {
  AlertType,
  GeofenceState,
  GeofenceVerdict,
  LatLng,
  Severity,
  Vessel,
  VesselStatus,
  Zone,
} from '../types/domain';
import { distanceToPolygonMeters, pointInPolygon } from '../utils/geo';
import { round } from '../utils/ids';

/** Speed below which a vessel inside or near a zone is considered to be loitering. */
const LOITER_SPEED_KMH = 3.5;

export interface ZoneEvaluation {
  zoneId: string;
  zoneName: string;
  zoneType: Zone['zoneType'];
  state: GeofenceState;
  verdict: GeofenceVerdict;
  distanceMeters: number;
  severity: Severity;
}

export interface GeofenceEvent {
  kind: 'ENTERED' | 'APPROACHING' | 'EXITED' | 'LOITERING';
  alertType: AlertType | null;
  vessel: Vessel;
  zone: Zone;
  state: GeofenceState;
  verdict: GeofenceVerdict;
  distanceMeters: number;
  severity: Severity;
  message: string;
  /** True when this event must open an incident (confirmed intrusion). */
  opensIncident: boolean;
}

interface VesselZoneState {
  state: GeofenceState;
  verdict: GeofenceVerdict;
  lastAlertAt: number;
  loiterTicks: number;
  enteredAt: string | null;
}

const key = (vesselId: string, zoneId: string): string => `${vesselId}::${zoneId}`;

/**
 * Geofencing engine.
 *
 * Runs the state machine described in the specification for every
 * (vessel, zone) pair on every position update:
 *
 *   OUTSIDE      → NORMAL
 *   APPROACHING  → WARNING
 *   INSIDE + authorized   → AUTHORIZED_ENTRY
 *   INSIDE + unauthorized → INTRUSION
 *
 * Duplicate suppression is handled here rather than in the alert service: the
 * engine remembers the last state *and* the timestamp of the last alert for each
 * pair, so a vessel sitting inside a restricted zone for an hour raises one
 * intrusion, not 3 600 of them. `GEOFENCE_ALERT_COOLDOWN_MS` re-arms the alert if
 * the situation persists.
 */
export class GeofenceEngine {
  private readonly states = new Map<string, VesselZoneState>();

  /** Position of one point relative to one polygon. */
  evaluatePoint(point: LatLng, zone: Zone): { state: GeofenceState; distanceMeters: number } {
    const ring = zone.coordinates;
    if (ring.length < 3) return { state: 'OUTSIDE', distanceMeters: Number.POSITIVE_INFINITY };

    if (pointInPolygon(point, ring)) return { state: 'INSIDE', distanceMeters: 0 };

    const distance = distanceToPolygonMeters(point, ring);
    const buffer = zone.approachBufferMeters ?? env.geofence.approachBufferMeters;
    return {
      state: distance <= buffer ? 'APPROACHING' : 'OUTSIDE',
      distanceMeters: round(distance, 1),
    };
  }

  /** Full evaluation of a vessel against every enabled zone, most urgent first. */
  evaluateVessel(vessel: Vessel, zones: Zone[]): ZoneEvaluation[] {
    const point: LatLng = { lat: vessel.currentLatitude, lng: vessel.currentLongitude };
    return zones
      .filter((z) => z.status === 'ENABLED')
      .map((zone) => {
        const { state, distanceMeters } = this.evaluatePoint(point, zone);
        const verdict = this.resolveVerdict(state, vessel.authorizationStatus === 'AUTHORIZED');
        return {
          zoneId: zone.zoneId,
          zoneName: zone.name,
          zoneType: zone.zoneType,
          state,
          verdict,
          distanceMeters,
          severity: this.severityFor(zone, verdict),
        };
      })
      .sort((a, b) => urgency(b) - urgency(a));
  }

  /** The mapping from the specification, kept as a pure function so it is testable. */
  resolveVerdict(state: GeofenceState, isAuthorized: boolean): GeofenceVerdict {
    if (state === 'OUTSIDE') return 'NORMAL';
    if (state === 'APPROACHING') return 'WARNING';
    return isAuthorized ? 'AUTHORIZED_ENTRY' : 'INTRUSION';
  }

  severityFor(zone: Zone, verdict: GeofenceVerdict): Severity {
    switch (verdict) {
      case 'INTRUSION':
        // A confirmed intrusion is never below HIGH, whatever the zone says.
        return zone.severity === 'CRITICAL' || zone.severity === 'HIGH' ? zone.severity : 'HIGH';
      case 'WARNING':
        return APPROACH_SEVERITY[zone.severity];
      case 'AUTHORIZED_ENTRY':
        return 'LOW';
      default:
        return 'LOW';
    }
  }

  /**
   * Advances the state machine and returns only the events that deserve a
   * notification. Called once per ingested position.
   */
  process(vessel: Vessel, zones: Zone[]): { evaluations: ZoneEvaluation[]; events: GeofenceEvent[] } {
    const evaluations = this.evaluateVessel(vessel, zones);
    const events: GeofenceEvent[] = [];
    const now = Date.now();
    const authorized = vessel.authorizationStatus === 'AUTHORIZED';

    for (const evaluation of evaluations) {
      const zone = zones.find((z) => z.zoneId === evaluation.zoneId);
      if (!zone) continue;

      const stateKey = key(vessel.vesselId, evaluation.zoneId);
      const previous: VesselZoneState =
        this.states.get(stateKey) ?? {
          state: 'OUTSIDE',
          verdict: 'NORMAL',
          lastAlertAt: 0,
          loiterTicks: 0,
          enteredAt: null,
        };

      const coolingDown = now - previous.lastAlertAt < env.geofence.alertCooldownMs;
      const next: VesselZoneState = { ...previous, state: evaluation.state, verdict: evaluation.verdict };

      /* ── state transitions ─────────────────────────────────────────── */

      if (evaluation.state === 'INSIDE') {
        const isNewEntry = previous.state !== 'INSIDE';
        if (isNewEntry) next.enteredAt = new Date().toISOString();

        if (!authorized) {
          // Intrusion: alert on entry, then re-alert only after the cooldown.
          if (isNewEntry || !coolingDown) {
            next.lastAlertAt = now;
            events.push({
              kind: 'ENTERED',
              alertType: 'UNAUTHORIZED_ENTRY',
              vessel,
              zone,
              state: evaluation.state,
              verdict: 'INTRUSION',
              distanceMeters: 0,
              severity: this.severityFor(zone, 'INTRUSION'),
              message: `UNAUTHORIZED vessel ${vessel.name} (${vessel.vesselId}) entered ${zone.name}${
                isNewEntry ? '' : ' and remains inside'
              }.`,
              opensIncident: isNewEntry,
            });
          }
        } else if (isNewEntry) {
          // Authorized transit: recorded, never escalated to an alert.
          events.push({
            kind: 'ENTERED',
            alertType: null,
            vessel,
            zone,
            state: evaluation.state,
            verdict: 'AUTHORIZED_ENTRY',
            distanceMeters: 0,
            severity: 'LOW',
            message: `Authorized vessel ${vessel.name} (${vessel.vesselId}) entered ${zone.name}.`,
            opensIncident: false,
          });
        }
      } else if (evaluation.state === 'APPROACHING') {
        if (previous.state !== 'APPROACHING') {
          if (!coolingDown) {
            next.lastAlertAt = now;
            events.push({
              kind: 'APPROACHING',
              alertType: 'ZONE_APPROACH',
              vessel,
              zone,
              state: evaluation.state,
              verdict: 'WARNING',
              distanceMeters: evaluation.distanceMeters,
              severity: this.severityFor(zone, 'WARNING'),
              message: `${vessel.name} (${vessel.vesselId}) is approaching ${zone.name} — ${Math.round(
                evaluation.distanceMeters,
              )} m from the boundary.`,
              opensIncident: false,
            });
          }
        }
      } else if (previous.state !== 'OUTSIDE') {
        // Left the zone / buffer — clear the episode so the next entry alerts again.
        events.push({
          kind: 'EXITED',
          alertType: null,
          vessel,
          zone,
          state: 'OUTSIDE',
          verdict: 'NORMAL',
          distanceMeters: evaluation.distanceMeters,
          severity: 'LOW',
          message: `${vessel.name} (${vessel.vesselId}) cleared ${zone.name}.`,
          opensIncident: false,
        });
        next.loiterTicks = 0;
        next.enteredAt = null;
      }

      /* ── loitering / erratic behaviour ─────────────────────────────── */

      if (evaluation.state !== 'OUTSIDE' && vessel.speed < LOITER_SPEED_KMH) {
        next.loiterTicks = previous.loiterTicks + 1;
        if (next.loiterTicks === env.geofence.loiterTicks && !coolingDown) {
          next.lastAlertAt = now;
          events.push({
            kind: 'LOITERING',
            alertType: 'SUSPICIOUS_MOVEMENT',
            vessel,
            zone,
            state: evaluation.state,
            verdict: evaluation.verdict,
            distanceMeters: evaluation.distanceMeters,
            severity: 'MEDIUM',
            message: `${vessel.name} (${vessel.vesselId}) has been loitering ${
              evaluation.state === 'INSIDE' ? 'inside' : 'next to'
            } ${zone.name} at ${vessel.speed.toFixed(1)} km/h.`,
            opensIncident: false,
          });
        }
      } else {
        next.loiterTicks = 0;
      }

      this.states.set(stateKey, next);
    }

    return { evaluations, events };
  }

  /** Aggregate vessel status implied by the evaluations (spec §10). */
  statusFromEvaluations(evaluations: ZoneEvaluation[]): VesselStatus {
    if (evaluations.some((e) => e.verdict === 'INTRUSION')) return 'INTRUSION';
    if (evaluations.some((e) => e.verdict === 'WARNING')) return 'WARNING';
    return 'ACTIVE';
  }

  /** Forgets one vessel — called when a vessel is deleted. */
  forgetVessel(vesselId: string): void {
    for (const k of [...this.states.keys()]) {
      if (k.startsWith(`${vesselId}::`)) this.states.delete(k);
    }
  }

  /** Forgets every zone episode — called when a zone is edited or deleted. */
  forgetZone(zoneId: string): void {
    for (const k of [...this.states.keys()]) {
      if (k.endsWith(`::${zoneId}`)) this.states.delete(k);
    }
  }

  reset(): void {
    this.states.clear();
    logger.debug('geofence engine state cleared');
  }

  snapshotSize(): number {
    return this.states.size;
  }
}

const urgency = (e: ZoneEvaluation): number =>
  e.verdict === 'INTRUSION' ? 3 : e.verdict === 'WARNING' ? 2 : e.verdict === 'AUTHORIZED_ENTRY' ? 1 : 0;

/** Shared singleton — the state cache must survive across requests. */
export const geofenceEngine = new GeofenceEngine();

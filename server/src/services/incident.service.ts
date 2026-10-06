import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import {
  INCIDENT_TRANSITIONS,
  type Actor,
  type Alert,
  type Incident,
  type IncidentStatus,
  type IncidentTimelineEntry,
  type LatLng,
  type Severity,
  type Vessel,
  type Zone,
} from '../types/domain';
import { businessId, minutesBetween, nowIso, titleCase } from '../utils/ids';

export interface CreateIncidentInput {
  alert?: Alert | null;
  vessel: Vessel;
  zone?: Zone | null;
  severity: Severity;
  title?: string;
  description?: string;
  location?: LatLng;
}

export interface IncidentQuery {
  status?: IncidentStatus;
  severity?: Severity;
  vesselId?: string;
  zoneId?: string;
  assignedTo?: string;
  search?: string;
  openOnly?: boolean;
}

const CLOSED_STATES: IncidentStatus[] = ['RESOLVED', 'CLOSED'];

export class IncidentService {
  /**
   * A confirmed intrusion always produces an incident. The alert is linked in
   * both directions so the dashboard can navigate alert → incident → alert.
   */
  async createFromIntrusion(input: CreateIncidentInput): Promise<Incident> {
    const store = getStore();
    const { vessel, zone, alert } = input;
    const at = nowIso();

    const timeline: IncidentTimelineEntry[] = [
      {
        at,
        status: 'OPEN',
        by: 'geofencing-engine',
        note: `Auto-generated from ${alert ? `alert ${alert.alertId}` : 'geofence evaluation'}.`,
      },
    ];

    const incident: Incident = {
      _id: businessId('incident'),
      incidentId: businessId('incident'),
      alertId: alert?.alertId ?? null,
      vesselId: vessel.vesselId,
      vesselName: vessel.name,
      zoneId: zone?.zoneId ?? null,
      zoneName: zone?.name ?? null,
      title:
        input.title ??
        `${vessel.name} ${vessel.vesselCode ?? vessel.vesselId} — unauthorized entry into ${
          zone?.name ?? 'restricted waters'
        }`,
      description:
        input.description ??
        `${input.severity ?? 'HIGH'} — ${vessel.name} ${vessel.vesselCode ?? vessel.vesselId} crossed into ` +
          `${zone?.name ?? 'a restricted zone'} without authorization, making ` +
          `${(vessel.speed / 1.852).toFixed(1)} kn on heading ${Math.round(vessel.direction)}°. ` +
          `The contact was tracked by the geofencing engine from open water.`,
      severity: input.severity,
      status: 'OPEN',
      location: input.location ?? { lat: vessel.currentLatitude, lng: vessel.currentLongitude },
      assignedTo: null,
      timeline,
      acknowledgedAt: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: at,
      updatedAt: at,
    };

    const saved = await store.incidents.create(incident);
    emitEvent(SOCKET_EVENTS.INCIDENT_CREATED, saved, SOCKET_ROOMS.INCIDENTS);
    logger.warn(`incident ${saved.incidentId} opened [${saved.severity}] — ${saved.title}`);
    return saved;
  }

  async list(query: IncidentQuery = {}): Promise<Incident[]> {
    let rows = await getStore().incidents.list();

    if (query.status) rows = rows.filter((i) => i.status === query.status);
    if (query.openOnly) rows = rows.filter((i) => !CLOSED_STATES.includes(i.status));
    if (query.severity) rows = rows.filter((i) => i.severity === query.severity);
    if (query.vesselId) rows = rows.filter((i) => i.vesselId === query.vesselId);
    if (query.zoneId) rows = rows.filter((i) => i.zoneId === query.zoneId);
    if (query.assignedTo) rows = rows.filter((i) => i.assignedTo === query.assignedTo);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          i.description.toLowerCase().includes(needle) ||
          i.incidentId.toLowerCase().includes(needle) ||
          i.vesselName.toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }

  async getByIncidentId(incidentId: string): Promise<Incident | null> {
    return getStore().incidents.findByIncidentId(incidentId);
  }

  /**
   * Enforces the workflow: OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED.
   * Any attempt to jump backwards outside `INCIDENT_TRANSITIONS` is rejected.
   */
  async transition(
    incidentId: string,
    next: IncidentStatus,
    actor: Actor,
    note = '',
  ): Promise<Incident> {
    const store = getStore();
    const existing = await store.incidents.findByIncidentId(incidentId);
    if (!existing) throw Object.assign(new Error('Incident not found'), { status: 404 });

    if (existing.status === next) return existing;

    const allowed = INCIDENT_TRANSITIONS[existing.status];
    if (!allowed.includes(next)) {
      throw Object.assign(
        new Error(
          `Illegal transition ${existing.status} → ${next}. Allowed: ${allowed.join(', ') || 'none'}.`,
        ),
        { status: 409 },
      );
    }

    const at = nowIso();
    const timeline: IncidentTimelineEntry[] = [
      ...existing.timeline,
      { at, status: next, by: actor.name, note: note || `Moved to ${titleCase(next)}.` },
    ];

    const patch: Partial<Incident> = { status: next, timeline };
    if (next === 'ACKNOWLEDGED') patch.acknowledgedAt = at;
    if (next === 'RESOLVED') patch.resolvedAt = at;
    if (next === 'CLOSED') patch.closedAt = at;

    const updated = await store.incidents.update(existing._id, patch);
    if (!updated) throw Object.assign(new Error('Incident not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.INCIDENT_UPDATED, updated, SOCKET_ROOMS.INCIDENTS);
    logger.info(`incident ${updated.incidentId} → ${next} by ${actor.name}`);
    return updated;
  }

  async assign(incidentId: string, assignee: string, actor: Actor): Promise<Incident> {
    const store = getStore();
    const existing = await store.incidents.findByIncidentId(incidentId);
    if (!existing) throw Object.assign(new Error('Incident not found'), { status: 404 });

    const at = nowIso();
    const updated = await store.incidents.update(existing._id, {
      assignedTo: assignee,
      timeline: [
        ...existing.timeline,
        { at, status: existing.status, by: actor.name, note: `Assigned to ${assignee}.` },
      ],
    });
    if (!updated) throw Object.assign(new Error('Incident not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.INCIDENT_UPDATED, updated, SOCKET_ROOMS.INCIDENTS);
    return updated;
  }

  async summary(): Promise<{
    total: number;
    open: number;
    acknowledged: number;
    investigating: number;
    resolved: number;
    closed: number;
    critical: number;
    meanTimeToAcknowledgeMinutes: number | null;
    meanTimeToResolveMinutes: number | null;
    byStatus: Record<IncidentStatus, number>;
  }> {
    const rows = await getStore().incidents.list();

    const byStatus: Record<IncidentStatus, number> = {
      OPEN: 0,
      ACKNOWLEDGED: 0,
      INVESTIGATING: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    for (const i of rows) byStatus[i.status] += 1;

    const ackDurations = rows
      .filter((i) => i.acknowledgedAt)
      .map((i) => minutesBetween(i.createdAt, i.acknowledgedAt!));
    const resolveDurations = rows
      .filter((i) => i.resolvedAt)
      .map((i) => minutesBetween(i.createdAt, i.resolvedAt!));

    const mean = (values: number[]): number | null =>
      values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

    return {
      total: rows.length,
      open: byStatus.OPEN,
      acknowledged: byStatus.ACKNOWLEDGED,
      investigating: byStatus.INVESTIGATING,
      resolved: byStatus.RESOLVED,
      closed: byStatus.CLOSED,
      critical: rows.filter((i) => i.severity === 'CRITICAL' && !CLOSED_STATES.includes(i.status))
        .length,
      meanTimeToAcknowledgeMinutes: mean(ackDurations),
      meanTimeToResolveMinutes: mean(resolveDurations),
      byStatus,
    };
  }
}

export const incidentService = new IncidentService();

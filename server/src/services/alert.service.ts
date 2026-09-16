import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import type { Actor, Alert, AlertStatus, AlertType, Severity, Vessel, Zone } from '../types/domain';
import { businessId, nowIso } from '../utils/ids';

export interface CreateAlertInput {
  vessel: Vessel;
  zone?: Zone | null;
  alertType: AlertType;
  severity: Severity;
  latitude: number;
  longitude: number;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AlertQuery {
  status?: AlertStatus | 'ACTIVE';
  severity?: Severity;
  alertType?: AlertType;
  vesselId?: string;
  zoneId?: string;
  search?: string;
  since?: string;
  limit?: number;
}

export class AlertService {
  /** Persists an alert and pushes it to every subscribed dashboard. */
  async create(input: CreateAlertInput): Promise<Alert> {
    const store = getStore();
    const alert: Alert = {
      _id: businessId('alert'),
      alertId: businessId('alert'),
      vesselId: input.vessel.vesselId,
      vesselName: input.vessel.name,
      zoneId: input.zone?.zoneId ?? null,
      zoneName: input.zone?.name ?? null,
      alertType: input.alertType,
      severity: input.severity,
      latitude: input.latitude,
      longitude: input.longitude,
      message: input.message,
      status: 'NEW',
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      incidentId: null,
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const saved = await store.alerts.create(alert);
    emitEvent(SOCKET_EVENTS.ALERT_CREATED, saved, SOCKET_ROOMS.ALERTS);
    logger.info(`alert ${saved.alertId} [${saved.severity}] ${saved.alertType} — ${saved.message}`);
    return saved;
  }

  async list(query: AlertQuery = {}): Promise<Alert[]> {
    const store = getStore();
    let rows = await store.alerts.list();

    if (query.status === 'ACTIVE') rows = rows.filter((a) => a.status !== 'RESOLVED');
    else if (query.status) rows = rows.filter((a) => a.status === query.status);

    if (query.severity) rows = rows.filter((a) => a.severity === query.severity);
    if (query.alertType) rows = rows.filter((a) => a.alertType === query.alertType);
    if (query.vesselId) rows = rows.filter((a) => a.vesselId === query.vesselId);
    if (query.zoneId) rows = rows.filter((a) => a.zoneId === query.zoneId);
    if (query.since) rows = rows.filter((a) => a.createdAt >= query.since!);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.message.toLowerCase().includes(needle) ||
          a.vesselName.toLowerCase().includes(needle) ||
          a.vesselId.toLowerCase().includes(needle) ||
          a.alertId.toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return query.limit ? rows.slice(0, query.limit) : rows;
  }

  async getByAlertId(alertId: string): Promise<Alert | null> {
    return getStore().alerts.findByAlertId(alertId);
  }

  async acknowledge(alertId: string, actor: Actor): Promise<Alert> {
    const store = getStore();
    const existing = await store.alerts.findByAlertId(alertId);
    if (!existing) throw Object.assign(new Error('Alert not found'), { status: 404 });
    if (existing.status !== 'NEW') return existing;

    const updated = await store.alerts.update(existing._id, {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: nowIso(),
      acknowledgedBy: actor.name,
    });
    if (!updated) throw Object.assign(new Error('Alert not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.ALERT_ACKNOWLEDGED, updated, SOCKET_ROOMS.ALERTS);
    logger.info(`alert ${updated.alertId} acknowledged by ${actor.name}`);
    return updated;
  }

  async resolve(alertId: string, actor: Actor): Promise<Alert> {
    const store = getStore();
    const existing = await store.alerts.findByAlertId(alertId);
    if (!existing) throw Object.assign(new Error('Alert not found'), { status: 404 });

    const updated = await store.alerts.update(existing._id, {
      status: 'RESOLVED',
      resolvedAt: nowIso(),
      acknowledgedAt: existing.acknowledgedAt ?? nowIso(),
      acknowledgedBy: existing.acknowledgedBy ?? actor.name,
    });
    if (!updated) throw Object.assign(new Error('Alert not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.ALERT_RESOLVED, updated, SOCKET_ROOMS.ALERTS);
    logger.info(`alert ${updated.alertId} resolved by ${actor.name}`);
    return updated;
  }

  /** Back-links the alert to the incident it spawned (spec §14). */
  async linkIncident(alertId: string, incidentId: string): Promise<Alert | null> {
    const store = getStore();
    const existing = await store.alerts.findByAlertId(alertId);
    if (!existing) return null;
    return store.alerts.update(existing._id, { incidentId });
  }

  async summary(): Promise<{
    total: number;
    active: number;
    new: number;
    acknowledged: number;
    resolved: number;
    bySeverity: Record<Severity, number>;
    byType: Record<string, number>;
    last24h: number;
  }> {
    const rows = await getStore().alerts.list();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as Record<Severity, number>;
    const byType: Record<string, number> = {};
    for (const alert of rows) {
      bySeverity[alert.severity] += 1;
      byType[alert.alertType] = (byType[alert.alertType] ?? 0) + 1;
    }

    return {
      total: rows.length,
      active: rows.filter((a) => a.status !== 'RESOLVED').length,
      new: rows.filter((a) => a.status === 'NEW').length,
      acknowledged: rows.filter((a) => a.status === 'ACKNOWLEDGED').length,
      resolved: rows.filter((a) => a.status === 'RESOLVED').length,
      bySeverity,
      byType,
      last24h: rows.filter((a) => a.createdAt >= dayAgo).length,
    };
  }
}

export const alertService = new AlertService();

import { getStore } from '../repositories';
import type { AlertType, Severity, Vessel } from '../types/domain';
import { round } from '../utils/ids';
import { alertService } from './alert.service';
import { incidentService } from './incident.service';
import { simulationEngine } from './simulation.service';
import { vesselService } from './vessel.service';
import { zoneService } from './zone.service';
import { geofenceEngine } from './geofence.service';

export interface DashboardOverview {
  vessels: Awaited<ReturnType<typeof vesselService.summary>>;
  alerts: Awaited<ReturnType<typeof alertService.summary>>;
  incidents: Awaited<ReturnType<typeof incidentService.summary>>;
  zones: { total: number; enabled: number; disabled: number; critical: number; areaSqKm: number };
  today: { intrusions: number; alerts: number; incidents: number };
  threatLevel: 'LOW' | 'ELEVATED' | 'HIGH' | 'SEVERE';
  generatedAt: string;
}

export interface SeriesPoint {
  bucket: string;
  label: string;
  intrusions: number;
  approaches: number;
  otherAlerts: number;
  incidents: number;
}

export interface AnalyticsSnapshot {
  overview: DashboardOverview;
  hourly: SeriesPoint[];
  daily: SeriesPoint[];
  severityDistribution: Array<{ severity: Severity; count: number }>;
  alertTypeDistribution: Array<{ type: AlertType; count: number }>;
  vesselTypeDistribution: Array<{ type: string; count: number }>;
  authorizationSplit: Array<{ name: string; value: number }>;
  zoneActivity: Awaited<ReturnType<typeof zoneService.activity>>;
  topRiskVessels: Array<Pick<Vessel, 'vesselId' | 'name' | 'vesselType' | 'status' | 'riskScore' | 'authorizationStatus'>>;
  response: {
    meanTimeToAcknowledgeMinutes: number | null;
    meanTimeToResolveMinutes: number | null;
    acknowledgementRate: number;
    resolutionRate: number;
  };
  system: {
    driver: string;
    collections: number;
    documents: number;
    uptimeSeconds: number;
    nodeVersion: string;
    geofencePairs: number;
    simulation: ReturnType<typeof simulationEngine.state>;
    memoryMb: number;
  };
}

const startOfDay = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const threatFrom = (overview: {
  vessels: { intrusion: number; warning: number };
  alerts: { bySeverity: Record<Severity, number>; active: number };
  incidents: { critical: number; open: number };
}): DashboardOverview['threatLevel'] => {
  const score =
    overview.vessels.intrusion * 6 +
    overview.alerts.bySeverity.CRITICAL * 4 +
    overview.alerts.bySeverity.HIGH * 2 +
    overview.incidents.critical * 5 +
    overview.vessels.warning * 0.5;

  if (score >= 30) return 'SEVERE';
  if (score >= 15) return 'HIGH';
  if (score >= 5) return 'ELEVATED';
  return 'LOW';
};

class AnalyticsService {
  async overview(): Promise<DashboardOverview> {
    const [vessels, alerts, incidents, zones, allAlerts, allIncidents] = await Promise.all([
      vesselService.summary(),
      alertService.summary(),
      incidentService.summary(),
      zoneService.list(),
      getStore().alerts.list(),
      getStore().incidents.list(),
    ]);

    const dayStart = startOfDay().toISOString();

    return {
      vessels,
      alerts,
      incidents,
      zones: {
        total: zones.length,
        enabled: zones.filter((z) => z.status === 'ENABLED').length,
        disabled: zones.filter((z) => z.status === 'DISABLED').length,
        critical: zones.filter((z) => z.severity === 'CRITICAL').length,
        areaSqKm: round(
          zones.reduce((sum, z) => sum + z.areaSqKm, 0),
          2,
        ),
      },
      today: {
        intrusions: allAlerts.filter(
          (a) => a.alertType === 'UNAUTHORIZED_ENTRY' && a.createdAt >= dayStart,
        ).length,
        alerts: allAlerts.filter((a) => a.createdAt >= dayStart).length,
        incidents: allIncidents.filter((i) => i.createdAt >= dayStart).length,
      },
      threatLevel: threatFrom({ vessels, alerts, incidents }),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Buckets alerts and incidents over the last `hours` hours. Built by grouping in
   * memory rather than with an aggregation pipeline so the identical code runs on
   * both the MongoDB and the in-memory driver.
   */
  async hourly(hours = 24): Promise<SeriesPoint[]> {
    const [alerts, incidents] = await Promise.all([
      getStore().alerts.list(),
      getStore().incidents.list(),
    ]);

    const buckets: SeriesPoint[] = [];
    const index = new Map<string, SeriesPoint>();
    const now = new Date();

    for (let i = hours - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      const point: SeriesPoint = {
        bucket: key,
        label: `${String(d.getHours()).padStart(2, '0')}:00`,
        intrusions: 0,
        approaches: 0,
        otherAlerts: 0,
        incidents: 0,
      };
      buckets.push(point);
      index.set(key, point);
    }

    const bucketOf = (iso: string): SeriesPoint | undefined => {
      const d = new Date(iso);
      d.setMinutes(0, 0, 0);
      return index.get(d.toISOString());
    };

    for (const alert of alerts) {
      const point = bucketOf(alert.createdAt);
      if (!point) continue;
      if (alert.alertType === 'UNAUTHORIZED_ENTRY') point.intrusions += 1;
      else if (alert.alertType === 'ZONE_APPROACH') point.approaches += 1;
      else point.otherAlerts += 1;
    }
    for (const incident of incidents) {
      const point = bucketOf(incident.createdAt);
      if (point) point.incidents += 1;
    }

    return buckets;
  }

  /** Same shape, but one bucket per day for the last `days` days. */
  async daily(days = 7): Promise<SeriesPoint[]> {
    const [alerts, incidents] = await Promise.all([
      getStore().alerts.list(),
      getStore().incidents.list(),
    ]);

    const buckets: SeriesPoint[] = [];
    const index = new Map<string, SeriesPoint>();
    const now = new Date();

    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now.getTime() - i * 86_400_000);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      const point: SeriesPoint = {
        bucket: key,
        label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        intrusions: 0,
        approaches: 0,
        otherAlerts: 0,
        incidents: 0,
      };
      buckets.push(point);
      index.set(key, point);
    }

    const bucketOf = (iso: string) => index.get(iso.slice(0, 10));

    for (const alert of alerts) {
      const point = bucketOf(alert.createdAt);
      if (!point) continue;
      if (alert.alertType === 'UNAUTHORIZED_ENTRY') point.intrusions += 1;
      else if (alert.alertType === 'ZONE_APPROACH') point.approaches += 1;
      else point.otherAlerts += 1;
    }
    for (const incident of incidents) {
      const point = bucketOf(incident.createdAt);
      if (point) point.incidents += 1;
    }

    return buckets;
  }

  async full(hours = 24, days = 7): Promise<AnalyticsSnapshot> {
    // Incident figures come from `overview` (counts, MTTA/MTTR) and `hourly`
    // (per-bucket volume), so the incident collection is deliberately not
    // scanned here — loading it would be a wasted full read on every call.
    const [overview, hourly, daily, zones, alerts, vessels, storeStats] = await Promise.all([
      this.overview(),
      this.hourly(hours),
      this.daily(days),
      zoneService.activity(),
      getStore().alerts.list(),
      getStore().vessels.list(),
      getStore().stats(),
    ]);

    const severityDistribution: Array<{ severity: Severity; count: number }> = (
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]
    ).map((severity) => ({
      severity,
      count: alerts.filter((a) => a.severity === severity).length,
    }));

    const alertTypeDistribution = (
      [
        'UNAUTHORIZED_ENTRY',
        'ZONE_APPROACH',
        'SUSPICIOUS_MOVEMENT',
        'VESSEL_OFFLINE',
        'SYSTEM_WARNING',
      ] as AlertType[]
    ).map((type) => ({ type, count: alerts.filter((a) => a.alertType === type).length }));

    const vesselTypeDistribution = Object.entries(overview.vessels.byType)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const acknowledged = alerts.filter((a) => a.status !== 'NEW').length;

    return {
      overview,
      hourly,
      daily,
      severityDistribution,
      alertTypeDistribution,
      vesselTypeDistribution,
      authorizationSplit: [
        { name: 'Authorized', value: overview.vessels.authorized },
        { name: 'Unauthorized', value: overview.vessels.unauthorized },
      ],
      zoneActivity: zones,
      topRiskVessels: [...vessels]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 6)
        .map((v) => ({
          vesselId: v.vesselId,
          name: v.name,
          vesselType: v.vesselType,
          status: v.status,
          riskScore: v.riskScore,
          authorizationStatus: v.authorizationStatus,
        })),
      response: {
        meanTimeToAcknowledgeMinutes: overview.incidents.meanTimeToAcknowledgeMinutes,
        meanTimeToResolveMinutes: overview.incidents.meanTimeToResolveMinutes,
        acknowledgementRate: alerts.length ? round((acknowledged / alerts.length) * 100, 1) : 0,
        resolutionRate: alerts.length
          ? round((alerts.filter((a) => a.status === 'RESOLVED').length / alerts.length) * 100, 1)
          : 0,
      },
      system: {
        driver: storeStats.driver,
        collections: storeStats.collections,
        documents: storeStats.documents,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        geofencePairs: geofenceEngine.snapshotSize(),
        simulation: simulationEngine.state(),
        memoryMb: round(process.memoryUsage().heapUsed / 1024 / 1024, 1),
      },
    };
  }

  /** Compact payload pushed to the dashboard on a fixed cadence. */
  async liveStats(): Promise<DashboardOverview> {
    return this.overview();
  }

  /** Per-vessel trip summary used by the vessel detail drawer. */
  async vesselStats(vesselId: string) {
    const [tracks, alerts, incidents] = await Promise.all([
      getStore().tracks.listByVessel(vesselId, 2000),
      getStore().alerts.list(),
      getStore().incidents.list(),
    ]);

    let distanceMeters = 0;
    for (let i = 1; i < tracks.length; i += 1) {
      const { haversineMeters } = await import('../utils/geo');
      distanceMeters += haversineMeters(
        { lat: tracks[i - 1].lat, lng: tracks[i - 1].lng },
        { lat: tracks[i].lat, lng: tracks[i].lng },
      );
    }

    const speeds = tracks.map((t) => t.speed);
    const mine = alerts.filter((a) => a.vesselId === vesselId);

    return {
      vesselId,
      trackPoints: tracks.length,
      distanceKm: round(distanceMeters / 1000, 2),
      maxSpeedKmh: speeds.length ? round(Math.max(...speeds), 1) : 0,
      averageSpeedKmh: speeds.length
        ? round(speeds.reduce((a, b) => a + b, 0) / speeds.length, 1)
        : 0,
      alertCount: mine.length,
      intrusionCount: mine.filter((a) => a.alertType === 'UNAUTHORIZED_ENTRY').length,
      incidentCount: incidents.filter((i) => i.vesselId === vesselId).length,
    };
  }
}

export const analyticsService = new AnalyticsService();

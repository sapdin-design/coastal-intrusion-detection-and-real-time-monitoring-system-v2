import { DEFAULT_ZONE_APPROACH_BUFFER_M, SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import type {
  Actor,
  LatLng,
  Severity,
  Zone,
  ZoneStatus,
  ZoneType,
} from '../types/domain';
import { businessId, nowIso, round } from '../utils/ids';
import { polygonAreaSqMeters, polygonCentroid, toPolygonGeometry } from '../utils/geo';
import { geofenceEngine } from './geofence.service';

export interface ZoneQuery {
  status?: ZoneStatus;
  zoneType?: ZoneType;
  severity?: Severity;
  search?: string;
}

export interface CreateZoneInput {
  name: string;
  description?: string;
  zoneType: ZoneType;
  coordinates: LatLng[];
  severity: Severity;
  status?: ZoneStatus;
  approachBufferMeters?: number;
}

export type UpdateZoneInput = Partial<CreateZoneInput>;

export interface ZoneWithStats extends Zone {
  areaSqKm: number;
  centroid: LatLng;
  /** Filled by the service layer for the dashboard's zone-activity table. */
  alertCount?: number;
  intrusionCount?: number;
  vesselCount?: number;
}

const assertPolygon = (coordinates: LatLng[]): void => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw Object.assign(new Error('A zone polygon requires at least 3 vertices'), { status: 422 });
  }
  for (const vertex of coordinates) {
    if (
      typeof vertex?.lat !== 'number' ||
      typeof vertex?.lng !== 'number' ||
      vertex.lat < -90 ||
      vertex.lat > 90 ||
      vertex.lng < -180 ||
      vertex.lng > 180
    ) {
      throw Object.assign(new Error('Every polygon vertex must be a valid {lat, lng} pair'), {
        status: 422,
      });
    }
  }
};

export class ZoneService {
  async list(query: ZoneQuery = {}): Promise<ZoneWithStats[]> {
    let rows = await getStore().zones.list();

    if (query.status) rows = rows.filter((z) => z.status === query.status);
    if (query.zoneType) rows = rows.filter((z) => z.zoneType === query.zoneType);
    if (query.severity) rows = rows.filter((z) => z.severity === query.severity);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (z) =>
          z.name.toLowerCase().includes(needle) ||
          z.description.toLowerCase().includes(needle) ||
          z.zoneId.toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows.map((zone) => this.decorate(zone));
  }

  /** Zones enriched with derived geometry metrics used by the zone table. */
  private decorate(zone: Zone): ZoneWithStats {
    return {
      ...zone,
      areaSqKm: round(polygonAreaSqMeters(zone.coordinates) / 1_000_000, 3),
      centroid: polygonCentroid(zone.coordinates),
    };
  }

  async getByZoneId(zoneId: string): Promise<Zone | null> {
    return getStore().zones.findByZoneId(zoneId);
  }

  async require(zoneId: string): Promise<Zone> {
    const zone = await this.getByZoneId(zoneId);
    if (!zone) throw Object.assign(new Error(`Zone ${zoneId} not found`), { status: 404 });
    return zone;
  }

  async create(input: CreateZoneInput, actor: Actor | null): Promise<Zone> {
    assertPolygon(input.coordinates);
    const store = getStore();
    const at = nowIso();

    const zone: Zone = {
      _id: businessId('zone'),
      zoneId: businessId('zone'),
      name: input.name,
      description: input.description ?? '',
      zoneType: input.zoneType,
      coordinates: input.coordinates,
      geometry: toPolygonGeometry(input.coordinates),
      approachBufferMeters: input.approachBufferMeters ?? DEFAULT_ZONE_APPROACH_BUFFER_M,
      severity: input.severity,
      status: input.status ?? 'ENABLED',
      createdBy: actor?.name ?? 'system',
      createdAt: at,
      updatedAt: at,
    };

    const saved = await store.zones.create(zone);
    emitEvent(SOCKET_EVENTS.ZONE_CREATED, saved, SOCKET_ROOMS.MONITORING);
    logger.info(`zone ${saved.zoneId} (${saved.name}) created by ${actor?.name ?? 'system'}`);
    return saved;
  }

  async update(zoneId: string, patch: UpdateZoneInput): Promise<Zone> {
    const store = getStore();
    const existing = await this.require(zoneId);

    const next: Partial<Zone> = {};
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.description !== undefined) next.description = patch.description;
    if (patch.zoneType !== undefined) next.zoneType = patch.zoneType;
    if (patch.severity !== undefined) next.severity = patch.severity;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.approachBufferMeters !== undefined) {
      next.approachBufferMeters = patch.approachBufferMeters;
    }
    if (patch.coordinates !== undefined) {
      assertPolygon(patch.coordinates);
      next.coordinates = patch.coordinates;
      next.geometry = toPolygonGeometry(patch.coordinates);
    }

    // Any geometric or enable/disable change invalidates cached episodes, so the
    // engine re-evaluates from a clean slate instead of comparing against
    // positions that belonged to the old polygon.
    geofenceEngine.forgetZone(existing.zoneId);

    const updated = await store.zones.update(existing._id, next);
    if (!updated) throw Object.assign(new Error('Zone not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.ZONE_UPDATED, updated, SOCKET_ROOMS.MONITORING);
    logger.info(`zone ${updated.zoneId} updated`);
    return updated;
  }

  async toggleStatus(zoneId: string): Promise<Zone> {
    const existing = await this.require(zoneId);
    return this.update(zoneId, { status: existing.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' });
  }

  async remove(zoneId: string): Promise<void> {
    const store = getStore();
    const existing = await this.require(zoneId);
    await store.zones.remove(existing._id);
    geofenceEngine.forgetZone(existing.zoneId);
    emitEvent(SOCKET_EVENTS.ZONE_DELETED, { zoneId }, SOCKET_ROOMS.MONITORING);
    logger.info(`zone ${zoneId} deleted`);
  }

  /** Zone-activity table for the dashboard: alerts, intrusions and vessels per zone. */
  async activity(): Promise<ZoneWithStats[]> {
    const [zones, alerts, vessels] = await Promise.all([
      this.list(),
      getStore().alerts.list(),
      getStore().vessels.list(),
    ]);

    return zones
      .map((zone) => {
        const zoneAlerts = alerts.filter((a) => a.zoneId === zone.zoneId);
        return {
          ...zone,
          alertCount: zoneAlerts.length,
          intrusionCount: zoneAlerts.filter((a) => a.alertType === 'UNAUTHORIZED_ENTRY').length,
          vesselCount: vessels.filter((v) => v.status !== 'OFFLINE').filter((v) => {
            const { state } = geofenceEngine.evaluatePoint(
              { lat: v.currentLatitude, lng: v.currentLongitude },
              zone,
            );
            return state !== 'OUTSIDE';
          }).length,
        };
      })
      .sort((a, b) => (b.intrusionCount ?? 0) - (a.intrusionCount ?? 0));
  }
}

export const zoneService = new ZoneService();

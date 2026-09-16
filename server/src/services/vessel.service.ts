import { SOCKET_EVENTS, SOCKET_ROOMS, THEATRE } from '../config/constants';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { emitEvent } from '../realtime/bus';
import { getStore } from '../repositories';
import type {
  Actor,
  AuthorizationStatus,
  Vessel,
  VesselStatus,
  VesselType,
} from '../types/domain';
import { businessId, clamp, nowIso, randRange, round } from '../utils/ids';
import { randomPointInBounds } from '../utils/geo';
import { geofenceEngine } from './geofence.service';

export interface VesselQuery {
  status?: VesselStatus;
  authorizationStatus?: AuthorizationStatus;
  vesselType?: VesselType;
  zoneId?: string;
  search?: string;
}

export interface CreateVesselInput {
  name: string;
  registrationNumber?: string;
  vesselType: VesselType;
  owner?: string;
  authorizationStatus: AuthorizationStatus;
  homePort?: string;
  simulated?: boolean;
  latitude?: number;
  longitude?: number;
  speed?: number;
  direction?: number;
  notes?: string;
}

export type UpdateVesselInput = Partial<CreateVesselInput>;

export class VesselService {
  async list(query: VesselQuery = {}): Promise<Vessel[]> {
    let rows = await getStore().vessels.list();

    if (query.status) rows = rows.filter((v) => v.status === query.status);
    if (query.authorizationStatus) {
      rows = rows.filter((v) => v.authorizationStatus === query.authorizationStatus);
    }
    if (query.vesselType) rows = rows.filter((v) => v.vesselType === query.vesselType);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (v) =>
          v.name.toLowerCase().includes(needle) ||
          v.vesselId.toLowerCase().includes(needle) ||
          v.registrationNumber.toLowerCase().includes(needle) ||
          v.owner.toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => a.vesselId.localeCompare(b.vesselId));
    return rows;
  }

  async getByVesselId(vesselId: string): Promise<Vessel | null> {
    return getStore().vessels.findByVesselId(vesselId);
  }

  async require(vesselId: string): Promise<Vessel> {
    const vessel = await this.getByVesselId(vesselId);
    if (!vessel) throw Object.assign(new Error(`Vessel ${vesselId} not found`), { status: 404 });
    return vessel;
  }

  async create(input: CreateVesselInput, actor: Actor | null): Promise<Vessel> {
    const store = getStore();
    const at = nowIso();
    const start = randomPointInBounds(THEATRE.bounds);

    const vessel: Vessel = {
      _id: businessId('vessel'),
      vesselId: businessId('vessel'),
      name: input.name,
      registrationNumber: input.registrationNumber ?? `REG-${Date.now().toString().slice(-6)}`,
      vesselType: input.vesselType,
      owner: input.owner ?? 'Unknown',
      authorizationStatus: input.authorizationStatus,
      currentLatitude: input.latitude ?? round(start.lat, 5),
      currentLongitude: input.longitude ?? round(start.lng, 5),
      speed: input.speed ?? round(randRange(4, 18), 1),
      direction: input.direction ?? round(randRange(0, 360), 0),
      status: 'ACTIVE',
      lastSeen: at,
      homePort: input.homePort ?? 'Colachel',
      simulated: input.simulated ?? true,
      riskScore: input.authorizationStatus === 'UNAUTHORIZED' ? 45 : 10,
      notes: input.notes ?? '',
      createdAt: at,
      updatedAt: at,
    };

    const saved = await store.vessels.create(vessel);
    emitEvent(SOCKET_EVENTS.VESSEL_CREATED, saved, SOCKET_ROOMS.MONITORING);
    logger.info(`vessel ${saved.vesselId} (${saved.name}) created by ${actor?.name ?? 'system'}`);
    return saved;
  }

  async update(vesselId: string, patch: UpdateVesselInput): Promise<Vessel> {
    const store = getStore();
    const existing = await this.require(vesselId);

    const next: Partial<Vessel> = {};
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.registrationNumber !== undefined) next.registrationNumber = patch.registrationNumber;
    if (patch.vesselType !== undefined) next.vesselType = patch.vesselType;
    if (patch.owner !== undefined) next.owner = patch.owner;
    if (patch.authorizationStatus !== undefined) {
      next.authorizationStatus = patch.authorizationStatus;
      next.riskScore = patch.authorizationStatus === 'UNAUTHORIZED' ? 45 : 10;
    }
    if (patch.homePort !== undefined) next.homePort = patch.homePort;
    if (patch.simulated !== undefined) next.simulated = patch.simulated;
    if (patch.latitude !== undefined) next.currentLatitude = patch.latitude;
    if (patch.longitude !== undefined) next.currentLongitude = patch.longitude;
    if (patch.speed !== undefined) next.speed = patch.speed;
    if (patch.direction !== undefined) next.direction = patch.direction;
    if (patch.notes !== undefined) next.notes = patch.notes;

    // Changing the authorization flag invalidates any cached geofence episode:
    // an unauthorized vessel that becomes authorized must not keep a stale
    // INTRUSION verdict until it physically leaves the polygon.
    if (patch.authorizationStatus !== undefined && patch.authorizationStatus !== existing.authorizationStatus) {
      geofenceEngine.forgetVessel(existing.vesselId);
    }

    const updated = await store.vessels.update(existing._id, next);
    if (!updated) throw Object.assign(new Error('Vessel not found'), { status: 404 });

    emitEvent(SOCKET_EVENTS.VESSEL_UPDATED, updated, SOCKET_ROOMS.MONITORING);
    return updated;
  }

  async remove(vesselId: string): Promise<void> {
    const store = getStore();
    const existing = await this.require(vesselId);
    await store.vessels.remove(existing._id);
    geofenceEngine.forgetVessel(existing.vesselId);
    emitEvent(SOCKET_EVENTS.VESSEL_DELETED, { vesselId }, SOCKET_ROOMS.MONITORING);
    logger.info(`vessel ${vesselId} deleted`);
  }

  /** Applies a status change only when it actually differs — keeps the bus quiet. */
  async setStatus(vessel: Vessel, status: VesselStatus): Promise<Vessel> {
    if (vessel.status === status) return vessel;
    const store = getStore();
    const updated = await store.vessels.update(vessel._id, { status });
    if (!updated) return vessel;
    emitEvent(SOCKET_EVENTS.VESSEL_STATUS_CHANGED, updated, SOCKET_ROOMS.MONITORING);
    return updated;
  }

  async setRiskScore(vessel: Vessel, delta: number): Promise<Vessel> {
    const store = getStore();
    const riskScore = clamp(vessel.riskScore + delta, 0, 100);
    if (riskScore === vessel.riskScore) return vessel;
    const updated = await store.vessels.update(vessel._id, { riskScore });
    return updated ?? vessel;
  }

  /**
   * Health sweep: anything that has not reported within `VESSEL_OFFLINE_AFTER_MS`
   * is flagged OFFLINE and raises a VESSEL_OFFLINE alert exactly once per episode.
   */
  async sweepOffline(): Promise<Vessel[]> {
    const store = getStore();
    const rows = await store.vessels.list();
    const cutoff = Date.now() - env.vessel.offlineAfterMs;
    const flipped: Vessel[] = [];

    for (const vessel of rows) {
      if (!vessel.lastSeen) continue;
      const stale = new Date(vessel.lastSeen).getTime() < cutoff;
      if (stale && vessel.status !== 'OFFLINE') {
        const updated = await store.vessels.update(vessel._id, { status: 'OFFLINE', speed: 0 });
        if (updated) {
          flipped.push(updated);
          emitEvent(SOCKET_EVENTS.VESSEL_STATUS_CHANGED, updated, SOCKET_ROOMS.MONITORING);
        }
      }
    }
    return flipped;
  }

  async summary(): Promise<{
    total: number;
    active: number;
    warning: number;
    intrusion: number;
    offline: number;
    authorized: number;
    unauthorized: number;
    byType: Record<string, number>;
    averageSpeed: number;
  }> {
    const rows = await getStore().vessels.list();
    const byType: Record<string, number> = {};
    for (const v of rows) byType[v.vesselType] = (byType[v.vesselType] ?? 0) + 1;

    const moving = rows.filter((v) => v.status !== 'OFFLINE');

    return {
      total: rows.length,
      active: rows.filter((v) => v.status === 'ACTIVE').length,
      warning: rows.filter((v) => v.status === 'WARNING').length,
      intrusion: rows.filter((v) => v.status === 'INTRUSION').length,
      offline: rows.filter((v) => v.status === 'OFFLINE').length,
      authorized: rows.filter((v) => v.authorizationStatus === 'AUTHORIZED').length,
      unauthorized: rows.filter((v) => v.authorizationStatus === 'UNAUTHORIZED').length,
      byType,
      averageSpeed: moving.length
        ? round(moving.reduce((s, v) => s + v.speed, 0) / moving.length, 1)
        : 0,
    };
  }
}

export const vesselService = new VesselService();

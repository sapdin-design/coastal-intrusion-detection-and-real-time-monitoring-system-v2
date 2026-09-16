import type {
  Alert,
  AuditEntry,
  Incident,
  TrackPoint,
  User,
  Vessel,
  Zone,
} from '../types/domain';

/**
 * Persistence contract for CIDRTM.
 *
 * The whole application talks to this interface only — never to Mongoose or to a
 * Map directly. That is what makes the mini project portable: the same services,
 * routes and realtime bus run on the zero-install in-memory store *or* on MongoDB
 * by flipping `MONGODB_URI`. It is also the seam where a future final-year build
 * would attach a time-series store for raw GNSS frames.
 */

export interface UserRepo {
  create(doc: User): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<User[]>;
  update(id: string, patch: Partial<User>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export interface VesselRepo {
  create(doc: Vessel): Promise<Vessel>;
  createMany(docs: Vessel[]): Promise<Vessel[]>;
  findById(id: string): Promise<Vessel | null>;
  findByVesselId(vesselId: string): Promise<Vessel | null>;
  list(): Promise<Vessel[]>;
  update(id: string, patch: Partial<Vessel>): Promise<Vessel | null>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface ZoneRepo {
  create(doc: Zone): Promise<Zone>;
  createMany(docs: Zone[]): Promise<Zone[]>;
  findById(id: string): Promise<Zone | null>;
  findByZoneId(zoneId: string): Promise<Zone | null>;
  list(): Promise<Zone[]>;
  update(id: string, patch: Partial<Zone>): Promise<Zone | null>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface AlertRepo {
  create(doc: Alert): Promise<Alert>;
  createMany(docs: Alert[]): Promise<Alert[]>;
  findById(id: string): Promise<Alert | null>;
  findByAlertId(alertId: string): Promise<Alert | null>;
  list(): Promise<Alert[]>;
  update(id: string, patch: Partial<Alert>): Promise<Alert | null>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface IncidentRepo {
  create(doc: Incident): Promise<Incident>;
  findById(id: string): Promise<Incident | null>;
  findByIncidentId(incidentId: string): Promise<Incident | null>;
  list(): Promise<Incident[]>;
  update(id: string, patch: Partial<Incident>): Promise<Incident | null>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface TrackRepo {
  append(point: TrackPoint): Promise<void>;
  /** Oldest → newest, so Leaflet can draw a polyline directly. */
  listByVessel(vesselId: string, limit?: number): Promise<TrackPoint[]>;
  prune(vesselId: string, keep: number): Promise<void>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface AuditRepo {
  append(entry: AuditEntry): Promise<void>;
  list(limit?: number): Promise<AuditEntry[]>;
  removeAll(): Promise<void>;
  count(): Promise<number>;
}

export interface IDataStore {
  readonly driver: 'memory' | 'mongodb';
  users: UserRepo;
  vessels: VesselRepo;
  zones: ZoneRepo;
  alerts: AlertRepo;
  incidents: IncidentRepo;
  tracks: TrackRepo;
  audit: AuditRepo;
  /** Opens the connection / loads the snapshot. Must be called before serving. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Wipes operational data (keeps users unless `includeUsers`). */
  reset(includeUsers?: boolean): Promise<void>;
  stats(): Promise<{ collections: number; documents: number; driver: string }>;
}

import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../config/logger';
import type {
  Alert,
  AuditEntry,
  BaseDoc,
  Incident,
  TrackPoint,
  User,
  Vessel,
  Zone,
} from '../types/domain';
import type {
  AlertRepo,
  AuditRepo,
  IDataStore,
  IncidentRepo,
  TrackRepo,
  UserRepo,
  VesselRepo,
  ZoneRepo,
} from './types';

const DATA_DIR = path.resolve(__dirname, '../../data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'store.json');

/* ───────────────────────────── Generic table ───────────────────────────── */

/**
 * A Map-backed collection with an identical surface to the Mongoose-backed
 * repository: create / read / update / delete plus a stable insertion order.
 * Documents are stored by reference and cloned on read so callers can never
 * mutate the store by accident.
 */
class Table<T extends BaseDoc> {
  private readonly rows = new Map<string, T>();

  constructor(private readonly onWrite: () => void) {}

  all(): T[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  insert(doc: T): T {
    this.rows.set(doc._id, doc);
    this.onWrite();
    return { ...doc };
  }

  insertMany(docs: T[]): T[] {
    for (const doc of docs) this.rows.set(doc._id, doc);
    this.onWrite();
    return docs.map((d) => ({ ...d }));
  }

  get(id: string): T | null {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  find(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  findOne(predicate: (row: T) => boolean): T | null {
    for (const row of this.rows.values()) if (predicate(row)) return { ...row };
    return null;
  }

  patch(id: string, patch: Partial<T>): T | null {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, ...patch, _id: row._id, updatedAt: new Date().toISOString() } as T;
    this.rows.set(id, next);
    this.onWrite();
    return { ...next };
  }

  delete(id: string): boolean {
    const existed = this.rows.delete(id);
    if (existed) this.onWrite();
    return existed;
  }

  clear(): void {
    this.rows.clear();
    this.onWrite();
  }

  get size(): number {
    return this.rows.size;
  }

  hydrate(rows: T[]): void {
    this.rows.clear();
    for (const row of rows) this.rows.set(row._id, row);
  }
}

/* ─────────────────────────── Repository adapters ────────────────────────── */

class MemoryUserRepo implements UserRepo {
  constructor(private readonly t: Table<User>) {}
  create = async (doc: User) => this.t.insert(doc);
  findById = async (id: string) => this.t.get(id);
  findByEmail = async (email: string) =>
    this.t.findOne((u) => u.email.toLowerCase() === email.toLowerCase());
  list = async () => this.t.all();
  update = async (id: string, patch: Partial<User>) => this.t.patch(id, patch);
  remove = async (id: string) => this.t.delete(id);
  count = async () => this.t.size;
}

class MemoryVesselRepo implements VesselRepo {
  constructor(private readonly t: Table<Vessel>) {}
  create = async (doc: Vessel) => this.t.insert(doc);
  createMany = async (docs: Vessel[]) => this.t.insertMany(docs);
  findById = async (id: string) => this.t.get(id);
  findByVesselId = async (vesselId: string) =>
    this.t.findOne((v) => v.vesselId === vesselId);
  list = async () => this.t.all();
  update = async (id: string, patch: Partial<Vessel>) => this.t.patch(id, patch);
  remove = async (id: string) => this.t.delete(id);
  removeAll = async () => void this.t.clear();
  count = async () => this.t.size;
}

class MemoryZoneRepo implements ZoneRepo {
  constructor(private readonly t: Table<Zone>) {}
  create = async (doc: Zone) => this.t.insert(doc);
  createMany = async (docs: Zone[]) => this.t.insertMany(docs);
  findById = async (id: string) => this.t.get(id);
  findByZoneId = async (zoneId: string) => this.t.findOne((z) => z.zoneId === zoneId);
  list = async () => this.t.all();
  update = async (id: string, patch: Partial<Zone>) => this.t.patch(id, patch);
  remove = async (id: string) => this.t.delete(id);
  removeAll = async () => void this.t.clear();
  count = async () => this.t.size;
}

class MemoryAlertRepo implements AlertRepo {
  constructor(private readonly t: Table<Alert>) {}
  create = async (doc: Alert) => this.t.insert(doc);
  createMany = async (docs: Alert[]) => this.t.insertMany(docs);
  findById = async (id: string) => this.t.get(id);
  findByAlertId = async (alertId: string) => this.t.findOne((a) => a.alertId === alertId);
  list = async () => this.t.all();
  update = async (id: string, patch: Partial<Alert>) => this.t.patch(id, patch);
  remove = async (id: string) => this.t.delete(id);
  removeAll = async () => void this.t.clear();
  count = async () => this.t.size;
}

class MemoryIncidentRepo implements IncidentRepo {
  constructor(private readonly t: Table<Incident>) {}
  create = async (doc: Incident) => this.t.insert(doc);
  findById = async (id: string) => this.t.get(id);
  findByIncidentId = async (incidentId: string) =>
    this.t.findOne((i) => i.incidentId === incidentId);
  list = async () => this.t.all();
  update = async (id: string, patch: Partial<Incident>) => this.t.patch(id, patch);
  remove = async (id: string) => this.t.delete(id);
  removeAll = async () => void this.t.clear();
  count = async () => this.t.size;
}

class MemoryTrackRepo implements TrackRepo {
  /** vesselId → chronological track. Capped by `env.vessel.trackPointsPerVessel`. */
  private readonly byVessel = new Map<string, TrackPoint[]>();

  constructor(private readonly onWrite: () => void) {}

  async append(point: TrackPoint): Promise<void> {
    const list = this.byVessel.get(point.vesselId) ?? [];
    list.push(point);
    if (list.length > env.vessel.trackPointsPerVessel) {
      list.splice(0, list.length - env.vessel.trackPointsPerVessel);
    }
    this.byVessel.set(point.vesselId, list);
    this.onWrite();
  }

  async listByVessel(vesselId: string, limit?: number): Promise<TrackPoint[]> {
    const list = this.byVessel.get(vesselId) ?? [];
    const sliced = limit ? list.slice(-limit) : list;
    return sliced.map((p) => ({ ...p }));
  }

  async prune(vesselId: string, keep: number): Promise<void> {
    const list = this.byVessel.get(vesselId);
    if (list && list.length > keep) this.byVessel.set(vesselId, list.slice(-keep));
    this.onWrite();
  }

  async removeAll(): Promise<void> {
    this.byVessel.clear();
    this.onWrite();
  }

  async count(): Promise<number> {
    let total = 0;
    for (const list of this.byVessel.values()) total += list.length;
    return total;
  }

  dump(): Record<string, TrackPoint[]> {
    return Object.fromEntries([...this.byVessel.entries()].map(([k, v]) => [k, v]));
  }

  hydrate(data: Record<string, TrackPoint[]>): void {
    this.byVessel.clear();
    for (const [k, v] of Object.entries(data ?? {})) this.byVessel.set(k, v ?? []);
  }
}

class MemoryAuditRepo implements AuditRepo {
  constructor(private readonly t: Table<AuditEntry>) {}
  append = async (entry: AuditEntry) => void this.t.insert(entry);
  list = async (limit = 200) => this.t.all().slice(-limit).reverse();
  removeAll = async () => void this.t.clear();
  count = async () => this.t.size;
}

/* ────────────────────────────── The store ──────────────────────────────── */

export class MemoryStore implements IDataStore {
  readonly driver = 'memory' as const;

  private readonly usersTable = new Table<User>(() => this.schedulePersist());
  private readonly vesselsTable = new Table<Vessel>(() => this.schedulePersist());
  private readonly zonesTable = new Table<Zone>(() => this.schedulePersist());
  private readonly alertsTable = new Table<Alert>(() => this.schedulePersist());
  private readonly incidentsTable = new Table<Incident>(() => this.schedulePersist());
  private readonly auditTable = new Table<AuditEntry>(() => this.schedulePersist());
  private readonly tracksRepo = new MemoryTrackRepo(() => this.schedulePersist());

  readonly users: UserRepo = new MemoryUserRepo(this.usersTable);
  readonly vessels: VesselRepo = new MemoryVesselRepo(this.vesselsTable);
  readonly zones: ZoneRepo = new MemoryZoneRepo(this.zonesTable);
  readonly alerts: AlertRepo = new MemoryAlertRepo(this.alertsTable);
  readonly incidents: IncidentRepo = new MemoryIncidentRepo(this.incidentsTable);
  readonly tracks: TrackRepo = this.tracksRepo;
  readonly audit: AuditRepo = new MemoryAuditRepo(this.auditTable);

  private persistTimer: NodeJS.Timeout | null = null;

  async connect(): Promise<void> {
    if (!env.memoryPersist) {
      logger.info('in-memory repository ready (persistence disabled)');
      return;
    }
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) as Record<string, unknown>;
        this.usersTable.hydrate((raw.users as User[]) ?? []);
        this.vesselsTable.hydrate((raw.vessels as Vessel[]) ?? []);
        this.zonesTable.hydrate((raw.zones as Zone[]) ?? []);
        this.alertsTable.hydrate((raw.alerts as Alert[]) ?? []);
        this.incidentsTable.hydrate((raw.incidents as Incident[]) ?? []);
        this.auditTable.hydrate((raw.audit as AuditEntry[]) ?? []);
        this.tracksRepo.hydrate((raw.tracks as Record<string, TrackPoint[]>) ?? {});
        logger.info(
          `in-memory repository restored from snapshot (${this.vesselsTable.size} vessels, ` +
            `${this.zonesTable.size} zones, ${this.alertsTable.size} alerts)`,
        );
      } else {
        logger.info('in-memory repository ready (no snapshot yet)');
      }
    } catch (error) {
      logger.warn(`could not read store snapshot, starting empty: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    await this.flush();
  }

  async reset(includeUsers = false): Promise<void> {
    this.vesselsTable.clear();
    this.zonesTable.clear();
    this.alertsTable.clear();
    this.incidentsTable.clear();
    this.auditTable.clear();
    await this.tracksRepo.removeAll();
    if (includeUsers) this.usersTable.clear();
    await this.flush();
  }

  async stats(): Promise<{ collections: number; documents: number; driver: string }> {
    const documents =
      this.usersTable.size +
      this.vesselsTable.size +
      this.zonesTable.size +
      this.alertsTable.size +
      this.incidentsTable.size +
      this.auditTable.size +
      (await this.tracksRepo.count());
    return { collections: 7, documents, driver: this.driver };
  }

  /* ── snapshot persistence (debounced so a 10x tick loop never thrashes disk) ── */

  private schedulePersist(): void {
    if (!env.memoryPersist) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, 2500);
  }

  async flush(): Promise<void> {
    if (!env.memoryPersist) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload = {
        savedAt: new Date().toISOString(),
        users: this.usersTable.all(),
        vessels: this.vesselsTable.all(),
        zones: this.zonesTable.all(),
        alerts: this.alertsTable.all(),
        incidents: this.incidentsTable.all(),
        audit: this.auditTable.all(),
        tracks: this.tracksRepo.dump(),
      };
      await fs.promises.writeFile(SNAPSHOT_FILE, JSON.stringify(payload), 'utf8');
    } catch (error) {
      logger.warn(`store snapshot failed: ${(error as Error).message}`);
    }
  }
}

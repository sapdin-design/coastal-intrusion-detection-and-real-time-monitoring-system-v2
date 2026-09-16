import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  AlertModel,
  AuditModel,
  IncidentModel,
  MODEL_REGISTRY,
  TrackModel,
  UserModel,
  VesselModel,
  ZoneModel,
} from '../models';
import type {
  Alert,
  AuditEntry,
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

/**
 * MongoDB-backed repository. Selected automatically when `MONGODB_URI` is set —
 * no other file in the project needs to change. Documents are converted with
 * `.lean()` + a plain-object cast so the returned shape matches the in-memory
 * driver exactly.
 */
class MongoUserRepo implements UserRepo {
  async create(doc: User): Promise<User> {
    const created = await UserModel.create(doc);
    return created.toObject() as unknown as User;
  }
  async findById(id: string) {
    return (await UserModel.findById(id).lean().exec()) as unknown as User | null;
  }
  async findByEmail(email: string) {
    return (await UserModel.findOne({ email: email.toLowerCase() }).lean().exec()) as unknown as
      | User
      | null;
  }
  async list() {
    return (await UserModel.find().sort({ createdAt: 1 }).lean().exec()) as unknown as User[];
  }
  async update(id: string, patch: Partial<User>) {
    return (await UserModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec()) as unknown as User | null;
  }
  async remove(id: string) {
    const res = await UserModel.deleteOne({ _id: id }).exec();
    return res.deletedCount === 1;
  }
  async count() {
    return UserModel.countDocuments().exec();
  }
}

class MongoVesselRepo implements VesselRepo {
  async create(doc: Vessel) {
    const created = await VesselModel.create(doc);
    return created.toObject() as unknown as Vessel;
  }
  async createMany(docs: Vessel[]) {
    if (!docs.length) return [];
    await VesselModel.insertMany(docs, { ordered: false });
    return docs;
  }
  async findById(id: string) {
    return (await VesselModel.findById(id).lean().exec()) as unknown as Vessel | null;
  }
  async findByVesselId(vesselId: string) {
    return (await VesselModel.findOne({ vesselId }).lean().exec()) as unknown as Vessel | null;
  }
  async list() {
    return (await VesselModel.find().sort({ vesselId: 1 }).lean().exec()) as unknown as Vessel[];
  }
  async update(id: string, patch: Partial<Vessel>) {
    return (await VesselModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec()) as unknown as Vessel | null;
  }
  async remove(id: string) {
    const res = await VesselModel.deleteOne({ _id: id }).exec();
    return res.deletedCount === 1;
  }
  async removeAll() {
    await VesselModel.deleteMany({}).exec();
  }
  async count() {
    return VesselModel.countDocuments().exec();
  }
}

class MongoZoneRepo implements ZoneRepo {
  async create(doc: Zone) {
    const created = await ZoneModel.create(doc);
    return created.toObject() as unknown as Zone;
  }
  async createMany(docs: Zone[]) {
    if (!docs.length) return [];
    await ZoneModel.insertMany(docs, { ordered: false });
    return docs;
  }
  async findById(id: string) {
    return (await ZoneModel.findById(id).lean().exec()) as unknown as Zone | null;
  }
  async findByZoneId(zoneId: string) {
    return (await ZoneModel.findOne({ zoneId }).lean().exec()) as unknown as Zone | null;
  }
  async list() {
    return (await ZoneModel.find().sort({ createdAt: 1 }).lean().exec()) as unknown as Zone[];
  }
  async update(id: string, patch: Partial<Zone>) {
    return (await ZoneModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec()) as unknown as Zone | null;
  }
  async remove(id: string) {
    const res = await ZoneModel.deleteOne({ _id: id }).exec();
    return res.deletedCount === 1;
  }
  async removeAll() {
    await ZoneModel.deleteMany({}).exec();
  }
  async count() {
    return ZoneModel.countDocuments().exec();
  }
}

class MongoAlertRepo implements AlertRepo {
  async create(doc: Alert) {
    const created = await AlertModel.create(doc);
    return created.toObject() as unknown as Alert;
  }
  async createMany(docs: Alert[]) {
    if (!docs.length) return [];
    await AlertModel.insertMany(docs, { ordered: false });
    return docs;
  }
  async findById(id: string) {
    return (await AlertModel.findById(id).lean().exec()) as unknown as Alert | null;
  }
  async findByAlertId(alertId: string) {
    return (await AlertModel.findOne({ alertId }).lean().exec()) as unknown as Alert | null;
  }
  async list() {
    return (await AlertModel.find()
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean()
      .exec()) as unknown as Alert[];
  }
  async update(id: string, patch: Partial<Alert>) {
    return (await AlertModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec()) as unknown as Alert | null;
  }
  async remove(id: string) {
    const res = await AlertModel.deleteOne({ _id: id }).exec();
    return res.deletedCount === 1;
  }
  async removeAll() {
    await AlertModel.deleteMany({}).exec();
  }
  async count() {
    return AlertModel.countDocuments().exec();
  }
}

class MongoIncidentRepo implements IncidentRepo {
  async create(doc: Incident) {
    const created = await IncidentModel.create(doc);
    return created.toObject() as unknown as Incident;
  }
  async findById(id: string) {
    return (await IncidentModel.findById(id).lean().exec()) as unknown as Incident | null;
  }
  async findByIncidentId(incidentId: string) {
    return (await IncidentModel.findOne({ incidentId }).lean().exec()) as unknown as
      | Incident
      | null;
  }
  async list() {
    return (await IncidentModel.find()
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean()
      .exec()) as unknown as Incident[];
  }
  async update(id: string, patch: Partial<Incident>) {
    return (await IncidentModel.findByIdAndUpdate(
      id,
      { $set: { ...patch, updatedAt: new Date().toISOString() } },
      { new: true },
    )
      .lean()
      .exec()) as unknown as Incident | null;
  }
  async remove(id: string) {
    const res = await IncidentModel.deleteOne({ _id: id }).exec();
    return res.deletedCount === 1;
  }
  async removeAll() {
    await IncidentModel.deleteMany({}).exec();
  }
  async count() {
    return IncidentModel.countDocuments().exec();
  }
}

class MongoTrackRepo implements TrackRepo {
  async append(point: TrackPoint) {
    await TrackModel.create(point);
  }
  async listByVessel(vesselId: string, limit = 600) {
    const rows = (await TrackModel.find({ vesselId })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean()
      .exec()) as unknown as TrackPoint[];
    return rows.reverse();
  }
  async prune(vesselId: string, keep: number) {
    const stale = await TrackModel.find({ vesselId })
      .sort({ recordedAt: -1 })
      .skip(keep)
      .select('_id')
      .lean()
      .exec();
    if (stale.length) {
      await TrackModel.deleteMany({ _id: { $in: stale.map((d) => d._id) } }).exec();
    }
  }
  async removeAll() {
    await TrackModel.deleteMany({}).exec();
  }
  async count() {
    return TrackModel.countDocuments().exec();
  }
}

class MongoAuditRepo implements AuditRepo {
  async append(entry: AuditEntry) {
    await AuditModel.create(entry);
  }
  async list(limit = 200) {
    return (await AuditModel.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()) as unknown as AuditEntry[];
  }
  async removeAll() {
    await AuditModel.deleteMany({}).exec();
  }
  async count() {
    return AuditModel.countDocuments().exec();
  }
}

export class MongoStore implements IDataStore {
  readonly driver = 'mongodb' as const;

  readonly users: UserRepo = new MongoUserRepo();
  readonly vessels: VesselRepo = new MongoVesselRepo();
  readonly zones: ZoneRepo = new MongoZoneRepo();
  readonly alerts: AlertRepo = new MongoAlertRepo();
  readonly incidents: IncidentRepo = new MongoIncidentRepo();
  readonly tracks: TrackRepo = new MongoTrackRepo();
  readonly audit: AuditRepo = new MongoAuditRepo();

  async connect(): Promise<void> {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.mongo.uri, { dbName: env.mongo.dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all(MODEL_REGISTRY.map((m) => m.syncIndexes()));
    logger.info(`mongodb connected → ${mongoose.connection.name}`);
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  async reset(includeUsers = false): Promise<void> {
    await Promise.all([
      this.vessels.removeAll(),
      this.zones.removeAll(),
      this.alerts.removeAll(),
      this.incidents.removeAll(),
      this.tracks.removeAll(),
      this.audit.removeAll(),
    ]);
    if (includeUsers) {
      await UserModel.deleteMany({}).exec();
    }
  }

  async stats(): Promise<{ collections: number; documents: number; driver: string }> {
    const db = mongoose.connection.db;
    if (!db) return { collections: 0, documents: 0, driver: this.driver };
    const collections = await db.listCollections().toArray();
    const counts = await Promise.all(
      collections.map((c) => db.collection(c.name).estimatedDocumentCount()),
    );
    return {
      collections: collections.length,
      documents: counts.reduce((a, b) => a + b, 0),
      driver: this.driver,
    };
  }
}

import mongoose, { Schema } from 'mongoose';
import {
  ALERT_STATUSES,
  ALERT_TYPES,
  AUTHORIZATION_STATUSES,
  INCIDENT_STATUSES,
  SEVERITIES,
  SIMULATION_STATUSES,
  TELEMETRY_SOURCES,
  USER_ROLES,
  VESSEL_STATUSES,
  VESSEL_TYPES,
  ZONE_STATUSES,
  ZONE_TYPES,
} from '../types/domain';

/**
 * Mongoose schemas for CIDRTM.
 *
 * Notes on the design:
 *  - `_id` is a string so business identifiers (`VSL-…`, `ZONE-…`) stay readable
 *    in the UI and in REST payloads.
 *  - `createdAt` / `updatedAt` are ISO strings, not BSON dates, so a document
 *    read from MongoDB is byte-for-byte the same shape as one read from the
 *    in-memory repository. Swapping drivers never changes an API response.
 *  - Zone rings are stored twice: `coordinates` (readable `{lat,lng}[]` used by
 *    the dashboard) and `geometry` (GeoJSON Polygon, ready for a 2dsphere index
 *    when the project moves to PostGIS/MongoDB spatial queries).
 *  - Every enum is validated at the schema level, mirroring the Zod validators.
 */

const baseOptions = { versionKey: false, timestamps: false } as const;

const baseFields = {
  _id: { type: String, required: true },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
};

const userSchema = new Schema(
  {
    ...baseFields,
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true, index: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: String, default: null },
  },
  baseOptions,
);

const vesselSchema = new Schema(
  {
    ...baseFields,
    vesselId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, required: true },
    vesselType: { type: String, enum: VESSEL_TYPES, required: true, index: true },
    owner: { type: String, default: '' },
    authorizationStatus: {
      type: String,
      enum: AUTHORIZATION_STATUSES,
      required: true,
      index: true,
    },
    currentLatitude: { type: Number, required: true },
    currentLongitude: { type: Number, required: true },
    speed: { type: Number, default: 0 },
    direction: { type: Number, default: 0 },
    status: { type: String, enum: VESSEL_STATUSES, default: 'ACTIVE', index: true },
    lastSeen: { type: String, default: null },
    homePort: { type: String, default: 'Kochi' },
    simulated: { type: Boolean, default: true },
    riskScore: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  baseOptions,
);
vesselSchema.index({ currentLatitude: 1, currentLongitude: 1 });

const zoneSchema = new Schema(
  {
    ...baseFields,
    zoneId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    zoneType: { type: String, enum: ZONE_TYPES, required: true, index: true },
    coordinates: {
      type: [
        new Schema(
          {
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
      validate: {
        validator: (ring: unknown[]) => Array.isArray(ring) && ring.length >= 3,
        message: 'A zone polygon needs at least 3 vertices',
      },
    },
    geometry: {
      type: { type: String, enum: ['Polygon'], default: 'Polygon' },
      coordinates: { type: [[[Number]]], default: [] },
    },
    approachBufferMeters: { type: Number, default: 500 },
    severity: { type: String, enum: SEVERITIES, required: true, index: true },
    status: { type: String, enum: ZONE_STATUSES, default: 'ENABLED', index: true },
    createdBy: { type: String, default: 'system' },
  },
  baseOptions,
);

const alertSchema = new Schema(
  {
    ...baseFields,
    alertId: { type: String, required: true, unique: true, index: true },
    vesselId: { type: String, required: true, index: true },
    vesselName: { type: String, default: '' },
    zoneId: { type: String, default: null, index: true },
    zoneName: { type: String, default: null },
    alertType: { type: String, enum: ALERT_TYPES, required: true, index: true },
    severity: { type: String, enum: SEVERITIES, required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ALERT_STATUSES, default: 'NEW', index: true },
    acknowledgedAt: { type: String, default: null },
    acknowledgedBy: { type: String, default: null },
    resolvedAt: { type: String, default: null },
    incidentId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  baseOptions,
);
alertSchema.index({ createdAt: -1 });

const incidentSchema = new Schema(
  {
    ...baseFields,
    incidentId: { type: String, required: true, unique: true, index: true },
    alertId: { type: String, default: null, index: true },
    vesselId: { type: String, required: true, index: true },
    vesselName: { type: String, default: '' },
    zoneId: { type: String, default: null, index: true },
    zoneName: { type: String, default: null },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    severity: { type: String, enum: SEVERITIES, required: true, index: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'OPEN', index: true },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    assignedTo: { type: String, default: null },
    timeline: {
      type: [
        new Schema(
          {
            at: { type: String, required: true },
            status: { type: String, enum: INCIDENT_STATUSES, required: true },
            by: { type: String, default: 'system' },
            note: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    acknowledgedAt: { type: String, default: null },
    resolvedAt: { type: String, default: null },
    closedAt: { type: String, default: null },
  },
  baseOptions,
);

const trackSchema = new Schema(
  {
    _id: { type: String, required: true },
    vesselId: { type: String, required: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    speed: { type: Number, default: 0 },
    direction: { type: Number, default: 0 },
    recordedAt: { type: String, required: true },
    source: { type: String, enum: TELEMETRY_SOURCES, default: 'SIMULATOR' },
  },
  { versionKey: false },
);
// TTL-ish housekeeping helper: newest-first reads per vessel.
trackSchema.index({ vesselId: 1, recordedAt: -1 });

const auditSchema = new Schema(
  {
    ...baseFields,
    actorId: { type: String, default: null },
    actorName: { type: String, default: 'system' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: '' },
    detail: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  baseOptions,
);
auditSchema.index({ createdAt: -1 });

const simulationStateSchema = new Schema(
  {
    _id: { type: String, default: 'singleton' },
    status: { type: String, enum: SIMULATION_STATUSES, default: 'IDLE' },
    speedMultiplier: { type: Number, default: 1 },
    tickMs: { type: Number, default: 1000 },
    ticks: { type: Number, default: 0 },
    startedAt: { type: String, default: null },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false },
);

export const UserModel = mongoose.model('User', userSchema);
export const VesselModel = mongoose.model('Vessel', vesselSchema);
export const ZoneModel = mongoose.model('Zone', zoneSchema);
export const AlertModel = mongoose.model('Alert', alertSchema);
export const IncidentModel = mongoose.model('Incident', incidentSchema);
export const TrackModel = mongoose.model('TrackPoint', trackSchema);
export const AuditModel = mongoose.model('AuditEntry', auditSchema);
export const SimulationStateModel = mongoose.model('SimulationState', simulationStateSchema);

export const MODEL_REGISTRY = [
  UserModel,
  VesselModel,
  ZoneModel,
  AlertModel,
  IncidentModel,
  TrackModel,
  AuditModel,
  SimulationStateModel,
];

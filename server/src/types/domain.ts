/**
 * Domain vocabulary for the Coastal Intrusion Detection & Real-Time Monitoring
 * System (CIDRTM). Every enum used by the API, the realtime bus and the
 * dashboard is declared here once so the three layers cannot drift apart.
 */

/* ────────────────────────────── Users ────────────────────────────── */

export const USER_ROLES = ['ADMIN', 'OPERATOR', 'ANALYST'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'System Administrator',
  OPERATOR: 'Security Operator',
  ANALYST: 'Intelligence Analyst',
};

/* ───────────────────────────── Vessels ───────────────────────────── */

export const VESSEL_TYPES = [
  'FISHING_BOAT',
  'CARGO_SHIP',
  'PASSENGER_BOAT',
  'PATROL_BOAT',
  'UNKNOWN',
] as const;
export type VesselType = (typeof VESSEL_TYPES)[number];

export const AUTHORIZATION_STATUSES = ['AUTHORIZED', 'UNAUTHORIZED'] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

export const VESSEL_STATUSES = ['ACTIVE', 'WARNING', 'INTRUSION', 'OFFLINE'] as const;
export type VesselStatus = (typeof VESSEL_STATUSES)[number];

/* ────────────────────────────── Zones ────────────────────────────── */

export const ZONE_TYPES = [
  'SECURITY_ZONE',
  'RESTRICTED_ZONE',
  'HARBOUR_ZONE',
  'NO_ENTRY_ZONE',
  'CUSTOM_ZONE',
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const ZONE_STATUSES = ['ENABLED', 'DISABLED'] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

/* ───────────────────────────── Severity ──────────────────────────── */

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/* ────────────────────────────── Alerts ───────────────────────────── */

export const ALERT_TYPES = [
  'ZONE_APPROACH',
  'UNAUTHORIZED_ENTRY',
  'VESSEL_OFFLINE',
  'SUSPICIOUS_MOVEMENT',
  'SYSTEM_WARNING',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/* ──────────────────────────── Incidents ──────────────────────────── */

export const INCIDENT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Legal forward transitions of the incident workflow. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'INVESTIGATING', 'CLOSED'],
  ACKNOWLEDGED: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
  INVESTIGATING: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};

/* ───────────────────────── Geofencing engine ─────────────────────── */

/** Position of a vessel relative to one polygon. */
export const GEOFENCE_STATES = ['OUTSIDE', 'APPROACHING', 'INSIDE'] as const;
export type GeofenceState = (typeof GEOFENCE_STATES)[number];

/** Final decision produced by the engine for one vessel/zone pair. */
export const GEOFENCE_VERDICTS = [
  'NORMAL',
  'WARNING',
  'AUTHORIZED_ENTRY',
  'INTRUSION',
] as const;
export type GeofenceVerdict = (typeof GEOFENCE_VERDICTS)[number];

/* ──────────────────────────── Telemetry ──────────────────────────── */

export const TELEMETRY_SOURCES = ['SIMULATOR', 'GNSS_DEVICE', 'MANUAL'] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

/* ──────────────────────────── Simulation ─────────────────────────── */

export const SIMULATION_STATUSES = ['IDLE', 'RUNNING', 'PAUSED', 'STOPPED'] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export const SIMULATION_SPEEDS = [1, 2, 5, 10] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];

/* ──────────────────────────── Geography ──────────────────────────── */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON Polygon, derived from `coordinates` for future 2dsphere indexing. */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

/* ──────────────────────────── Documents ──────────────────────────── */

export interface BaseDoc {
  _id: string;
  createdAt: string;
  updatedAt: string;
}

export interface User extends BaseDoc {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
}

export type PublicUser = Omit<User, 'passwordHash'>;

/**
 * The authenticated principal, as carried by the JWT and attached to `req.user`.
 * Services accept this minimal shape rather than a full `PublicUser`, so an action
 * can be attributed to a user without a database round-trip.
 */
export interface Actor {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Vessel extends BaseDoc {
  vesselId: string;
  /**
   * Short operator-facing call sign, e.g. `V005`.
   *
   * The technical `vesselId` is a long opaque business key and stays the database
   * identity; this is what appears on the map, in alerts and over the radio. A
   * watch officer says "V005 is closing the boundary", not "VSL-ADC0BB is".
   */
  vesselCode: string;
  name: string;
  registrationNumber: string;
  vesselType: VesselType;
  owner: string;
  authorizationStatus: AuthorizationStatus;
  currentLatitude: number;
  currentLongitude: number;
  speed: number;
  direction: number;
  status: VesselStatus;
  lastSeen: string | null;
  /** Home port / origin used by the simulator to build routes. */
  homePort: string;
  /** Whether the GPS simulator drives this vessel. */
  simulated: boolean;
  riskScore: number;
  notes: string;
}

export interface Zone extends BaseDoc {
  zoneId: string;
  name: string;
  description: string;
  zoneType: ZoneType;
  /** Ordered ring of the polygon. First vertex is not repeated. */
  coordinates: LatLng[];
  /** Derived GeoJSON representation, ready for a 2dsphere index. */
  geometry: PolygonGeometry;
  /** Extra band around the polygon edge that triggers an APPROACHING state (metres). */
  approachBufferMeters: number;
  severity: Severity;
  status: ZoneStatus;
  createdBy: string;
}

export interface Alert extends BaseDoc {
  alertId: string;
  vesselId: string;
  vesselName: string;
  zoneId: string | null;
  zoneName: string | null;
  alertType: AlertType;
  severity: Severity;
  latitude: number;
  longitude: number;
  message: string;
  status: AlertStatus;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  incidentId: string | null;
  metadata: Record<string, unknown>;
}

export interface IncidentTimelineEntry {
  at: string;
  status: IncidentStatus;
  by: string;
  note: string;
}

export interface Incident extends BaseDoc {
  incidentId: string;
  alertId: string | null;
  vesselId: string;
  vesselName: string;
  zoneId: string | null;
  zoneName: string | null;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  location: LatLng;
  assignedTo: string | null;
  timeline: IncidentTimelineEntry[];
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface TrackPoint {
  _id: string;
  vesselId: string;
  lat: number;
  lng: number;
  speed: number;
  direction: number;
  recordedAt: string;
  source: TelemetrySource;
}

export interface AuditEntry extends BaseDoc {
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  ip: string;
}

/* ──────────────────────────── Telemetry ──────────────────────────── */

export interface LocationUpdateInput {
  vesselId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  direction?: number;
  recordedAt?: string;
  source?: TelemetrySource;
}

export interface IngestionResult {
  vessel: Vessel;
  /** Every zone the vessel is currently inside, with its verdict. */
  evaluations: Array<{
    zoneId: string;
    zoneName: string;
    state: GeofenceState;
    verdict: GeofenceVerdict;
    distanceMeters: number;
  }>;
  createdAlerts: Alert[];
  createdIncidents: Incident[];
  statusChanged: boolean;
}

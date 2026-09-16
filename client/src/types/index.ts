/**
 * Frontend mirror of the backend domain vocabulary.
 * Kept hand-written (rather than generated) so the dashboard never depends on a
 * build step from the server — but the string unions match `server/src/types/domain.ts`
 * one-for-one, which is what makes the two halves interchangeable over the wire.
 */

export type UserRole = 'ADMIN' | 'OPERATOR' | 'ANALYST';

export interface PublicUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VesselType =
  | 'FISHING_BOAT'
  | 'CARGO_SHIP'
  | 'PASSENGER_BOAT'
  | 'PATROL_BOAT'
  | 'UNKNOWN';

export type AuthorizationStatus = 'AUTHORIZED' | 'UNAUTHORIZED';
export type VesselStatus = 'ACTIVE' | 'WARNING' | 'INTRUSION' | 'OFFLINE';

export interface Vessel {
  _id: string;
  vesselId: string;
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
  homePort: string;
  simulated: boolean;
  riskScore: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ZoneType =
  | 'SECURITY_ZONE'
  | 'RESTRICTED_ZONE'
  | 'HARBOUR_ZONE'
  | 'NO_ENTRY_ZONE'
  | 'CUSTOM_ZONE';

export type ZoneStatus = 'ENABLED' | 'DISABLED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Zone {
  _id: string;
  zoneId: string;
  name: string;
  description: string;
  zoneType: ZoneType;
  coordinates: LatLng[];
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  approachBufferMeters: number;
  severity: Severity;
  status: ZoneStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneWithStats extends Zone {
  areaSqKm: number;
  centroid: LatLng;
  alertCount?: number;
  intrusionCount?: number;
  vesselCount?: number;
}

export type AlertType =
  | 'ZONE_APPROACH'
  | 'UNAUTHORIZED_ENTRY'
  | 'VESSEL_OFFLINE'
  | 'SUSPICIOUS_MOVEMENT'
  | 'SYSTEM_WARNING';

export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Alert {
  _id: string;
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
  createdAt: string;
  updatedAt: string;
}

export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';

export interface IncidentTimelineEntry {
  at: string;
  status: IncidentStatus;
  by: string;
  note: string;
}

export interface Incident {
  _id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface TrackPoint {
  _id: string;
  vesselId: string;
  lat: number;
  lng: number;
  speed: number;
  direction: number;
  recordedAt: string;
  source: 'SIMULATOR' | 'GNSS_DEVICE' | 'MANUAL';
}

export interface AuditEntry {
  _id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  ip: string;
  createdAt: string;
}

export type GeofenceState = 'OUTSIDE' | 'APPROACHING' | 'INSIDE';
export type GeofenceVerdict = 'NORMAL' | 'WARNING' | 'AUTHORIZED_ENTRY' | 'INTRUSION';

export type SimulationStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface SimulationState {
  status: SimulationStatus;
  speedMultiplier: number;
  tickMs: number;
  ticks: number;
  elapsedSimSeconds: number;
  startedAt: string | null;
  lastTickAt: string | null;
  trackedVessels: number;
  zonesAvailable: number;
  ticksPerSecond: number;
  intrusionsGenerated: number;
  alertsGenerated: number;
  routes?: Array<{ vesselId: string; behavior: string; targetZoneId: string | null }>;
}

/** Live position frame broadcast on `vessel:location_updated`. */
export interface LocationBroadcast {
  vesselId: string;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  direction: number;
  status: VesselStatus;
  authorizationStatus: AuthorizationStatus;
  vesselType: VesselType;
  riskScore: number;
  lastSeen: string;
  nearestZone: string | null;
  nearestDistanceMeters: number | null;
  state: GeofenceState;
  verdict: GeofenceVerdict;
}

export interface VesselSummary {
  total: number;
  active: number;
  warning: number;
  intrusion: number;
  offline: number;
  authorized: number;
  unauthorized: number;
  byType: Record<string, number>;
  averageSpeed: number;
}

export interface AlertSummary {
  total: number;
  active: number;
  new: number;
  acknowledged: number;
  resolved: number;
  bySeverity: Record<Severity, number>;
  byType: Record<string, number>;
  last24h: number;
}

export interface IncidentSummary {
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
}

export interface DashboardOverview {
  vessels: VesselSummary;
  alerts: AlertSummary;
  incidents: IncidentSummary;
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
  zoneActivity: ZoneWithStats[];
  topRiskVessels: Array<
    Pick<Vessel, 'vesselId' | 'name' | 'vesselType' | 'status' | 'riskScore' | 'authorizationStatus'>
  >;
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
    simulation: SimulationState;
    memoryMb: number;
  };
}

export interface VesselStats {
  vesselId: string;
  trackPoints: number;
  distanceKm: number;
  maxSpeedKmh: number;
  averageSpeedKmh: number;
  alertCount: number;
  intrusionCount: number;
  incidentCount: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  environment: string;
  driver: string;
  uptimeSeconds: number;
  simulation: SimulationStatus;
  geofencePairs: number;
  timestamp: string;
}

export interface IntrusionEvent {
  alert: Alert;
  incident: Incident;
  vessel: Vessel;
  zone: { zoneId: string; name: string; zoneType: ZoneType };
  detectedAt: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Array<{ path: string; message: string }>;
}

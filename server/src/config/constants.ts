import type { AlertType, Severity, ZoneType } from '../types/domain';

/**
 * The monitored area.
 *
 * This is the **Kanyakumari coastal belt** — the southernmost stretch of the
 * Tamil Nadu coast, running from Thengapattanam and Colachel on the Arabian Sea
 * side, around Cape Comorin, to Kudankulam on the Gulf of Mannar side. The
 * bounds deliberately span both sea fronts because the cape is where they meet,
 * and a contact rounding it crosses from one to the other.
 */
export const THEATRE = {
  name: 'Kanyakumari Coastal Sector',
  center: { lat: 8.11, lng: 77.49 },
  bounds: { minLat: 7.99, maxLat: 8.23, minLng: 77.2, maxLng: 77.78 },
  defaultZoom: 11,
} as const;

/** Ports of call referenced by seeded vessels — all real Kanyakumari-district landings. */
export const HOME_PORTS = [
  'Kanyakumari',
  'Colachel',
  'Muttom',
  'Kudankulam',
  'Thengapattanam',
] as const;

/**
 * Simplified schematic trace of the Kanyakumari coastline, west to east.
 *
 * Deliberately coarse: this is a presentation aid that gives the operators a
 * land/sea reference, **not** survey-grade hydrography. It follows the named
 * landings and is smoothed between them, so it reads correctly at sector zoom
 * without pretending to centimetre accuracy.
 */
export const COASTLINE: ReadonlyArray<{ lat: number; lng: number }> = [
  { lat: 8.235, lng: 77.155 }, // Thengapattanam
  { lat: 8.218, lng: 77.18 }, // Erayumanthurai
  { lat: 8.202, lng: 77.205 },
  { lat: 8.19, lng: 77.232 }, // Kadiapattanam
  { lat: 8.175, lng: 77.258 }, // Colachel
  { lat: 8.156, lng: 77.285 }, // Poothurai
  { lat: 8.133, lng: 77.315 }, // Muttom
  { lat: 8.122, lng: 77.332 },
  { lat: 8.11, lng: 77.37 }, // Rajakkamangalam
  { lat: 8.1, lng: 77.415 },
  { lat: 8.088, lng: 77.478 }, // Manakudi estuary
  { lat: 8.082, lng: 77.52 }, // Kovalam
  { lat: 8.078, lng: 77.538 }, // Kanyakumari — Cape Comorin
  { lat: 8.072, lng: 77.552 }, // Sanguthurai
  { lat: 8.085, lng: 77.57 }, // Vattakottai
  { lat: 8.105, lng: 77.61 },
  { lat: 8.135, lng: 77.665 },
  { lat: 8.155, lng: 77.7 }, // Idinthakarai
  { lat: 8.168, lng: 77.712 }, // Kudankulam
  { lat: 8.19, lng: 77.74 },
];

/**
 * Land mass of the Kanyakumari district, as a closed polygon.
 *
 * Built from {@link COASTLINE} by running the trace west→east and then closing
 * it far inland to the north. Everything **inside** this ring is land; everything
 * outside is water. That single predicate is what keeps simulated vessels off the
 * beach — see `isOnLand` / `isOffshore` in `utils/maritime.ts`.
 *
 * The northern closure sits at 8.32 °N, well outside {@link THEATRE}, so within the
 * monitored box the only boundary that matters is the real coastline.
 */
export const LAND_POLYGON: { lat: number; lng: number }[] = [
  ...COASTLINE,
  { lat: 8.32, lng: 77.8 }, // north-east closure
  { lat: 8.32, lng: 77.1 }, // north-west closure
];

/**
 * Southernmost latitude of the coastline (Sanguthurai, just south of the cape).
 *
 * Any point below this is water at every longitude, so it is the one band that
 * needs no land test. Used as the guaranteed-safe fallback when rejection
 * sampling for an offshore point somehow fails.
 */
export const COAST_MIN_LAT = 8.072;

/**
 * Vessel classes and the human-readable role name each one carries.
 *
 * Operators read names, not enum values, so the displayed name is derived from
 * the role rather than invented — "Unauthorized Fishing Boat" tells a watch
 * officer what they are looking at in a way "Drifter" never did.
 */
export const VESSEL_TYPE_LABELS: Record<string, string> = {
  FISHING_BOAT: 'Fishing Boat',
  PATROL_BOAT: 'Patrol Boat',
  CARGO_SHIP: 'Cargo Ship',
  PASSENGER_BOAT: 'Passenger Boat',
  UNKNOWN: 'Unknown Craft',
};

/** Mean Earth radius in metres, used by every haversine helper. */
export const EARTH_RADIUS_M = 6_371_000;

export const KMH_TO_MS = 1000 / 3600;

export const DEFAULT_ZONE_APPROACH_BUFFER_M = 500;

/** Socket.IO event names — mirrored 1:1 in the dashboard client. */
export const SOCKET_EVENTS = {
  VESSEL_LOCATION_UPDATED: 'vessel:location_updated',
  VESSEL_STATUS_CHANGED: 'vessel:status_changed',
  VESSEL_CREATED: 'vessel:created',
  VESSEL_UPDATED: 'vessel:updated',
  VESSEL_DELETED: 'vessel:deleted',
  ZONE_CREATED: 'zone:created',
  ZONE_UPDATED: 'zone:updated',
  ZONE_DELETED: 'zone:deleted',
  INTRUSION_DETECTED: 'intrusion:detected',
  ALERT_CREATED: 'alert:created',
  ALERT_ACKNOWLEDGED: 'alert:acknowledged',
  ALERT_RESOLVED: 'alert:resolved',
  INCIDENT_CREATED: 'incident:created',
  INCIDENT_UPDATED: 'incident:updated',
  SIMULATION_STATE: 'simulation:state',
  SIMULATION_TICK: 'simulation:tick',
  STATS_UPDATED: 'stats:updated',
  SYSTEM_NOTICE: 'system:notice',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Socket.IO rooms, so the dashboard can subscribe narrowly. */
export const SOCKET_ROOMS = {
  MONITORING: 'monitoring',
  ALERTS: 'alerts',
  INCIDENTS: 'incidents',
} as const;

/** Human labels reused by REST responses and the dashboard. */
export const ZONE_TYPE_LABELS: Record<ZoneType, string> = {
  SECURITY_ZONE: 'Security Zone',
  RESTRICTED_ZONE: 'Restricted Zone',
  HARBOUR_ZONE: 'Harbour Zone',
  NO_ENTRY_ZONE: 'No-Entry Zone',
  CUSTOM_ZONE: 'Custom Zone',
};

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  ZONE_APPROACH: 'Zone Approach',
  UNAUTHORIZED_ENTRY: 'Unauthorized Entry',
  VESSEL_OFFLINE: 'Vessel Offline',
  SUSPICIOUS_MOVEMENT: 'Suspicious Movement',
  SYSTEM_WARNING: 'System Warning',
};

/** Severity assigned to a zone-approach alert, one step below the zone severity. */
export const APPROACH_SEVERITY: Record<Severity, Severity> = {
  CRITICAL: 'HIGH',
  HIGH: 'MEDIUM',
  MEDIUM: 'LOW',
  LOW: 'LOW',
};

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 50;

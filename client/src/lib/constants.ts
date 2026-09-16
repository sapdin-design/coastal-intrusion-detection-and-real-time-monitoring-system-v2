import type { AlertType, IncidentStatus, UserRole, VesselType, ZoneType } from '@/types';

/* ─────────────────────────────── Theatre ─────────────────────────────── */

/**
 * The monitored area — the Kanyakumari coastal belt, from Thengapattanam and
 * Colachel on the Arabian Sea side, around Cape Comorin, to Kudankulam on the
 * Gulf of Mannar side. Mirrors `THEATRE` on the server.
 */
export const THEATRE = {
  name: 'Kanyakumari Coastal Sector',
  center: [8.11, 77.49] as [number, number],
  bounds: [
    [7.99, 77.2],
    [8.23, 77.78],
  ] as [[number, number], [number, number]],
  defaultZoom: 11,
  maxZoom: 18,
};

/**
 * Simplified schematic trace of the Kanyakumari coastline, west to east.
 *
 * A presentation aid that gives the map a land/sea reference — deliberately
 * coarse and **not** survey-grade hydrography. Mirrors `COASTLINE` on the server.
 */
export const COASTLINE: [number, number][] = [
  [8.235, 77.155], // Thengapattanam
  [8.218, 77.18], // Erayumanthurai
  [8.202, 77.205],
  [8.19, 77.232], // Kadiapattanam
  [8.175, 77.258], // Colachel
  [8.156, 77.285], // Poothurai
  [8.133, 77.315], // Muttom
  [8.122, 77.332],
  [8.11, 77.37], // Rajakkamangalam
  [8.1, 77.415],
  [8.088, 77.478], // Manakudi estuary
  [8.082, 77.52], // Kovalam
  [8.078, 77.538], // Kanyakumari — Cape Comorin
  [8.072, 77.552], // Sanguthurai
  [8.085, 77.57], // Vattakottai
  [8.105, 77.61],
  [8.135, 77.665],
  [8.155, 77.7], // Idinthakarai
  [8.168, 77.712], // Kudankulam
  [8.19, 77.74],
];

export const TILE_LAYERS = {
  standard: {
    label: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  terrain: {
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
} as const;

export type TileLayerKey = keyof typeof TILE_LAYERS;

/* ──────────────────────────────── Labels ─────────────────────────────── */

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'System Administrator',
  OPERATOR: 'Security Operator',
  ANALYST: 'Intelligence Analyst',
};

export const VESSEL_TYPE_LABELS: Record<VesselType, string> = {
  FISHING_BOAT: 'Fishing Boat',
  CARGO_SHIP: 'Cargo Ship',
  PASSENGER_BOAT: 'Passenger Boat',
  PATROL_BOAT: 'Patrol Boat',
  UNKNOWN: 'Unknown',
};

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

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  INVESTIGATING: 'Investigating',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const VESSEL_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  WARNING: 'Warning',
  INTRUSION: 'Intrusion',
  OFFLINE: 'Offline',
};

export const AUTHORIZATION_LABELS: Record<string, string> = {
  AUTHORIZED: 'Authorized',
  UNAUTHORIZED: 'Unauthorized',
};

/** Ports of call offered in the vessel form — mirrors the server's seed list. */
export const HOME_PORTS_LABEL = [
  'Kanyakumari',
  'Colachel',
  'Muttom',
  'Kudankulam',
  'Thengapattanam',
];

/** Mirrors `INCIDENT_TRANSITIONS` on the server so the UI only offers legal moves. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'INVESTIGATING', 'CLOSED'],
  ACKNOWLEDGED: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
  INVESTIGATING: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};

export const INCIDENT_COLUMNS: IncidentStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
];

export const SIMULATION_SPEEDS = [1, 2, 5, 10] as const;

/* ───────────────────────────── Navigation ────────────────────────────── */

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: UserRole[];
  badge?: 'alerts' | 'incidents';
}

/**
 * Sidebar structure. `roles` gates an entry to specific roles; entries without it
 * are visible to everyone. Icons are looked up by name in `components/layout/icons.ts`
 * so this file stays free of React imports.
 */
export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { to: '/map', label: 'Live Map', icon: 'Radar' },
      { to: '/alerts', label: 'Alerts', icon: 'BellRing', badge: 'alerts' },
      { to: '/incidents', label: 'Incidents', icon: 'ClipboardList', badge: 'incidents' },
    ],
  },
  {
    title: 'Fleet & Zones',
    items: [
      { to: '/vessels', label: 'Vessels', icon: 'Ship' },
      { to: '/zones', label: 'Restricted Zones', icon: 'Hexagon' },
      { to: '/simulation', label: 'GPS Simulator', icon: 'PlayCircle', roles: ['ADMIN', 'OPERATOR'] },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { to: '/analytics', label: 'Analytics', icon: 'BarChart3' },
      { to: '/settings', label: 'Settings', icon: 'Settings' },
    ],
  },
];

/* ───────────────────────────── Realtime ──────────────────────────────── */

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
  SNAPSHOT: 'snapshot',
} as const;

/** How many live alerts the in-memory console keeps before dropping the oldest. */
export const LIVE_ALERT_BUFFER = 200;
/** Maximum route history rendered on the map per vessel. */
export const TRACK_LIMIT = 400;

export const THREAT_LEVEL_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  LOW: { label: 'Threat Level: Low', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  ELEVATED: { label: 'Threat Level: Elevated', className: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  HIGH: { label: 'Threat Level: High', className: 'bg-orange-50 text-orange-800 ring-orange-200', dot: 'bg-orange-500' },
  SEVERE: { label: 'Threat Level: Severe', className: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-600' },
};

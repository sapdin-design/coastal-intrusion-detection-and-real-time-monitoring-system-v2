import { HOME_PORTS, THEATRE } from './config/constants';
import { logger } from './config/logger';
import { getStore } from './repositories';
import type {
  Alert,
  AlertType,
  Incident,
  IncidentStatus,
  LatLng,
  Severity,
  Vessel,
  Zone,
} from './types/domain';
import { businessId, nowIso, randInt, randRange, round } from './utils/ids';
import { randomPointInBounds, toPolygonGeometry } from './utils/geo';
/**
 * Deterministic demo dataset.
 *
 * Two goals: (1) a first-run dashboard that is never empty, and (2) a scenario
 * that reliably exercises every branch of the pipeline — authorized transit,
 * zone approach, unauthorized intrusion, loitering and telemetry loss.
 */

interface ZoneSeed {
  name: string;
  description: string;
  zoneType: Zone['zoneType'];
  severity: Severity;
  coordinates: LatLng[];
  approachBufferMeters: number;
}

/**
 * Restricted zones for the Kanyakumari coastal sector.
 *
 * Every polygon is anchored to a real landing, cape or installation along the
 * district's coast, and each one is chosen to exercise a different enforcement
 * posture — from a critical nuclear exclusion perimeter to a purely advisory
 * anchorage. Names are the actual local places, so the dashboard reads like a
 * genuine sector picture rather than a generic demo.
 */
export const ZONE_SEEDS: ZoneSeed[] = [
  {
    name: 'Kudankulam Nuclear Exclusion Zone',
    description:
      'Maritime exclusion perimeter covering the seaward approaches to the Kudankulam nuclear installation. Any unauthorized contact inside this polygon is treated as a critical intrusion and escalated immediately.',
    zoneType: 'SECURITY_ZONE',
    severity: 'CRITICAL',
    approachBufferMeters: 1000,
    coordinates: [
      { lat: 8.186, lng: 77.686 },
      { lat: 8.19, lng: 77.734 },
      { lat: 8.162, lng: 77.752 },
      { lat: 8.142, lng: 77.724 },
      { lat: 8.152, lng: 77.684 },
    ],
  },
  {
    name: 'Colachel Port Restricted Approach',
    description:
      'Compulsory pilotage waters off Colachel harbour. Inbound vessels must hold outside the 500 m buffer until a pilot is embarked.',
    zoneType: 'RESTRICTED_ZONE',
    severity: 'HIGH',
    approachBufferMeters: 500,
    coordinates: [
      { lat: 8.196, lng: 77.226 },
      { lat: 8.2, lng: 77.274 },
      { lat: 8.17, lng: 77.29 },
      { lat: 8.15, lng: 77.252 },
      { lat: 8.168, lng: 77.22 },
    ],
  },
  {
    name: 'Kanyakumari Cape Exclusion Area',
    description:
      'Protective cordon around Cape Comorin covering the Vivekananda Rock and Thiruvalluvar statue approaches. Small-craft traffic and diving prohibited.',
    zoneType: 'NO_ENTRY_ZONE',
    severity: 'HIGH',
    approachBufferMeters: 600,
    coordinates: [
      { lat: 8.094, lng: 77.516 },
      { lat: 8.098, lng: 77.558 },
      { lat: 8.068, lng: 77.568 },
      { lat: 8.056, lng: 77.53 },
      { lat: 8.072, lng: 77.51 },
    ],
  },
  {
    name: 'Muttom Harbour Basin',
    description:
      'Fishing harbour basin at Muttom. Authorized harbour craft and licensed fishing vessels only; through traffic should stand off.',
    zoneType: 'HARBOUR_ZONE',
    severity: 'MEDIUM',
    approachBufferMeters: 400,
    coordinates: [
      { lat: 8.146, lng: 77.296 },
      { lat: 8.15, lng: 77.334 },
      { lat: 8.126, lng: 77.344 },
      { lat: 8.114, lng: 77.312 },
      { lat: 8.128, lng: 77.292 },
    ],
  },
  {
    name: 'Manakudi Estuary No-Entry Corridor',
    description:
      'Permanent no-entry corridor protecting the Manakudi mangrove estuary and its fish-breeding grounds. Nets and trawling prohibited year round.',
    zoneType: 'NO_ENTRY_ZONE',
    severity: 'CRITICAL',
    approachBufferMeters: 600,
    coordinates: [
      { lat: 8.102, lng: 77.46 },
      { lat: 8.106, lng: 77.496 },
      { lat: 8.078, lng: 77.504 },
      { lat: 8.066, lng: 77.472 },
      { lat: 8.084, lng: 77.454 },
    ],
  },
  {
    name: 'Kanyakumari Outer Anchorage Buffer',
    description:
      'Designated waiting anchorage off the cape for inbound merchant traffic. Advisory zone — entry is monitored, not prohibited.',
    zoneType: 'CUSTOM_ZONE',
    severity: 'LOW',
    approachBufferMeters: 350,
    coordinates: [
      { lat: 8.04, lng: 77.55 },
      { lat: 8.044, lng: 77.606 },
      { lat: 8.012, lng: 77.618 },
      { lat: 8.0, lng: 77.564 },
      { lat: 8.02, lng: 77.544 },
    ],
  },
];

interface VesselSeed {
  name: string;
  vesselType: Vessel['vesselType'];
  authorizationStatus: Vessel['authorizationStatus'];
  owner: string;
}

export const VESSEL_SEEDS: VesselSeed[] = [
  { name: 'Sea Guardian', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Coastal Security Command' },
  { name: 'Coastal Sentinel', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Coastal Security Command' },
  { name: 'MV Lakshmi', vesselType: 'CARGO_SHIP', authorizationStatus: 'AUTHORIZED', owner: 'Lakshmi Shipping Lines' },
  { name: 'MV Bharat Star', vesselType: 'CARGO_SHIP', authorizationStatus: 'AUTHORIZED', owner: 'Bharat Marine Logistics' },
  { name: 'MV Coral Trader', vesselType: 'CARGO_SHIP', authorizationStatus: 'AUTHORIZED', owner: 'Coral Freight Pvt Ltd' },
  { name: 'Pearl Diver', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Colachel Fishermen Co-op' },
  { name: 'Blue Horizon', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Blue Horizon Fisheries' },
  { name: 'St. Xavier', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'St. Xavier Boat Owners Assn.' },
  { name: 'Sea Breeze', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Private' },
  { name: 'Nautilus', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Nautilus Marine' },
  { name: 'Coral Queen', vesselType: 'PASSENGER_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Kanyakumari Ferry Services' },
  { name: 'Coastal Express', vesselType: 'PASSENGER_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Kanyakumari Ferry Services' },
  { name: 'Island Ferry II', vesselType: 'PASSENGER_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Southern Water Transit' },
  { name: 'Unknown Skiff 01', vesselType: 'UNKNOWN', authorizationStatus: 'UNAUTHORIZED', owner: 'Unidentified' },
  { name: 'Unknown Skiff 02', vesselType: 'UNKNOWN', authorizationStatus: 'UNAUTHORIZED', owner: 'Unidentified' },
  { name: 'Shadow Trader', vesselType: 'CARGO_SHIP', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered' },
  { name: 'Night Runner', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered' },
  { name: 'Drifter', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered' },
  { name: 'Ghost Wave', vesselType: 'UNKNOWN', authorizationStatus: 'UNAUTHORIZED', owner: 'Unidentified' },
  { name: 'Silent Tide', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered' },
];

/* ─────────────────────────────── Seeding ─────────────────────────────── */

export async function seedZones(): Promise<Zone[]> {
  const store = getStore();
  const existing = await store.zones.count();
  if (existing > 0) return store.zones.list();

  const at = nowIso();
  const zones: Zone[] = ZONE_SEEDS.map((seed) => ({
    _id: businessId('zone'),
    zoneId: businessId('zone'),
    name: seed.name,
    description: seed.description,
    zoneType: seed.zoneType,
    coordinates: seed.coordinates,
    geometry: toPolygonGeometry(seed.coordinates),
    approachBufferMeters: seed.approachBufferMeters,
    severity: seed.severity,
    status: 'ENABLED',
    createdBy: 'seed',
    createdAt: at,
    updatedAt: at,
  }));

  const created = await store.zones.createMany(zones);
  logger.info(`seeded ${created.length} restricted zones`);
  return created;
}

export async function seedVessels(): Promise<Vessel[]> {
  const store = getStore();
  const existing = await store.vessels.count();
  if (existing > 0) return store.vessels.list();

  const at = nowIso();
  const vessels: Vessel[] = VESSEL_SEEDS.map((seed, index) => {
    const point = randomPointInBounds(THEATRE.bounds);
    return {
      _id: businessId('vessel'),
      vesselId: businessId('vessel'),
      name: seed.name,
      registrationNumber: `IN-KLK-${String(1200 + index * 7).padStart(4, '0')}`,
      vesselType: seed.vesselType,
      owner: seed.owner,
      authorizationStatus: seed.authorizationStatus,
      currentLatitude: round(point.lat, 5),
      currentLongitude: round(point.lng, 5),
      speed: round(randRange(4, 18), 1),
      direction: round(randRange(0, 360), 0),
      status: 'ACTIVE',
      lastSeen: at,
      homePort: HOME_PORTS[index % HOME_PORTS.length],
      simulated: true,
      riskScore: seed.authorizationStatus === 'UNAUTHORIZED' ? 45 : 10,
      notes:
        seed.authorizationStatus === 'UNAUTHORIZED'
          ? 'No valid permit on file — flagged for monitoring.'
          : '',
      createdAt: at,
      updatedAt: at,
    };
  });

  const created = await store.vessels.createMany(vessels);
  logger.info(`seeded ${created.length} vessels (${vessels.filter((v) => v.authorizationStatus === 'UNAUTHORIZED').length} unauthorized)`);
  return created;
}

/**
 * Backdated alert and incident history.
 *
 * Without this the analytics page is blank for the first few minutes while the
 * simulator accumulates events. Spreading ~60 alerts and ~12 incidents across the
 * last 72 hours makes every chart, KPI and trend line meaningful from the first
 * page load.
 */
export async function seedHistory(): Promise<void> {
  const store = getStore();
  if ((await store.alerts.count()) > 0) return;

  const vessels = await store.vessels.list();
  const zones = await store.zones.list();
  if (!vessels.length || !zones.length) return;

  const alertTypes: Array<{ type: AlertType; weight: number; severity: Severity }> = [
    { type: 'ZONE_APPROACH', weight: 46, severity: 'LOW' },
    { type: 'UNAUTHORIZED_ENTRY', weight: 18, severity: 'CRITICAL' },
    { type: 'SUSPICIOUS_MOVEMENT', weight: 16, severity: 'MEDIUM' },
    { type: 'VESSEL_OFFLINE', weight: 12, severity: 'MEDIUM' },
    { type: 'SYSTEM_WARNING', weight: 8, severity: 'LOW' },
  ];

  const pickType = (): (typeof alertTypes)[number] => {
    const total = alertTypes.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * total;
    for (const entry of alertTypes) {
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return alertTypes[0];
  };

  const alerts: Alert[] = [];
  const incidents: Incident[] = [];
  const count = randInt(55, 75);

  for (let i = 0; i < count; i += 1) {
    const vessel = vessels[Math.floor(Math.random() * vessels.length)];
    const zone = zones[Math.floor(Math.random() * zones.length)];
    const spec = pickType();
    const ageMinutes = randInt(5, 72 * 60);
    const createdAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
    const acknowledged = Math.random() < 0.62;
    const resolved = acknowledged && Math.random() < 0.55;

    const alertId = businessId('alert');
    const alert: Alert = {
      _id: alertId,
      alertId,
      vesselId: vessel.vesselId,
      vesselName: vessel.name,
      zoneId: spec.type === 'VESSEL_OFFLINE' || spec.type === 'SYSTEM_WARNING' ? null : zone.zoneId,
      zoneName: spec.type === 'VESSEL_OFFLINE' || spec.type === 'SYSTEM_WARNING' ? null : zone.name,
      alertType: spec.type,
      severity: spec.type === 'UNAUTHORIZED_ENTRY' ? (Math.random() < 0.5 ? 'CRITICAL' : 'HIGH') : spec.severity,
      latitude: round(vessel.currentLatitude + randRange(-0.03, 0.03), 5),
      longitude: round(vessel.currentLongitude + randRange(-0.03, 0.03), 5),
      message: buildHistoricalMessage(spec.type, vessel.name, vessel.vesselId, zone.name),
      status: resolved ? 'RESOLVED' : acknowledged ? 'ACKNOWLEDGED' : 'NEW',
      acknowledgedAt: acknowledged ? new Date(new Date(createdAt).getTime() + randInt(1, 12) * 60_000).toISOString() : null,
      acknowledgedBy: acknowledged ? 'Priya Nair' : null,
      resolvedAt: resolved ? new Date(new Date(createdAt).getTime() + randInt(13, 90) * 60_000).toISOString() : null,
      incidentId: null,
      metadata: { seeded: true },
      createdAt,
      updatedAt: createdAt,
    };
    alerts.push(alert);

    // A slice of intrusions becomes an incident so the board and the MTTA/MTTR
    // metrics have real data behind them.
    if (spec.type === 'UNAUTHORIZED_ENTRY' && incidents.length < 12) {
      const incidentId = businessId('incident');
      const status: IncidentStatus = resolved
        ? Math.random() < 0.5
          ? 'CLOSED'
          : 'RESOLVED'
        : acknowledged
          ? 'INVESTIGATING'
          : 'OPEN';
      const ackAt = acknowledged ? alert.acknowledgedAt : null;
      const resolveAt = resolved ? alert.resolvedAt : null;

      incidents.push({
        _id: incidentId,
        incidentId,
        alertId,
        vesselId: vessel.vesselId,
        vesselName: vessel.name,
        zoneId: zone.zoneId,
        zoneName: zone.name,
        title: `Unauthorized entry into ${zone.name}`,
        description: `Vessel ${vessel.name} (${vessel.vesselId}) entered ${zone.name} without authorization and was tracked by the geofencing engine.`,
        severity: alert.severity,
        status,
        location: { lat: alert.latitude, lng: alert.longitude },
        assignedTo: acknowledged ? 'Priya Nair' : null,
        timeline: [
          { at: createdAt, status: 'OPEN', by: 'geofencing-engine', note: 'Auto-generated from intrusion alert.' },
          ...(ackAt ? [{ at: ackAt, status: 'ACKNOWLEDGED' as IncidentStatus, by: 'Priya Nair', note: 'Acknowledged by duty operator.' }] : []),
          ...(ackAt ? [{ at: new Date(new Date(ackAt).getTime() + 6 * 60_000).toISOString(), status: 'INVESTIGATING' as IncidentStatus, by: 'Priya Nair', note: 'Patrol boat diverted for interception.' }] : []),
          ...(resolveAt ? [{ at: resolveAt, status: 'RESOLVED' as IncidentStatus, by: 'Aarav Menon', note: 'Vessel escorted out of the restricted area.' }] : []),
        ],
        acknowledgedAt: ackAt,
        resolvedAt: resolveAt,
        closedAt: status === 'CLOSED' ? resolveAt : null,
        createdAt,
        updatedAt: resolveAt ?? createdAt,
      });
      alert.incidentId = incidentId;
    }
  }

  await store.alerts.createMany(alerts);
  if (incidents.length) {
    for (const incident of incidents) await store.incidents.create(incident);
  }
  logger.info(`seeded ${alerts.length} historical alerts and ${incidents.length} incidents`);
}

function buildHistoricalMessage(type: AlertType, name: string, vesselId: string, zoneName: string): string {
  switch (type) {
    case 'UNAUTHORIZED_ENTRY':
      return `UNAUTHORIZED vessel ${name} (${vesselId}) entered ${zoneName}.`;
    case 'ZONE_APPROACH':
      return `${name} (${vesselId}) is approaching ${zoneName} — ${randInt(80, 480)} m from the boundary.`;
    case 'SUSPICIOUS_MOVEMENT':
      return `${name} (${vesselId}) displayed erratic course changes near ${zoneName}.`;
    case 'VESSEL_OFFLINE':
      return `Telemetry lost for ${name} (${vesselId}) — no position report received.`;
    default:
      return `Geofencing engine reported a degraded evaluation for ${name} (${vesselId}).`;
  }
}

/** Full idempotent bootstrap. Safe to call on every server start. */
export async function ensureSeed(): Promise<void> {
  await seedZones();
  await seedVessels();
  await seedHistory();
}

import fs from 'node:fs';
import path from 'node:path';
import { THEATRE } from './config/constants';
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
import { isOnLand, randomOffshorePoint } from './utils/maritime';
import { toPolygonGeometry } from './utils/geo';
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
 * Every polygon sits **offshore** — in the sea approaches to the place it is named
 * after, not on top of it. The original set was anchored to the towns themselves,
 * which put five of the six polygons partly over land: a "harbour basin" drawn
 * across the harbour town, an "exclusion area" covering the cape's car park. A
 * maritime exclusion zone is a patch of water, so each polygon is now offset
 * seaward of its namesake and validated against the coastline by
 * `npm run validate:maritime`.
 *
 * The names are the real local places, so the sector picture still reads true;
 * what moved is the geometry, not the geography.
 */
export const ZONE_SEEDS: ZoneSeed[] = [
  {
    name: 'Kudankulam Nuclear Exclusion Zone',
    description:
      'Maritime exclusion perimeter in the sea approaches to the Kudankulam installation, standing roughly 6 km off the beach. Any unauthorized contact inside this polygon is treated as a critical intrusion and escalated immediately.',
    zoneType: 'SECURITY_ZONE',
    severity: 'CRITICAL',
    approachBufferMeters: 1000,
    coordinates: [
      { lat: 8.115, lng: 77.665 },
      { lat: 8.118, lng: 77.73 },
      { lat: 8.075, lng: 77.745 },
      { lat: 8.062, lng: 77.7 },
      { lat: 8.08, lng: 77.66 },
    ],
  },
  {
    name: 'Colachel Port Restricted Approach',
    description:
      'Compulsory pilotage waters on the seaward approach to Colachel harbour. Inbound vessels must hold outside the 500 m buffer until a pilot is embarked.',
    zoneType: 'RESTRICTED_ZONE',
    severity: 'HIGH',
    approachBufferMeters: 500,
    coordinates: [
      { lat: 8.108, lng: 77.205 },
      { lat: 8.112, lng: 77.275 },
      { lat: 8.062, lng: 77.285 },
      { lat: 8.05, lng: 77.23 },
      { lat: 8.07, lng: 77.198 },
    ],
  },
  {
    name: 'Kanyakumari Cape Exclusion Area',
    description:
      'Protective cordon covering the seaward approaches to Cape Comorin and the Vivekananda Rock, lying south of the cape in open water. Small-craft traffic and diving prohibited.',
    zoneType: 'NO_ENTRY_ZONE',
    severity: 'HIGH',
    approachBufferMeters: 600,
    coordinates: [
      { lat: 8.058, lng: 77.49 },
      { lat: 8.06, lng: 77.585 },
      { lat: 8.015, lng: 77.6 },
      { lat: 7.998, lng: 77.53 },
      { lat: 8.015, lng: 77.48 },
    ],
  },
  {
    name: 'Muttom Harbour Approach',
    description:
      'Approach channel and holding area off Muttom. Authorized harbour craft and licensed fishing vessels only; through traffic should stand off.',
    zoneType: 'HARBOUR_ZONE',
    severity: 'MEDIUM',
    approachBufferMeters: 400,
    // Shifted east of the Colachel approach waters — the two polygons used to
    // overlap around 77.28 °E.
    coordinates: [
      { lat: 8.082, lng: 77.302 },
      { lat: 8.086, lng: 77.352 },
      { lat: 8.042, lng: 77.36 },
      { lat: 8.032, lng: 77.308 },
      { lat: 8.052, lng: 77.298 },
    ],
  },
  {
    name: 'Manakudi Estuary No-Entry Corridor',
    description:
      'Permanent no-entry corridor in the coastal water fronting the Manakudi mangrove estuary, protecting the fish-breeding grounds. Nets and trawling prohibited year round.',
    zoneType: 'NO_ENTRY_ZONE',
    severity: 'CRITICAL',
    approachBufferMeters: 600,
    // Sits off the estuary mouth at 77.39–77.46, with a 1.8 km channel of open
    // water between it and the cape exclusion area to the east. The two used to
    // overlap, which meant a contact running for the cape tripped a Manakudi
    // alert on the way — the validator now rejects that.
    coordinates: [
      { lat: 8.042, lng: 77.396 },
      { lat: 8.044, lng: 77.458 },
      { lat: 8.002, lng: 77.464 },
      { lat: 7.99, lng: 77.406 },
      { lat: 8.008, lng: 77.388 },
    ],
  },
  {
    name: 'Kanyakumari Outer Anchorage Buffer',
    description:
      'Designated waiting anchorage south-east of the cape for inbound merchant traffic. Advisory zone — entry is monitored, not prohibited.',
    zoneType: 'CUSTOM_ZONE',
    severity: 'LOW',
    approachBufferMeters: 350,
    // Pushed clear of the cape exclusion area, which previously overlapped it.
    coordinates: [
      { lat: 8.012, lng: 77.618 },
      { lat: 8.016, lng: 77.7 },
      { lat: 7.978, lng: 77.712 },
      { lat: 7.974, lng: 77.648 },
      { lat: 7.984, lng: 77.612 },
    ],
  },
];

interface VesselSeed {
  /** Operator call sign shown in the UI, e.g. `V005`. */
  code: string;
  name: string;
  vesselType: Vessel['vesselType'];
  authorizationStatus: Vessel['authorizationStatus'];
  owner: string;
  homePort: string;
  /** Offshore spawn point. Every one of these is validated at sea. */
  spawn: { lat: number; lng: number };
}

/**
 * The fleet.
 *
 * Names are deliberately **role-descriptive rather than poetic**. An earlier pass
 * used invented names — "Drifter", "Ghost Wave", "Blue Horizon" — which look
 * atmospheric on a slide but tell a watch officer nothing. "Unauthorized Fishing
 * Boat" says what the contact *is* and what its legal status is in the same
 * breath, which is the whole point of a contact list.
 *
 * The technical identity stays in `vesselId`; `code` (V001…V020) is what gets
 * spoken aloud and shown on the map.
 */
export const VESSEL_SEEDS: VesselSeed[] = [
  { code: 'V001', name: 'Sea Guardian Patrol Boat', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Coastal Security Command', homePort: 'Colachel', spawn: { lat: 8.044, lng: 77.21 } },
  { code: 'V002', name: 'Kanyakumari Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Kanyakumari Fishermen Co-op', homePort: 'Kanyakumari', spawn: { lat: 8.028, lng: 77.206 } },
  { code: 'V003', name: 'Coastal Cargo Ship', vesselType: 'CARGO_SHIP', authorizationStatus: 'AUTHORIZED', owner: 'Southern Marine Logistics', homePort: 'Colachel', spawn: { lat: 7.972, lng: 77.404 } },
  { code: 'V004', name: 'Passenger Ferry Boat', vesselType: 'PASSENGER_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Kanyakumari Ferry Services', homePort: 'Kanyakumari', spawn: { lat: 8.046, lng: 77.702 } },
  // V005 is the Intrusion Demo's lead contact. Its spawn is the head of the
  // Cape Exclusion Intrusion Run, in open water roughly 4.5 km clear of every
  // zone and its warning buffer, so the run always opens on a clean NORMAL.
  { code: 'V005', name: 'Unauthorized Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered', homePort: 'Kanyakumari', spawn: { lat: 7.982, lng: 77.482 } },
  { code: 'V006', name: 'Unknown Speed Boat', vesselType: 'UNKNOWN', authorizationStatus: 'UNAUTHORIZED', owner: 'Unidentified', homePort: 'Thengapattanam', spawn: { lat: 7.978, lng: 77.392 } },
  { code: 'V007', name: 'Coastal Patrol Boat', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Coastal Security Command', homePort: 'Muttom', spawn: { lat: 8.046, lng: 77.252 } },
  { code: 'V008', name: 'Rescue Patrol Boat', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Marine Rescue Service', homePort: 'Kudankulam', spawn: { lat: 8.034, lng: 77.664 } },
  { code: 'V009', name: 'Colachel Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Colachel Fishermen Co-op', homePort: 'Colachel', spawn: { lat: 8.03, lng: 77.372 } },
  { code: 'V010', name: 'Muttom Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Muttom Boat Owners Assn.', homePort: 'Muttom', spawn: { lat: 8.034, lng: 77.302 } },
  { code: 'V011', name: 'Coastal Supply Vessel', vesselType: 'CARGO_SHIP', authorizationStatus: 'AUTHORIZED', owner: 'Southern Marine Logistics', homePort: 'Kudankulam', spawn: { lat: 7.958, lng: 77.542 } },
  { code: 'V012', name: 'Kanyakumari Passenger Boat', vesselType: 'PASSENGER_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Kanyakumari Ferry Services', homePort: 'Kanyakumari', spawn: { lat: 7.972, lng: 77.442 } },
  { code: 'V013', name: 'Thengapattanam Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Thengapattanam Co-op', homePort: 'Thengapattanam', spawn: { lat: 8.05, lng: 77.276 } },
  { code: 'V014', name: 'Unregistered Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered', homePort: 'Muttom', spawn: { lat: 8.044, lng: 77.332 } },
  { code: 'V015', name: 'Suspicious Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered', homePort: 'Kanyakumari', spawn: { lat: 7.966, lng: 77.372 } },
  { code: 'V016', name: 'Unregistered Cargo Ship', vesselType: 'CARGO_SHIP', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered', homePort: 'Kudankulam', spawn: { lat: 8.024, lng: 77.614 } },
  { code: 'V017', name: 'Unidentified Craft', vesselType: 'UNKNOWN', authorizationStatus: 'UNAUTHORIZED', owner: 'Unidentified', homePort: 'Kanyakumari', spawn: { lat: 7.99, lng: 77.502 } },
  { code: 'V018', name: 'Harbour Pilot Boat', vesselType: 'PATROL_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Colachel Port Authority', homePort: 'Colachel', spawn: { lat: 8.026, lng: 77.347 } },
  { code: 'V019', name: 'Manakudi Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'AUTHORIZED', owner: 'Manakudi Fishermen Co-op', homePort: 'Kanyakumari', spawn: { lat: 7.984, lng: 77.402 } },
  { code: 'V020', name: 'Dark Fishing Boat', vesselType: 'FISHING_BOAT', authorizationStatus: 'UNAUTHORIZED', owner: 'Unregistered', homePort: 'Thengapattanam', spawn: { lat: 7.962, lng: 77.472 } },
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
  const vessels: Vessel[] = VESSEL_SEEDS.map((seed) => {
    // Explicit offshore spawn — never a random point in the bounding box, which
    // would put boats in the middle of Kanyakumari town.
    const point = seed.spawn ?? randomOffshorePoint(THEATRE.bounds);
    return {
      _id: businessId('vessel'),
      vesselId: businessId('vessel'),
      vesselCode: seed.code,
      name: seed.name,
      registrationNumber: `REG-TN-${String(1000 + Math.floor(Math.random() * 8999))}`,
      vesselType: seed.vesselType,
      owner: seed.owner,
      authorizationStatus: seed.authorizationStatus,
      currentLatitude: round(point.lat, 5),
      currentLongitude: round(point.lng, 5),
      speed: round(randRange(4, 18), 1),
      direction: round(randRange(0, 360), 0),
      status: 'ACTIVE',
      lastSeen: at,
      homePort: seed.homePort,
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
  logger.info(
    `seeded ${created.length} vessels (${vessels.filter((v) => v.authorizationStatus === 'UNAUTHORIZED').length} unauthorized)`,
  );
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

  // Only an unauthorized contact can commit an unauthorized entry. Picking from
  // the whole fleet at random used to put "unauthorized entry" incidents against
  // licensed patrol boats and harbour pilots — a seeded history that contradicts
  // itself the moment anyone reads it.
  const unauthorized = vessels.filter((v) => v.authorizationStatus === 'UNAUTHORIZED');
  const entryPool = unauthorized.length ? unauthorized : vessels;

  for (let i = 0; i < count; i += 1) {
    const spec = pickType();
    const pool = spec.type === 'UNAUTHORIZED_ENTRY' ? entryPool : vessels;
    const vessel = pool[Math.floor(Math.random() * pool.length)];
    const zone = zones[Math.floor(Math.random() * zones.length)];
    const ageMinutes = randInt(5, 72 * 60);
    const createdAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
    const acknowledged = Math.random() < 0.62;
    const resolved = acknowledged && Math.random() < 0.55;

    const alertId = businessId('alert');
    // An unauthorized entry into a no-entry zone is CRITICAL, matching the live
    // geofencing engine; anything else keeps its own band.
    const severity: Severity =
      spec.type === 'UNAUTHORIZED_ENTRY'
        ? zone.zoneType === 'NO_ENTRY_ZONE'
          ? 'CRITICAL'
          : Math.random() < 0.5
            ? 'CRITICAL'
            : 'HIGH'
        : spec.severity;
    const alert: Alert = {
      _id: alertId,
      alertId,
      vesselId: vessel.vesselId,
      vesselName: vessel.name,
      zoneId: spec.type === 'VESSEL_OFFLINE' || spec.type === 'SYSTEM_WARNING' ? null : zone.zoneId,
      zoneName: spec.type === 'VESSEL_OFFLINE' || spec.type === 'SYSTEM_WARNING' ? null : zone.name,
      alertType: spec.type,
      severity,
      latitude: round(vessel.currentLatitude + randRange(-0.03, 0.03), 5),
      longitude: round(vessel.currentLongitude + randRange(-0.03, 0.03), 5),
      message: buildHistoricalMessage(spec.type, vessel, zone.name, severity),
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
        title: `${vessel.name} ${vessel.vesselCode} — unauthorized entry into ${zone.name}`,
        description: `${vessel.name} ${vessel.vesselCode} crossed into ${zone.name} without authorization and was tracked by the geofencing engine.`,
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

function buildHistoricalMessage(
  type: AlertType,
  vessel: Vessel,
  zoneName: string,
  severity: Severity = 'HIGH',
): string {
  const who = `${vessel.name} ${vessel.vesselCode}`;
  switch (type) {
    case 'UNAUTHORIZED_ENTRY':
      return `${severity} — ${who} has entered ${zoneName}.`;
    case 'ZONE_APPROACH':
      return `${who} is ${randInt(80, 480)} m from ${zoneName} and closing.`;
    case 'SUSPICIOUS_MOVEMENT':
      return `${who} is holding station near ${zoneName} with erratic course changes.`;
    case 'VESSEL_OFFLINE':
      return `Telemetry lost with ${who} — no position report received.`;
    default:
      return `Geofencing engine reported a degraded evaluation for ${who}.`;
  }
}

/**
 * Detects a dataset that predates the offshore-geography upgrade.
 *
 * The store persists to `data/store.json` and is restored on boot, so shipping
 * new seed data is not enough — an existing snapshot wins and the old on-land
 * vessels and land-sitting zones would survive the upgrade. Rather than keep a
 * version counter in sync by hand, staleness is derived from the data itself:
 * a snapshot is stale if any vessel lacks a call sign, or if any vessel or zone
 * vertex is sitting on land.
 */
async function isStoreStale(): Promise<boolean> {
  const store = getStore();
  const vessels = await store.vessels.list();
  if (!vessels.length) return false;

  if (vessels.some((v) => !v.vesselCode)) return true;
  if (
    vessels.some((v) =>
      isOnLand({ lat: v.currentLatitude, lng: v.currentLongitude }),
    )
  ) {
    return true;
  }

  const zones = await store.zones.list();
  if (zones.some((z) => z.coordinates.some((point) => isOnLand(point)))) return true;

  // An "unauthorized entry" logged against a licensed vessel is a contradiction:
  // either the vessel record or the history is wrong. The seeded generator used
  // to pick from the whole fleet at random, so older snapshots are full of these.
  const authorizedIds = new Set(
    vessels.filter((v) => v.authorizationStatus === 'AUTHORIZED').map((v) => v.vesselId),
  );
  const alerts = await store.alerts.list();
  if (
    alerts.some(
      (alert) => alert.alertType === 'UNAUTHORIZED_ENTRY' && authorizedIds.has(alert.vesselId),
    )
  ) {
    return true;
  }

  // A stored zone set can be entirely offshore and still be the *wrong*
  // geography — two restricted areas overlapping each other, or one sitting in
  // the path of a patrol lane. Those are exactly the defects the maritime
  // validator rejects at build time, so the stored polygons are compared
  // against the seed here and a re-shaped zone set triggers a rebuild.
  if (zones.length !== ZONE_SEEDS.length) return true;
  const seedByName = new Map(ZONE_SEEDS.map((zone) => [zone.name, zone]));
  for (const zone of zones) {
    const seed = seedByName.get(zone.name);
    if (!seed) return true;
    if (zone.coordinates.length !== seed.coordinates.length) return true;
    for (let i = 0; i < seed.coordinates.length; i += 1) {
      const stored = zone.coordinates[i];
      const expected = seed.coordinates[i];
      if (Math.abs(stored.lat - expected.lat) > 1e-6 || Math.abs(stored.lng - expected.lng) > 1e-6) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Copies the current snapshot aside so a rebuild is never a silent data loss.
 *
 * Returns false when the copy could not be made. The caller must treat that as a
 * hard stop: a migration that cannot back up has no business deleting anything.
 */
async function backupSnapshot(): Promise<boolean> {
  try {
    const dataDir = path.resolve(__dirname, '../data');
    const source = path.join(dataDir, 'store.json');
    if (!fs.existsSync(source)) {
      logger.warn('no snapshot on disk yet — nothing to back up');
      return true;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dataDir, `store.pre-offshore-${stamp}.json`);
    fs.copyFileSync(source, target);
    logger.warn(`snapshot backed up to ${path.basename(target)} before rebuild`);
    return true;
  } catch (error) {
    logger.error(`could not back up snapshot: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Rebuilds the dataset when the stored one predates the offshore upgrade.
 *
 * Zones, vessels, alerts and incidents are regenerated together because they are
 * mutually referential — keeping the old alert history against a new fleet would
 * leave dangling vessel references and a contact list that no longer reconciles.
 *
 * **The rebuild aborts unless the snapshot was successfully copied aside.** An
 * earlier revision logged a failed backup and carried on regardless, which is how
 * a snapshot gets destroyed with no way back.
 */
async function migrateIfStale(): Promise<void> {
  const store = getStore();
  if (!(await isStoreStale())) return;

  const backedUp = await backupSnapshot();
  if (!backedUp) {
    logger.error(
      'rebuild skipped — the existing snapshot could not be backed up. Fix the backup path and restart; no data has been changed.',
    );
    return;
  }

  logger.warn(
    'stored dataset predates the offshore-geography upgrade (land-based vessels or zones) — rebuilding from seed',
  );

  await store.tracks.removeAll();
  await store.alerts.removeAll();
  await store.incidents.removeAll();
  await store.zones.removeAll();
  await store.vessels.removeAll();
}

/** Full idempotent bootstrap. Safe to call on every server start. */
export async function ensureSeed(): Promise<void> {
  await migrateIfStale();
  await seedZones();
  await seedVessels();
  await seedHistory();
}

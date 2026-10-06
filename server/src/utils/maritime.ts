import {
  COAST_MIN_LAT,
  LAND_POLYGON,
  THEATRE,
} from '../config/constants';
import type { LatLng } from '../types/domain';
import {
  distanceToPolygonMeters,
  haversineMeters,
  pointInPolygon,
  randomPointInBounds,
} from './geo';
import { randRange, round } from './ids';

/**
 * Maritime geography guards.
 *
 * The single most important rule in this project is that a simulated vessel must
 * never appear on land. Before this module existed, spawn points came from
 * `randomPointInBounds(THEATRE.bounds)` — a rectangle that contains Kanyakumari
 * town, the A2 highway and a good deal of farmland. Vessels therefore spent much
 * of their time driving over buildings.
 *
 * Everything here works off one predicate: {@link isOnLand}. The land mass is a
 * closed polygon built from the coastline trace, so "inside the ring" is land and
 * "outside" is water. Routes, spawn points and zone polygons are all validated
 * against it before the simulator is allowed to use them.
 */

/** Default stand-off from the shoreline, in metres. */
export const DEFAULT_OFFSHORE_MARGIN_M = 250;

/** True when the point falls inside the land mass. */
export function isOnLand(point: LatLng, marginM = 0): boolean {
  if (pointInPolygon(point, LAND_POLYGON)) return true;
  if (marginM <= 0) return false;
  // Outside the ring, but close enough to the shore to be a beaching risk.
  return distanceToPolygonMeters(point, LAND_POLYGON) < marginM;
}

/** True when the point is safely at sea, at least `marginM` from the shoreline. */
export function isOffshore(point: LatLng, marginM = DEFAULT_OFFSHORE_MARGIN_M): boolean {
  return !isOnLand(point, marginM);
}

/** Distance from a point to the nearest land, in metres. */
export function distanceToLandMeters(point: LatLng): number {
  if (pointInPolygon(point, LAND_POLYGON)) return 0;
  return round(distanceToPolygonMeters(point, LAND_POLYGON), 1);
}

/**
 * A random point guaranteed to be at sea.
 *
 * Rejection sampling against the land mask, with a hard fallback: everything
 * south of {@link COAST_MIN_LAT} is water at every longitude, so if sampling
 * somehow fails we return a point from that band rather than silently handing
 * back somewhere on land.
 */
export function randomOffshorePoint(
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } = THEATRE.bounds,
  marginM = DEFAULT_OFFSHORE_MARGIN_M,
): LatLng {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const candidate = randomPointInBounds(bounds);
    if (isOffshore(candidate, marginM)) return candidate;
  }
  return {
    lat: round(randRange(bounds.minLat, Math.min(COAST_MIN_LAT - 0.01, bounds.maxLat)), 5),
    lng: round(randRange(bounds.minLng, bounds.maxLng), 5),
  };
}

/* ─────────────────────────── Predefined routes ─────────────────────────── */

export type RouteScenario = 'PATROL' | 'TRANSIT' | 'APPROACH' | 'INTRUSION' | 'WITHDRAWAL';

export interface MaritimeRoute {
  id: string;
  name: string;
  scenario: RouteScenario;
  description: string;
  /** Ordered offshore waypoints. The vessel loops back to the first on completion. */
  waypoints: LatLng[];
  /** Zone this route is designed to interact with, by zone name. */
  targetZoneName?: string;
  /**
   * Typical speed for this lane, in km/h.
   *
   * A patrol box is worked at a leisurely 20 km/h; a contact running a
   * restricted-area lane does 30 km/h, which is what makes the demonstration
   * reach the boundary in about a minute at 10× rather than a quarter of an hour.
   */
  cruiseSpeedKmh: number;
}

const P = (lat: number, lng: number): LatLng => ({ lat, lng });

/**
 * The maritime route library.
 *
 * Every waypoint below is offshore — the validator at the bottom of this file
 * proves it, and `npm run validate:maritime` re-checks it on demand. Routes are
 * hand-drawn to follow plausible sea lanes: patrol boxes off the western and
 * eastern beaches, a coastal transit lane standing a few kilometres off, and an
 * intrusion approach that crosses the cape exclusion boundary from open water.
 */
export const MARITIME_ROUTES: MaritimeRoute[] = [
  {
    id: 'PATROL-WEST',
    name: 'Western Offshore Patrol Box',
    scenario: 'PATROL',
    description:
      'Standing patrol box off Colachel and Muttom, running parallel to the shore about 5 km out.',
    cruiseSpeedKmh: 20,
    // The return leg is kept south of the Muttom harbour approach, which the
    // original alignment clipped at the north-east corner of the box.
    waypoints: [
      P(8.044, 77.208),
      P(8.038, 77.245),
      P(8.032, 77.282),
      P(8.024, 77.318),
      P(8.032, 77.356),
      P(8.026, 77.32),
      P(8.038, 77.268),
    ],
  },
  {
    id: 'PATROL-EAST',
    name: 'Eastern Offshore Patrol Box',
    scenario: 'PATROL',
    description:
      'Patrol box covering the Gulf of Mannar approaches off Vattakottai and Kudankulam.',
    cruiseSpeedKmh: 20,
    // Stood east of the cape exclusion area and the outer anchorage, which it
    // used to run straight through.
    waypoints: [
      P(8.048, 77.726),
      P(8.036, 77.69),
      P(8.026, 77.65),
      P(8.018, 77.616),
      P(8.028, 77.664),
      P(8.042, 77.702),
    ],
  },
  {
    id: 'TRANSIT-COASTAL',
    name: 'Coastal Transit Lane',
    scenario: 'TRANSIT',
    description:
      'Through-traffic lane standing well off the beach, Thengapattanam round to the cape.',
    cruiseSpeedKmh: 26,
    // Stands south of the Manakudi corridor, which the previous alignment cut
    // through on its way east.
    waypoints: [
      P(8.03, 77.2),
      P(8.018, 77.26),
      P(8.004, 77.32),
      P(7.988, 77.38),
      P(7.972, 77.44),
      P(7.962, 77.5),
    ],
  },
  {
    id: 'TRANSIT-ROUNDING',
    name: 'Cape Rounding Passage',
    scenario: 'TRANSIT',
    description:
      'Deep-water passage for traffic rounding Cape Comorin from the Arabian Sea into the Gulf of Mannar.',
    cruiseSpeedKmh: 26,
    // Runs south of the outer anchorage rather than across it.
    waypoints: [
      P(7.972, 77.4),
      P(7.962, 77.47),
      P(7.958, 77.54),
      P(7.96, 77.61),
      P(7.966, 77.67),
    ],
  },
  {
    id: 'APPROACH-CAPE',
    name: 'Cape Exclusion Approach',
    scenario: 'APPROACH',
    description:
      'Vessel runs in toward the cape exclusion boundary, holds just outside it, then withdraws. ' +
      'Exercises the APPROACHING state without ever crossing the polygon.',
    targetZoneName: 'Kanyakumari Cape Exclusion Area',
    cruiseSpeedKmh: 22,
    // Starts about 3 km short of the boundary so the APPROACHING beat arrives in
    // under a minute at 10×, and turns back at a point 520 m clear of the
    // polygon — inside the warning buffer, never inside the zone.
    waypoints: [
      P(7.99, 77.492),
      P(7.994, 77.506),
      P(7.996, 77.522),
      P(7.992, 77.502),
      P(7.988, 77.482),
    ],
  },
  {
    id: 'INTRUSION-CAPE',
    name: 'Cape Exclusion Intrusion Run',
    scenario: 'INTRUSION',
    description:
      'The demonstration run. An unauthorized boat approaches the cape exclusion area from ' +
      'open water, crosses the offshore boundary, transits the polygon, then clears it to the ' +
      'east. Every leg is over water.',
    targetZoneName: 'Kanyakumari Cape Exclusion Area',
    cruiseSpeedKmh: 30,
    waypoints: [
      // Open sea, ~4.5 km clear of every zone and its warning buffer.
      P(7.982, 77.482),
      P(7.99, 77.502),
      P(7.996, 77.52),
      // Crosses the boundary between here and the next waypoint.
      P(8.008, 77.538),
      P(8.028, 77.556),
      P(8.044, 77.58),
      // Clears the polygon to the east, staying west of the outer anchorage.
      P(8.026, 77.604),
      // Runs well south of everything so the loop back does not clip a zone and
      // raise a second intrusion on the return leg.
      P(7.972, 77.606),
    ],
  },
  {
    id: 'INTRUSION-MANAKUDI',
    name: 'Manakudi Corridor Intrusion Run',
    scenario: 'INTRUSION',
    description:
      'Second intrusion profile, converging on the Manakudi no-entry corridor from the south-west.',
    targetZoneName: 'Manakudi Estuary No-Entry Corridor',
    cruiseSpeedKmh: 30,
    waypoints: [
      // ~2 km clear of the corridor's warning buffer.
      P(7.978, 77.392),
      P(7.986, 77.406),
      // Crosses into the corridor between here and the next waypoint.
      P(8.0, 77.422),
      P(8.016, 77.436),
      P(8.03, 77.45),
      // Clears the corridor to the east.
      P(8.016, 77.468),
      P(7.982, 77.466),
    ],
  },
  {
    id: 'WITHDRAWAL-CAPE',
    name: 'Exclusion Area Withdrawal',
    scenario: 'WITHDRAWAL',
    description:
      'A contact that has been inside the cape exclusion area clearing it to the south — used to ' +
      'demonstrate incident resolution.',
    targetZoneName: 'Kanyakumari Cape Exclusion Area',
    cruiseSpeedKmh: 24,
    waypoints: [
      P(8.03, 77.545),
      P(8.014, 77.528),
      P(7.998, 77.5),
      P(7.982, 77.474),
    ],
  },
];

export const routeById = (id: string): MaritimeRoute | undefined =>
  MARITIME_ROUTES.find((route) => route.id === id);

/* ────────────────────────── Invariant validation ───────────────────────── */

export interface RouteViolation {
  routeId: string;
  routeName: string;
  waypointIndex: number;
  point: LatLng;
  reason: string;
}

export interface ValidationReport {
  ok: boolean;
  checkedRoutes: number;
  checkedWaypoints: number;
  violations: RouteViolation[];
}

/**
 * Proves a route is entirely offshore.
 *
 * Checks the waypoints themselves *and* the segments between them: a route whose
 * endpoints are both at sea can still cut across a headland, which is exactly the
 * failure that puts a boat on the beach mid-transit.
 */
export function validateOffshoreRoute(
  route: MaritimeRoute,
  marginM = DEFAULT_OFFSHORE_MARGIN_M,
): RouteViolation[] {
  const violations: RouteViolation[] = [];

  route.waypoints.forEach((point, index) => {
    if (!isOffshore(point, marginM)) {
      violations.push({
        routeId: route.id,
        routeName: route.name,
        waypointIndex: index,
        point,
        reason: isOnLand(point)
          ? 'waypoint falls on land'
          : `waypoint is within ${marginM} m of the shoreline`,
      });
    }
  });

  // Walk each leg in ~200 m steps and check the intermediate water.
  const LEG_SAMPLES = 24;
  for (let i = 0; i < route.waypoints.length - 1; i += 1) {
    const a = route.waypoints[i];
    const b = route.waypoints[i + 1];
    for (let s = 1; s < LEG_SAMPLES; s += 1) {
      const t = s / LEG_SAMPLES;
      const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      if (isOnLand(point)) {
        violations.push({
          routeId: route.id,
          routeName: route.name,
          waypointIndex: i,
          point,
          reason: `leg ${i}→${i + 1} crosses land`,
        });
        break;
      }
    }
  }

  return violations;
}

/* ─────────────────────── Polygon interaction helpers ───────────────────── */

/** True when segments p1→p2 and p3→p4 cross. */
function segmentsIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const cross = (a: LatLng, b: LatLng, c: LatLng): number =>
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two closed polygons share any area. */
export function polygonsOverlap(a: LatLng[], b: LatLng[]): boolean {
  if (a.some((point) => pointInPolygon(point, b))) return true;
  if (b.some((point) => pointInPolygon(point, a))) return true;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/** True when any part of the polyline enters the polygon. */
export function pathEntersPolygon(points: LatLng[], polygon: LatLng[]): boolean {
  if (points.some((point) => pointInPolygon(point, polygon))) return true;
  const SAMPLES = 24;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    for (let s = 1; s < SAMPLES; s += 1) {
      const t = s / SAMPLES;
      const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      if (pointInPolygon(point, polygon)) return true;
    }
  }
  return false;
}

/** Distance in metres from a point to the nearest vertex of a polygon. */
function nearestVertexMeters(point: LatLng, polygon: LatLng[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const vertex of polygon) {
    const distance = haversineMeters(point, vertex);
    if (distance < best) best = distance;
  }
  return best;
}

/** Validates every route in the library plus every zone polygon. */
export function validateMaritimeInvariants(
  zones: Array<{ name: string; coordinates: LatLng[]; approachBufferMeters?: number }> = [],
  marginM = DEFAULT_OFFSHORE_MARGIN_M,
  spawns: Array<{ code: string; point: LatLng }> = [],
): ValidationReport {
  const violations: RouteViolation[] = [];
  let checkedWaypoints = 0;

  for (const route of MARITIME_ROUTES) {
    checkedWaypoints += route.waypoints.length;
    violations.push(...validateOffshoreRoute(route, marginM));
  }

  /* ── Zones must not overlap each other ──────────────────────────────────
     Two exclusion polygons sharing water means a contact running for one of
     them trips the other's alert on the way, which is both confusing on the
     map and wrong in the incident log. */
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      if (polygonsOverlap(zones[i].coordinates, zones[j].coordinates)) {
        violations.push({
          routeId: `zone:${zones[i].name}`,
          routeName: zones[i].name,
          waypointIndex: -1,
          point: zones[i].coordinates[0],
          reason: `polygon overlaps "${zones[j].name}" — restricted areas must be spatially distinct`,
        });
      }
    }
  }

  /* ── A route may only enter the zone it declares ────────────────────────
     A patrol lane must stay out of every restricted area; an intrusion lane
     must enter its own target and nothing else. */
  for (const route of MARITIME_ROUTES) {
    for (const zone of zones) {
      const enters = pathEntersPolygon(route.waypoints, zone.coordinates);
      if (!enters) continue;
      if (route.targetZoneName === zone.name) continue;
      violations.push({
        routeId: route.id,
        routeName: route.name,
        waypointIndex: -1,
        point: route.waypoints[0],
        reason: route.targetZoneName
          ? `route crosses "${zone.name}" but declares "${route.targetZoneName}" as its target`
          : `route crosses restricted zone "${zone.name}"`,
      });
    }

    // A declared intrusion/approach lane must actually reach its target.
    if (route.targetZoneName) {
      const target = zones.find((zone) => zone.name === route.targetZoneName);
      if (target && route.scenario === 'INTRUSION' && !pathEntersPolygon(route.waypoints, target.coordinates)) {
        violations.push({
          routeId: route.id,
          routeName: route.name,
          waypointIndex: -1,
          point: route.waypoints[0],
          reason: `intrusion route never crosses its declared target "${route.targetZoneName}"`,
        });
      }
    }
  }

  /* ── Every lane must open in genuinely open water ───────────────────────
     The first waypoint is where a staged vessel is parked, so it must be clear
     of every zone and its warning buffer — otherwise the "open sea" opening
     beat of a demonstration is already inside a warning state. */
  for (const route of MARITIME_ROUTES) {
    const start = route.waypoints[0];
    for (const zone of zones) {
      if (route.targetZoneName === zone.name) continue;
      const buffer = zone.approachBufferMeters ?? 0;
      if (nearestVertexMeters(start, zone.coordinates) < buffer) {
        violations.push({
          routeId: route.id,
          routeName: route.name,
          waypointIndex: 0,
          point: start,
          reason: `lane starts inside the warning buffer of "${zone.name}" — a staged vessel would open in WARNING`,
        });
      }
    }
  }

  for (const zone of zones) {
    zone.coordinates.forEach((point, index) => {
      if (!isOffshore(point, marginM)) {
        violations.push({
          routeId: `zone:${zone.name}`,
          routeName: zone.name,
          waypointIndex: index,
          point,
          reason: isOnLand(point) ? 'zone vertex falls on land' : 'zone vertex is too close to shore',
        });
      }
    });
    // Zone interior edges must also stay off the beach.
    for (let i = 0; i < zone.coordinates.length; i += 1) {
      const a = zone.coordinates[i];
      const b = zone.coordinates[(i + 1) % zone.coordinates.length];
      for (let s = 1; s < 12; s += 1) {
        const t = s / 12;
        const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
        if (isOnLand(point)) {
          violations.push({
            routeId: `zone:${zone.name}`,
            routeName: zone.name,
            waypointIndex: i,
            point,
            reason: `zone edge ${i} crosses land`,
          });
          break;
        }
      }
    }
  }

  /* ── Spawn points must be at sea, and clear of every warning buffer ───── */
  for (const spawn of spawns) {
    if (!isOffshore(spawn.point, marginM)) {
      violations.push({
        routeId: `vessel:${spawn.code}`,
        routeName: spawn.code,
        waypointIndex: -1,
        point: spawn.point,
        reason: isOnLand(spawn.point)
          ? 'spawn point falls on land'
          : `spawn point is within ${marginM} m of the shoreline`,
      });
      continue;
    }
    for (const zone of zones) {
      const buffer = zone.approachBufferMeters ?? 0;
      if (nearestVertexMeters(spawn.point, zone.coordinates) < buffer) {
        violations.push({
          routeId: `vessel:${spawn.code}`,
          routeName: spawn.code,
          waypointIndex: -1,
          point: spawn.point,
          reason: `spawn point sits inside the warning buffer of "${zone.name}"`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    checkedRoutes: MARITIME_ROUTES.length,
    checkedWaypoints,
    violations,
  };
}

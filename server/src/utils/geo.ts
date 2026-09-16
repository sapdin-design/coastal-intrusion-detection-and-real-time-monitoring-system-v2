import { EARTH_RADIUS_M, KMH_TO_MS } from '../config/constants';
import type { LatLng, PolygonGeometry } from '../types/domain';
import { randRange } from './ids';

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, normalised to 0–360 degrees. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `distanceMeters` from `origin` along `bearing`. */
export function destinationPoint(origin: LatLng, bearing: number, distanceMeters: number): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const brg = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brg),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Distance covered in one tick, in metres, for a speed given in km/h. */
export function speedToStepMeters(speedKmh: number, dtSeconds: number): number {
  return speedKmh * KMH_TO_MS * dtSeconds;
}

/* ───────────────────────── Point ↔ polygon maths ───────────────────────── */

/** Shortest distance from `p` to segment `a`→`b`, in metres (local planar approx). */
function distanceToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const latRef = toRad((a.lat + b.lat) / 2);
  const mPerDegLat = 111_132.95;
  const mPerDegLng = 111_319.49 * Math.cos(latRef);

  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Ray-casting point-in-polygon test. The ring must not repeat its first vertex. */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to the polygon boundary, in metres. 0 when inside. */
export function distanceToPolygonMeters(p: LatLng, polygon: LatLng[]): number {
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(p, polygon)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegmentMeters(p, polygon[j], polygon[i]));
  }
  return best;
}

/** Signed area in square metres, via the shoelace formula on a local projection. */
export function polygonAreaSqMeters(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const latRef = toRad(polygon.reduce((s, v) => s + v.lat, 0) / polygon.length);
  const mPerDegLat = 111_132.95;
  const mPerDegLng = 111_319.49 * Math.cos(latRef);
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng * mPerDegLng;
    const yi = polygon[i].lat * mPerDegLat;
    const xj = polygon[j].lng * mPerDegLng;
    const yj = polygon[j].lat * mPerDegLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

export function polygonCentroid(polygon: LatLng[]): LatLng {
  if (!polygon.length) return { lat: 0, lng: 0 };
  return {
    lat: polygon.reduce((s, v) => s + v.lat, 0) / polygon.length,
    lng: polygon.reduce((s, v) => s + v.lng, 0) / polygon.length,
  };
}

/** GeoJSON Polygon derived from the stored ring — ready for a MongoDB 2dsphere index. */
export function toPolygonGeometry(polygon: LatLng[]): PolygonGeometry {
  const ring = polygon.map((v) => [v.lng, v.lat]);
  if (ring.length) ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/* ───────────────────────────── Random helpers ──────────────────────────── */

export function randomPointInBounds(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): LatLng {
  return {
    lat: randRange(bounds.minLat, bounds.maxLat),
    lng: randRange(bounds.minLng, bounds.maxLng),
  };
}

/** Formats a coordinate pair the way the UI shows it (e.g. `8.4521° N, 77.5210° E`). */
export function formatCoord(value: number, axis: 'lat' | 'lng'): string {
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(4)}° ${hemi}`;
}

/**
 * Maritime invariant check.
 *
 * Fails loudly if any predefined route waypoint, route leg, or zone polygon
 * vertex touches land. Run it after editing routes or zones:
 *
 *   npm run validate:maritime
 *
 * Exits non-zero on violation so it can gate a build.
 */
import { VESSEL_SEEDS, ZONE_SEEDS } from '../seed-data';
import { DEFAULT_OFFSHORE_MARGIN_M, validateMaritimeInvariants } from '../utils/maritime';
import { MARITIME_ROUTES } from '../utils/maritime';

const report = validateMaritimeInvariants(
  ZONE_SEEDS.map((z) => ({
    name: z.name,
    coordinates: z.coordinates,
    approachBufferMeters: z.approachBufferMeters,
  })),
  DEFAULT_OFFSHORE_MARGIN_M,
  VESSEL_SEEDS.map((v) => ({ code: v.code, point: v.spawn })),
);

console.log('──────────────────────────────────────────────────────');
console.log(' CIDRTM maritime invariant check');
console.log(` stand-off margin: ${DEFAULT_OFFSHORE_MARGIN_M} m`);
console.log('──────────────────────────────────────────────────────');
console.log(` routes checked    : ${report.checkedRoutes}`);
console.log(` waypoints checked : ${report.checkedWaypoints}`);
console.log(` zone polygons     : ${ZONE_SEEDS.length}`);
console.log(` spawn points      : ${VESSEL_SEEDS.length}`);
console.log('');

if (report.ok) {
  console.log(' ✓ every route waypoint and leg is offshore');
  console.log(' ✓ every zone polygon vertex and edge is offshore');
  console.log(' ✓ no two restricted zones overlap');
  console.log(' ✓ no lane enters a zone it does not declare as its target');
  console.log(' ✓ every intrusion lane actually crosses its declared target');
  console.log(' ✓ every lane opens in open water, clear of all warning buffers');
  console.log(' ✓ every vessel spawns at sea, clear of all warning buffers');
  console.log('');
  console.log(' RESULT: PASS — no simulated vessel or zone can touch land, and the');
  console.log('         restricted areas are spatially distinct.');
  process.exit(0);
}

console.log(` ✗ ${report.violations.length} violation(s):`);
for (const v of report.violations) {
  console.log(
    `   · [${v.routeId}] ${v.reason} — ${v.point.lat.toFixed(4)}, ${v.point.lng.toFixed(4)}` +
      (v.waypointIndex >= 0 ? ` (index ${v.waypointIndex})` : ''),
  );
}
console.log('');
console.log(' RESULT: FAIL');
process.exit(1);

// Keep the import used even when the report short-circuits.
void MARITIME_ROUTES;

/**
 * End-to-end simulation verification.
 *
 * Drives the geofencing pipeline in-process and asserts the two things that
 * matter most about this system:
 *
 *   1. No simulated vessel is ever on land — not at spawn, and not at any point
 *      during motion.
 *   2. An unauthorized boat approaching a restricted zone actually crosses the
 *      offshore boundary and produces APPROACHING → INTRUSION → alert → incident.
 *
 * Run:  npm run verify:simulation
 */
import { closeStore, getStore, initStore } from '../repositories';
import { ensureSeed } from '../seed-data';
import { simulationEngine } from '../services/simulation.service';
import type { LatLng } from '../types/domain';
import { isOnLand, validateMaritimeInvariants } from '../utils/maritime';

const TICKS = 300;
const SPEED = 10;

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const at = (v: { currentLatitude: number; currentLongitude: number }): LatLng => ({
  lat: v.currentLatitude,
  lng: v.currentLongitude,
});

async function main(): Promise<void> {
  await initStore();
  await ensureSeed();

  const store = getStore();
  const zones = await store.zones.list();

  /* ── 1. static geography ─────────────────────────────────────────────── */
  console.log('\n▸ static geography');
  const report = validateMaritimeInvariants(
    zones.map((z) => ({ name: z.name, coordinates: z.coordinates })),
  );
  check('every route waypoint and leg is offshore', report.ok,
    `${report.checkedRoutes} routes, ${report.checkedWaypoints} waypoints`);
  if (!report.ok) {
    for (const v of report.violations.slice(0, 5)) {
      console.log(`         · [${v.routeId}] ${v.reason} at ${v.point.lat},${v.point.lng}`);
    }
  }

  const vessels = await store.vessels.list();
  const landedSpawns = vessels.filter((v) => isOnLand(at(v)));
  check('every vessel spawn point is offshore', landedSpawns.length === 0,
    landedSpawns.length ? `${landedSpawns.length} on land` : `${vessels.length} checked`);

  const zoneOnLand = zones.filter((z) => z.coordinates.some((p) => isOnLand(p)));
  check('no zone polygon overlaps land', zoneOnLand.length === 0,
    zoneOnLand.map((z) => z.name).join(', ') || `${zones.length} zones checked`);

  const coded = vessels.filter((v) => Boolean(v.vesselCode));
  check('every vessel carries an operator call sign', coded.length === vessels.length,
    `${coded.length}/${vessels.length}`);

  const descriptive = vessels.filter((v) => /boat|ship|vessel|craft/i.test(v.name));
  check('vessel names describe the vessel class', descriptive.length === vessels.length,
    `${descriptive.length}/${vessels.length}`);

  /* ── 2. motion ───────────────────────────────────────────────────────── */
  console.log(`\n▸ simulation (${TICKS} ticks at ${SPEED}×)`);
  await simulationEngine.reset(false);
  simulationEngine.setSpeed(SPEED);

  const statuses = new Map<string, Set<string>>();
  let landObservations = 0;
  const landSamples: string[] = [];

  for (let i = 0; i < TICKS; i += 1) {
    await simulationEngine.step();
    for (const vessel of await store.vessels.list()) {
      if (isOnLand(at(vessel))) {
        landObservations += 1;
        if (landSamples.length < 3) {
          landSamples.push(
            `${vessel.vesselCode ?? vessel.vesselId} at ${vessel.currentLatitude.toFixed(4)},${vessel.currentLongitude.toFixed(4)}`,
          );
        }
      }
      const set = statuses.get(vessel.vesselId) ?? new Set<string>();
      set.add(vessel.status);
      statuses.set(vessel.vesselId, set);
    }
  }

  check('no vessel ever appears on land during motion', landObservations === 0,
    landObservations ? `${landObservations} observations: ${landSamples.join(' | ')}` :
      `${TICKS} ticks × ${vessels.length} vessels sampled`);

  const moved = [...statuses.values()].filter((s) => s.has('ACTIVE')).length;
  check('vessels are moving', moved > 0, `${moved} vessels reported ACTIVE`);

  /* ── 3. the intrusion chain ──────────────────────────────────────────────
     Run against INTRUSION_DEMO rather than the default multi-vessel picture.
     In a multi-vessel sweep lane assignment is by proximity, so V005 can
     legitimately be given a transit lane and never approach a zone — the chain
     assertion has to be made against the scenario that is designed to produce
     it, which is also the run the brief asks to be verified end to end. */
  console.log('\n▸ intrusion chain (INTRUSION_DEMO)');
  await simulationEngine.setScenario('INTRUSION_DEMO');
  await simulationEngine.reset(false);

  const demo = (await store.vessels.list()).find((v) => v.vesselCode === 'V005');
  const demoStatuses = new Set<string>();
  const chainStart = new Set((await store.alerts.list()).map((a) => a.alertId));
  const chainIncidentIds = new Set((await store.incidents.list()).map((i) => i.incidentId));

  for (let i = 0; i < TICKS; i += 1) {
    await simulationEngine.step();
    const current = (await store.vessels.list()).find((v) => v.vesselId === demo?.vesselId);
    if (!current) continue;
    demoStatuses.add(current.status);
    if (isOnLand({ lat: current.currentLatitude, lng: current.currentLongitude })) {
      landObservations += 1;
    }
  }

  check('V005 (Unauthorized Fishing Boat) reaches APPROACHING',
    demoStatuses.has('WARNING'),
    [...demoStatuses].join(' → ') || 'no V005 status recorded');
  check('V005 reaches INTRUSION', demoStatuses.has('INTRUSION'), [...demoStatuses].join(' → '));

  const newAlerts = (await store.alerts.list()).filter((a) => !chainStart.has(a.alertId));
  const intrusions = newAlerts.filter((a) => a.alertType === 'UNAUTHORIZED_ENTRY');
  check('an unauthorized-entry alert was raised', intrusions.length > 0,
    `${newAlerts.length} new alerts, ${intrusions.length} intrusions`);
  check('the intrusion was raised against the cape exclusion area',
    intrusions.some((a) => a.zoneName === 'Kanyakumari Cape Exclusion Area'),
    intrusions[0]?.zoneName ?? 'none');
  check('the intrusion is CRITICAL severity',
    intrusions.every((a) => a.severity === 'CRITICAL'),
    intrusions.map((a) => a.severity).join(', ') || 'none');

  const approaches = newAlerts.filter((a) => a.alertType === 'ZONE_APPROACH');
  check('an approach warning was raised', approaches.length > 0, `${approaches.length}`);

  const incidents = (await store.incidents.list()).filter((i) => !chainIncidentIds.has(i.incidentId));
  check('an incident was opened', incidents.length > 0,
    `${incidents.length} new incidents (${intrusions.length} intrusions)`);
  check('the incident names the unauthorized contact',
    incidents.some((i) => i.vesselName === 'Unauthorized Fishing Boat'),
    incidents[0]?.title ?? 'none');

  if (intrusions.length) {
    console.log('\n  sample intrusion alert:');
    console.log(`    "${intrusions[0].message}"`);
  }
  if (approaches.length) {
    console.log('  sample approach alert:');
    console.log(`    "${approaches[0].message}"`);
  }
  if (incidents.length) {
    console.log('  sample incident:');
    console.log(`    "${incidents[incidents.length - 1].title}"`);
  }

  await simulationEngine.stop();
  await closeStore();

  console.log('\n══════════════════════════════════════════════════════');
  console.log(failures === 0 ? ' RESULT: PASS — all checks green' : ` RESULT: FAIL — ${failures} check(s) failed`);
  console.log('══════════════════════════════════════════════════════');
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error('verification crashed:', (error as Error).message);
  process.exit(1);
});

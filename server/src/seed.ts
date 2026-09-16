import { closeStore, initStore } from './repositories';
import { logger } from './config/logger';
import { ensureSeed } from './seed-data';
import { authService } from './services/auth.service';
import { getStore } from './repositories';

/**
 * CLI seeder — `npm run seed` (add `--reset` to wipe operational data first).
 *
 * Idempotent by design: each section checks whether its collection is empty
 * before writing, so running it twice never duplicates the demo dataset.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  await initStore();
  logger.info(`seeding against the ${getStore().driver} driver`);

  if (reset) {
    logger.warn('--reset supplied: clearing operational data');
    await getStore().reset(false);
  }

  await authService.ensureDefaults();
  await ensureSeed();

  const [users, vessels, zones, alerts, incidents, tracks] = await Promise.all([
    getStore().users.count(),
    getStore().vessels.count(),
    getStore().zones.count(),
    getStore().alerts.count(),
    getStore().incidents.count(),
    getStore().tracks.count(),
  ]);

  logger.info('───────────────────────────── seed summary ─────────────────────────────');
  logger.info(` users: ${users}   vessels: ${vessels}   zones: ${zones}`);
  logger.info(` alerts: ${alerts}   incidents: ${incidents}   track points: ${tracks}`);
  logger.info('────────────────────────────────────────────────────────────────────────');
  logger.info(' sign in with admin@cidrtm.gov.in / Admin@123');

  await closeStore();
}

void main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(`seed failed: ${(error as Error).message}`);
    process.exit(1);
  });

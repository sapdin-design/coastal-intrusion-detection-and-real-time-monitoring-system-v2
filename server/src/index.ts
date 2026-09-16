import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeStore, initStore } from './repositories';
import { initRealtime } from './realtime/socket';
import { ensureSeed } from './seed-data';
import { authService } from './services/auth.service';
import { simulationEngine } from './services/simulation.service';

/**
 * Process bootstrap.
 *
 * Order matters: the data store must be live before anything touches it, the
 * realtime bus must be attached before the simulator starts emitting, and the
 * HTTP listener only opens once seeding has finished so the first request never
 * races the bootstrap.
 */
async function main(): Promise<void> {
  logger.info('──────────────────────────────────────────────────────');
  logger.info(' CIDRTM — Coastal Intrusion Detection & Monitoring');
  logger.info(` environment: ${env.nodeEnv} | port: ${env.port}`);
  logger.info('──────────────────────────────────────────────────────');

  const store = await initStore();
  logger.info(`data store: ${store.driver}`);

  await authService.ensureDefaults();
  await ensureSeed();

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, () => resolve());
  });

  logger.info(`REST API   → http://localhost:${env.port}/api/v1`);
  logger.info(`Realtime   → ws://localhost:${env.port}/socket.io`);
  logger.info(`Dashboard  → ${env.clientOrigins[0] ?? 'http://localhost:5173'}`);

  await simulationEngine.autostartIfConfigured();

  /* ── graceful shutdown ────────────────────────────────────────────── */

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down`);
    simulationEngine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeStore();
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandled rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (error) => {
    logger.error(`uncaught exception: ${error.message}`, { stack: error.stack });
  });
}

void main().catch((error) => {
  logger.error(`fatal startup error: ${(error as Error).message}`, { stack: (error as Error).stack });
  process.exit(1);
});

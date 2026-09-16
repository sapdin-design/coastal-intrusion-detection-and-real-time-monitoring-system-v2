import { env } from '../config/env';
import { logger } from '../config/logger';
import { MemoryStore } from './memory';
import { MongoStore } from './mongo';
import type { IDataStore } from './types';

/**
 * Driver selection. `MONGODB_URI` present → MongoDB; absent → in-memory.
 * If MongoDB is configured but unreachable we degrade to the in-memory driver
 * instead of crashing, which keeps the demo runnable on any machine.
 */
let store: IDataStore | null = null;

export async function initStore(): Promise<IDataStore> {
  if (store) return store;

  if (env.mongo.uri) {
    const mongo = new MongoStore();
    try {
      await mongo.connect();
      store = mongo;
      return store;
    } catch (error) {
      logger.error(
        `mongodb unavailable (${(error as Error).message}) — falling back to the in-memory repository`,
      );
    }
  }

  const memory = new MemoryStore();
  await memory.connect();
  store = memory;
  return store;
}

export function getStore(): IDataStore {
  if (!store) throw new Error('Data store accessed before initStore()');
  return store;
}

export async function closeStore(): Promise<void> {
  if (!store) return;
  await store.disconnect();
  store = null;
}

export type { IDataStore };

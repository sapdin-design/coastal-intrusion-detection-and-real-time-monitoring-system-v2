import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

/**
 * Loopback hostnames a browser may use for the same local dev server.
 *
 * `http://localhost:5173` and `http://127.0.0.1:5173` are different Origin
 * strings even though they reach the same process, so an allow-list that names
 * only one of them rejects the other with a CORS failure. Rather than make every
 * developer guess which spelling is configured, any loopback origin is expanded
 * to all of its equivalents.
 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

const expandLoopbackAliases = (origin: string): string[] => {
  try {
    const url = new URL(origin);
    if (!(LOOPBACK_HOSTS as readonly string[]).includes(url.hostname)) return [origin];
    const port = url.port ? `:${url.port}` : '';
    return LOOPBACK_HOSTS.map((host) => `${url.protocol}//${host}${port}`);
  } catch {
    // Not a parseable URL — keep it verbatim so a typo fails loudly later.
    return [origin];
  }
};

/** CORS allow-list: the configured origins plus their loopback equivalents. */
const resolveClientOrigins = (): string[] => {
  const configured = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const expanded = new Set<string>();
  for (const origin of configured) {
    for (const alias of expandLoopbackAliases(origin)) expanded.add(alias);
  }
  return [...expanded];
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
  port: num(process.env.PORT, 4000),
  clientOrigins: resolveClientOrigins(),

  jwt: {
    secret: process.env.JWT_SECRET ?? 'cidrtm-development-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),

  /**
   * Shared secret accepted on the telemetry endpoint via the `x-device-key`
   * header. This is the hook a future GNSS/Raspberry Pi node uses to push
   * positions without holding a user session.
   */
  deviceApiKey: process.env.DEVICE_API_KEY ?? 'cidrtm-device-key',

  mongo: {
    /** Empty string => the in-memory repository is used. */
    uri: process.env.MONGODB_URI ?? '',
    dbName: process.env.MONGODB_DB ?? 'cidrtm',
  },

  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** In-memory mode only: mirror the store to disk so restarts keep their data. */
  memoryPersist: bool(process.env.MEMORY_PERSIST, true),

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 2000),
  },

  geofence: {
    approachBufferMeters: num(process.env.GEOFENCE_APPROACH_BUFFER_M, 500),
    alertCooldownMs: num(process.env.GEOFENCE_ALERT_COOLDOWN_MS, 45_000),
    loiterTicks: num(process.env.GEOFENCE_LOITER_TICKS, 6),
  },

  vessel: {
    offlineAfterMs: num(process.env.VESSEL_OFFLINE_AFTER_MS, 45_000),
    trackPointsPerVessel: num(process.env.TRACK_POINTS_PER_VESSEL, 600),
  },

  simulation: {
    tickMs: num(process.env.SIM_TICK_MS, 1000),
    speedMultiplier: num(process.env.SIM_SPEED_MULTIPLIER, 1),
    autostart: bool(process.env.SIM_AUTOSTART, false),
  },
} as const;

export type Env = typeof env;

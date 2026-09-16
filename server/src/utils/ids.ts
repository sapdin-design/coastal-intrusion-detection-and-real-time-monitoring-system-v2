import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

const ID_PREFIXES: Record<string, string> = {
  vessel: 'VSL',
  zone: 'ZON',
  alert: 'ALT',
  incident: 'INC',
  user: 'USR',
  audit: 'AUD',
};

/**
 * Human-readable business identifier, e.g. `VSL-4F2A91`, `ALT-7C01D3`.
 * Kept separate from `_id` so the UI and the REST API speak in stable, readable
 * codes — matching the `vesselId` / `zoneId` / `alertId` fields in the spec.
 */
export function businessId(kind: keyof typeof ID_PREFIXES | string): string {
  const prefix = ID_PREFIXES[kind] ?? String(kind).slice(0, 3).toUpperCase();
  const raw = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefix}-${raw}`;
}

/** Compact incident title, e.g. `INC-9F31A2 · Unauthorized entry`. */
export const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const nowIso = (): string => new Date().toISOString();

export const minutesBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const round = (value: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Moves a value toward a target by at most `maxDelta` — used for smooth physics. */
export const approach = (current: number, target: number, maxDelta: number): number => {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
};

/** Normalises any angle into [0, 360). */
export const normalizeAngle = (deg: number): number => ((deg % 360) + 360) % 360;

/** Shortest signed angular difference from `a` to `b`, in [-180, 180). */
export const angleDelta = (a: number, b: number): number => ((b - a + 540) % 360) - 180;

/* ─────────────────────────── Random helpers ─────────────────────────── */

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);

export const randInt = (min: number, max: number): number => Math.floor(randRange(min, max + 1));

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

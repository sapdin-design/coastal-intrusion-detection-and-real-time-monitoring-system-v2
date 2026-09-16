import { z } from 'zod';
import {
  ALERT_STATUSES,
  ALERT_TYPES,
  AUTHORIZATION_STATUSES,
  INCIDENT_STATUSES,
  SEVERITIES,
  USER_ROLES,
  VESSEL_STATUSES,
  VESSEL_TYPES,
  ZONE_STATUSES,
  ZONE_TYPES,
} from '../types/domain';

/* ─────────────────────────────── Primitives ────────────────────────────── */

const objectId = z.string().min(1, 'Required');
const isoDate = z.string().datetime({ offset: true }).or(z.string().min(1));

export const latLngSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** Accepts `?page=1&limit=50` or `?pageSize=…` and normalises to numbers. */
const pagination = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
};

/* ───────────────────────────────── Auth ───────────────────────────────── */

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  remember: z.boolean().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8, 'Use at least 8 characters'),
  role: z.enum(USER_ROLES),
  active: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

/* ──────────────────────────────── Vessels ─────────────────────────────── */

export const createVesselSchema = z.object({
  name: z.string().min(2).max(80),
  registrationNumber: z.string().min(2).max(40).optional(),
  vesselType: z.enum(VESSEL_TYPES),
  owner: z.string().max(120).optional(),
  authorizationStatus: z.enum(AUTHORIZATION_STATUSES),
  homePort: z.string().max(80).optional(),
  simulated: z.boolean().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  speed: z.coerce.number().min(0).max(120).optional(),
  direction: z.coerce.number().min(0).max(360).optional(),
  notes: z.string().max(500).optional(),
});

export const updateVesselSchema = createVesselSchema.partial();

export const vesselQuerySchema = z.object({
  status: z.enum(VESSEL_STATUSES).optional(),
  authorizationStatus: z.enum(AUTHORIZATION_STATUSES).optional(),
  vesselType: z.enum(VESSEL_TYPES).optional(),
  search: z.string().max(120).optional(),
  ...pagination,
});

/* ───────────────────────────────── Zones ──────────────────────────────── */

export const createZoneSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  zoneType: z.enum(ZONE_TYPES),
  coordinates: z.array(latLngSchema).min(3, 'Draw at least 3 vertices'),
  severity: z.enum(SEVERITIES),
  status: z.enum(ZONE_STATUSES).optional(),
  approachBufferMeters: z.coerce.number().min(50).max(10_000).optional(),
});

export const updateZoneSchema = createZoneSchema.partial();

export const zoneQuerySchema = z.object({
  status: z.enum(ZONE_STATUSES).optional(),
  zoneType: z.enum(ZONE_TYPES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  search: z.string().max(120).optional(),
  ...pagination,
});

/* ─────────────────────────────── Telemetry ────────────────────────────── */

/**
 * The public ingestion contract. A Raspberry Pi with a GNSS module posts exactly
 * this body — see the GNSS bridge snippet in the README. `source` defaults to
 * SIMULATOR so the simulator and a real device can share one endpoint.
 */
export const telemetrySchema = z.object({
  vesselId: z.string().min(1),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  speed: z.coerce.number().min(0).max(200).optional(),
  direction: z.coerce.number().min(0).max(360).optional(),
  recordedAt: isoDate.optional(),
  source: z.enum(['SIMULATOR', 'GNSS_DEVICE', 'MANUAL']).optional(),
});

export const telemetryBatchSchema = z.object({
  updates: z.array(telemetrySchema).min(1).max(500),
});

/* ──────────────────────────────── Alerts ──────────────────────────────── */

export const alertQuerySchema = z.object({
  status: z.union([z.enum(ALERT_STATUSES), z.literal('ACTIVE')]).optional(),
  severity: z.enum(SEVERITIES).optional(),
  alertType: z.enum(ALERT_TYPES).optional(),
  vesselId: z.string().optional(),
  zoneId: z.string().optional(),
  search: z.string().max(120).optional(),
  since: isoDate.optional(),
  ...pagination,
});

export const alertActionSchema = z.object({
  note: z.string().max(500).optional(),
});

/* ─────────────────────────────── Incidents ────────────────────────────── */

export const incidentQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  vesselId: z.string().optional(),
  zoneId: z.string().optional(),
  assignedTo: z.string().optional(),
  search: z.string().max(120).optional(),
  openOnly: z.coerce.boolean().optional(),
  ...pagination,
});

export const incidentTransitionSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  note: z.string().max(500).optional(),
});

export const incidentAssignSchema = z.object({
  assignedTo: z.string().min(2).max(80),
});

/* ─────────────────────────────── Simulation ───────────────────────────── */

export const simulationSpeedSchema = z.object({
  multiplier: z.coerce.number().refine((v) => [1, 2, 5, 10].includes(v), {
    message: 'Speed multiplier must be one of 1, 2, 5 or 10',
  }),
});

export const simulationResetSchema = z.object({
  purgeAlerts: z.boolean().optional(),
});

/* ──────────────────────────────── Analytics ───────────────────────────── */

export const analyticsQuerySchema = z.object({
  hours: z.coerce.number().int().min(6).max(168).optional(),
  days: z.coerce.number().int().min(3).max(90).optional(),
});

export const trackQuerySchema = z.object({
  limit: z.coerce.number().int().min(10).max(2000).optional(),
});

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const idParamSchema = z.object({ id: objectId });

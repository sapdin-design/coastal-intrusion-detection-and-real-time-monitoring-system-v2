import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  Alert,
  AlertSummary,
  AnalyticsSnapshot,
  ApiErrorShape,
  AuditEntry,
  DashboardOverview,
  HealthResponse,
  Incident,
  IncidentStatus,
  IncidentSummary,
  LocationBroadcast,
  PublicUser,
  SeriesPoint,
  SimulationState,
  TrackPoint,
  UserRole,
  Vessel,
  VesselStats,
  VesselSummary,
  Zone,
  ZoneWithStats,
} from '@/types';

/* ───────────────────────────── Token storage ─────────────────────────── */

const TOKEN_KEY = 'cidrtm.token';
const USER_KEY = 'cidrtm.user';

/**
 * "Remember me" writes to localStorage (survives a restart); otherwise the token
 * lives in sessionStorage and dies with the tab. Both are read through the same
 * accessor so the rest of the app never cares which was used.
 */
export const tokenStore = {
  get(): string | null {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  },
  set(token: string, user: PublicUser, remember: boolean): void {
    const store = remember ? localStorage : sessionStorage;
    store.setItem(TOKEN_KEY, token);
    store.setItem(USER_KEY, JSON.stringify(user));
  },
  user(): PublicUser | null {
    const raw = localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicUser;
    } catch {
      return null;
    }
  },
  clear(): void {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(TOKEN_KEY);
      store.removeItem(USER_KEY);
    }
  },
};

/* ────────────────────────────── Error type ───────────────────────────── */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Flattens Zod field errors into a `{ field: message }` map for react-hook-form. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.details ?? []) out[issue.path] = issue.message;
    return out;
  }
}

/* ─────────────────────────────── Client ──────────────────────────────── */

export const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiErrorShape }>) => {
    if (error.response) {
      const { status, data } = error.response;
      const shape = data?.error;
      // An expired session must not leave the UI in a half-authenticated state.
      if (status === 401 && !error.config?.url?.includes('/auth/login')) {
        tokenStore.clear();
        if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
      }
      return Promise.reject(
        new ApiError(
          status,
          shape?.code ?? 'REQUEST_FAILED',
          shape?.message ?? `Request failed with status ${status}`,
          shape?.details,
        ),
      );
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError(408, 'TIMEOUT', 'The server took too long to respond.'));
    }
    return Promise.reject(
      new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the CIDRTM server. Is the backend running?'),
    );
  },
);

/** Unwraps the `{ success, data, meta }` envelope so callers get the payload. */
const unwrap = async <T>(promise: Promise<{ data: { data: T; meta?: unknown } }>): Promise<T> => {
  const response = await promise;
  return response.data.data;
};

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const unwrapList = async <T>(
  promise: Promise<{ data: { data: T[]; meta?: ListMeta } }>,
): Promise<{ rows: T[]; meta: ListMeta }> => {
  const response = await promise;
  return {
    rows: response.data.data,
    meta: response.data.meta ?? { total: response.data.data.length, page: 1, limit: response.data.data.length, pages: 1 },
  };
};

const params = (input: Record<string, unknown>): AxiosRequestConfig => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') query[key] = String(value);
  }
  return { params: query };
};

/* ─────────────────────────────── Endpoints ───────────────────────────── */

export const api = {
  auth: {
    login: (email: string, password: string, remember = false) =>
      unwrap<{ token: string; expiresIn: string; user: PublicUser }>(
        http.post('/auth/login', { email, password, remember }),
      ),
    me: () => unwrap<PublicUser>(http.get('/auth/me')),
    logout: () => unwrap<{ message: string }>(http.post('/auth/logout')),
  },

  users: {
    list: () => unwrap<PublicUser[]>(http.get('/users')),
    create: (body: { name: string; email: string; password: string; role: UserRole; active?: boolean }) =>
      unwrap<PublicUser>(http.post('/users', body)),
    update: (id: string, body: { name?: string; role?: UserRole; active?: boolean; password?: string }) =>
      unwrap<PublicUser>(http.patch(`/users/${id}`, body)),
    remove: (id: string) => unwrap<{ deleted: boolean }>(http.delete(`/users/${id}`)),
  },

  vessels: {
    list: (filters: Record<string, unknown> = {}) =>
      unwrapList<Vessel>(http.get('/vessels', params(filters))),
    summary: () => unwrap<VesselSummary>(http.get('/vessels/summary')),
    get: (id: string) => unwrap<Vessel>(http.get(`/vessels/${id}`)),
    track: (id: string, limit = 300) => unwrap<TrackPoint[]>(http.get(`/vessels/${id}/track`, { params: { limit } })),
    stats: (id: string) => unwrap<VesselStats>(http.get(`/vessels/${id}/stats`)),
    create: (body: Record<string, unknown>) => unwrap<Vessel>(http.post('/vessels', body)),
    update: (id: string, body: Record<string, unknown>) => unwrap<Vessel>(http.patch(`/vessels/${id}`, body)),
    remove: (id: string) => unwrap<{ deleted: boolean }>(http.delete(`/vessels/${id}`)),
  },

  zones: {
    list: (filters: Record<string, unknown> = {}) =>
      unwrapList<ZoneWithStats>(http.get('/zones', params(filters))),
    activity: () => unwrap<ZoneWithStats[]>(http.get('/zones/activity')),
    get: (id: string) => unwrap<Zone>(http.get(`/zones/${id}`)),
    create: (body: Record<string, unknown>) => unwrap<Zone>(http.post('/zones', body)),
    update: (id: string, body: Record<string, unknown>) => unwrap<Zone>(http.patch(`/zones/${id}`, body)),
    toggle: (id: string) => unwrap<Zone>(http.post(`/zones/${id}/toggle`)),
    remove: (id: string) => unwrap<{ deleted: boolean }>(http.delete(`/zones/${id}`)),
  },

  alerts: {
    list: (filters: Record<string, unknown> = {}) => unwrapList<Alert>(http.get('/alerts', params(filters))),
    summary: () => unwrap<AlertSummary>(http.get('/alerts/summary')),
    get: (id: string) => unwrap<Alert>(http.get(`/alerts/${id}`)),
    acknowledge: (id: string, note?: string) => unwrap<Alert>(http.post(`/alerts/${id}/acknowledge`, { note })),
    resolve: (id: string, note?: string) => unwrap<Alert>(http.post(`/alerts/${id}/resolve`, { note })),
  },

  incidents: {
    list: (filters: Record<string, unknown> = {}) =>
      unwrapList<Incident>(http.get('/incidents', params(filters))),
    summary: () => unwrap<IncidentSummary>(http.get('/incidents/summary')),
    get: (id: string) => unwrap<Incident>(http.get(`/incidents/${id}`)),
    transition: (id: string, status: IncidentStatus, note?: string) =>
      unwrap<Incident>(http.patch(`/incidents/${id}/status`, { status, note })),
    assign: (id: string, assignedTo: string) => unwrap<Incident>(http.patch(`/incidents/${id}/assign`, { assignedTo })),
  },

  telemetry: {
    /** The GNSS-facing ingestion endpoint — used by the simulator console's manual injector. */
    push: (body: Record<string, unknown>) => unwrap<unknown>(http.post('/telemetry', body)),
    latest: () => unwrap<Record<string, LocationBroadcast>>(http.get('/telemetry/latest')),
    track: (vesselId: string, limit = 300) =>
      unwrap<TrackPoint[]>(http.get(`/telemetry/tracks/${vesselId}`, { params: { limit } })),
  },

  simulation: {
    state: () => unwrap<SimulationState>(http.get('/simulation/state')),
    start: () => unwrap<SimulationState>(http.post('/simulation/start')),
    pause: () => unwrap<SimulationState>(http.post('/simulation/pause')),
    resume: () => unwrap<SimulationState>(http.post('/simulation/resume')),
    stop: () => unwrap<SimulationState>(http.post('/simulation/stop')),
    step: () => unwrap<SimulationState>(http.post('/simulation/step')),
    speed: (multiplier: number) => unwrap<SimulationState>(http.patch('/simulation/speed', { multiplier })),
    reset: (purgeAlerts = false) => unwrap<SimulationState>(http.post('/simulation/reset', { purgeAlerts })),
  },

  analytics: {
    overview: () => unwrap<DashboardOverview>(http.get('/analytics/overview')),
    full: (hours = 24, days = 7) => unwrap<AnalyticsSnapshot>(http.get('/analytics/full', { params: { hours, days } })),
    hourly: (hours = 24) => unwrap<SeriesPoint[]>(http.get('/analytics/hourly', { params: { hours } })),
    daily: (days = 7) => unwrap<SeriesPoint[]>(http.get('/analytics/daily', { params: { days } })),
    zones: () => unwrap<ZoneWithStats[]>(http.get('/analytics/zones')),
    audit: (limit = 150) => unwrap<AuditEntry[]>(http.get('/analytics/audit', { params: { limit } })),
  },

  health: () => unwrap<HealthResponse>(http.get('/health')),
};

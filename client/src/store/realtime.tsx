import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SOCKET_EVENTS, LIVE_ALERT_BUFFER } from '@/lib/constants';
import { getSocket } from '@/lib/socket';
import { useAuth } from './auth';
import type {
  Alert,
  DashboardOverview,
  Incident,
  IntrusionEvent,
  LocationBroadcast,
  SimulationState,
  Vessel,
  Zone,
} from '@/types';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface RealtimeContextValue {
  connection: ConnectionState;
  /** Latest position frame per vessel — the live map renders straight from this. */
  live: Record<string, LocationBroadcast>;
  /** Full vessel records, refreshed from snapshots and mutation events. */
  vessels: Record<string, Vessel>;
  zones: Record<string, Zone>;
  alerts: Alert[];
  incidents: Incident[];
  simulation: SimulationState | null;
  stats: DashboardOverview | null;
  latestIntrusion: IntrusionEvent | null;
  /** Total intrusions observed in this browser session. */
  sessionIntrusions: number;
  /** Timestamp of the last frame received, used for the "live" heartbeat. */
  lastFrameAt: number | null;
  soundEnabled: boolean;
  setSoundEnabled: (next: boolean) => void;
  dismissIntrusion: () => void;
  /** Applies a locally-known alert change so the UI reacts before the round-trip. */
  patchAlert: (alert: Alert) => void;
  patchIncident: (incident: Incident) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const SOUND_KEY = 'cidrtm.sound';

/** Two-tone alert chime, synthesised so the app ships no audio assets. */
function playAlertTone(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;

    const tone = (frequency: number, start: number, duration: number, gain: number) => {
      const oscillator = ctx.createOscillator();
      const amp = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      amp.gain.setValueAtTime(0, now + start);
      amp.gain.linearRampToValueAtTime(gain, now + start + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(amp).connect(ctx.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration);
    };

    tone(880, 0, 0.18, 0.09);
    tone(1180, 0.2, 0.24, 0.09);
    setTimeout(() => void ctx.close(), 900);
  } catch {
    /* audio is a nicety, never a requirement */
  }
}

/**
 * Realtime hub.
 *
 * Design notes:
 *  - Position frames arrive at roughly 1 Hz per vessel. Writing each frame straight
 *    into React state would re-render the whole tree ~20 times a second, so frames
 *    are buffered in a ref and flushed on a 350 ms cadence. The map still looks
 *    continuous, but the render cost is a fraction of the frame rate.
 *  - Alerts and incidents are kept in bounded ring buffers. An alert storm can
 *    produce hundreds of events a minute and the console only ever shows the tail.
 *  - The provider is transport-only: no component fetches its own socket data.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, token } = useAuth();

  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [live, setLive] = useState<Record<string, LocationBroadcast>>({});
  const [vessels, setVessels] = useState<Record<string, Vessel>>({});
  const [zones, setZones] = useState<Record<string, Zone>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [stats, setStats] = useState<DashboardOverview | null>(null);
  const [latestIntrusion, setLatestIntrusion] = useState<IntrusionEvent | null>(null);
  const [sessionIntrusions, setSessionIntrusions] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(
    () => localStorage.getItem(SOUND_KEY) === 'true',
  );

  const buffer = useRef(new Map<string, LocationBroadcast>());
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  const setSoundEnabled = useCallback((next: boolean) => {
    localStorage.setItem(SOUND_KEY, String(next));
    setSoundEnabledState(next);
  }, []);

  /* ── frame batching: ref → state at a fixed cadence ─────────────────── */

  useEffect(() => {
    const flush = setInterval(() => {
      if (!buffer.current.size) return;
      const batch = buffer.current;
      buffer.current = new Map();
      setLive((prev) => {
        const next = { ...prev };
        for (const [vesselId, frame] of batch) next[vesselId] = frame;
        return next;
      });
      setLastFrameAt(Date.now());
    }, 350);
    return () => clearInterval(flush);
  }, []);

  /* ── socket wiring ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setConnection('idle');
      return;
    }

    const socket = getSocket();
    if (!socket) return;

    setConnection(socket.connected ? 'connected' : 'connecting');

    const onConnect = () => setConnection('connected');
    const onDisconnect = (reason: string) =>
      setConnection(reason === 'io client disconnect' ? 'idle' : 'reconnecting');
    const onConnectError = () => setConnection('error');

    const onSnapshot = (payload: {
      vessels: Vessel[];
      zones: Zone[];
      alerts: Alert[];
      incidents: Incident[];
      simulation: SimulationState;
    }) => {
      setVessels(Object.fromEntries(payload.vessels.map((v) => [v.vesselId, v])));
      setZones(Object.fromEntries(payload.zones.map((z) => [z.zoneId, z])));
      setAlerts(payload.alerts ?? []);
      setIncidents(payload.incidents ?? []);
      setSimulation(payload.simulation ?? null);
      // Seed the live layer so the map is populated before the first frame lands.
      setLive((prev) => {
        const next = { ...prev };
        for (const vessel of payload.vessels) {
          next[vessel.vesselId] = {
            vesselId: vessel.vesselId,
            vesselCode: vessel.vesselCode,
            name: vessel.name,
            latitude: vessel.currentLatitude,
            longitude: vessel.currentLongitude,
            speed: vessel.speed,
            direction: vessel.direction,
            status: vessel.status,
            authorizationStatus: vessel.authorizationStatus,
            vesselType: vessel.vesselType,
            riskScore: vessel.riskScore,
            lastSeen: vessel.lastSeen ?? vessel.updatedAt,
            nearestZone: null,
            nearestDistanceMeters: null,
            state: 'OUTSIDE',
            verdict: 'NORMAL',
          };
        }
        return next;
      });
    };

    const onLocation = (frame: LocationBroadcast) => {
      buffer.current.set(frame.vesselId, frame);
      setVessels((prev) => {
        const existing = prev[frame.vesselId];
        if (!existing) return prev;
        return {
          ...prev,
          [frame.vesselId]: {
            ...existing,
            currentLatitude: frame.latitude,
            currentLongitude: frame.longitude,
            speed: frame.speed,
            direction: frame.direction,
            status: frame.status,
            riskScore: frame.riskScore,
            lastSeen: frame.lastSeen,
          },
        };
      });
    };

    const onStatusChanged = (vessel: Vessel) =>
      setVessels((prev) => ({ ...prev, [vessel.vesselId]: vessel }));

    const onVesselUpsert = (vessel: Vessel) =>
      setVessels((prev) => ({ ...prev, [vessel.vesselId]: vessel }));

    const onVesselDeleted = ({ vesselId }: { vesselId: string }) => {
      setVessels((prev) => {
        const next = { ...prev };
        delete next[vesselId];
        return next;
      });
      setLive((prev) => {
        const next = { ...prev };
        delete next[vesselId];
        return next;
      });
    };

    const onZoneUpsert = (zone: Zone) => setZones((prev) => ({ ...prev, [zone.zoneId]: zone }));
    const onZoneDeleted = ({ zoneId }: { zoneId: string }) =>
      setZones((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });

    const upsertAlert = (alert: Alert) =>
      setAlerts((prev) => {
        const without = prev.filter((a) => a.alertId !== alert.alertId);
        return [alert, ...without].slice(0, LIVE_ALERT_BUFFER);
      });

    const upsertIncident = (incident: Incident) =>
      setIncidents((prev) => {
        const without = prev.filter((i) => i.incidentId !== incident.incidentId);
        return [incident, ...without].slice(0, LIVE_ALERT_BUFFER);
      });

    const onIntrusion = (event: IntrusionEvent) => {
      setLatestIntrusion(event);
      setSessionIntrusions((prev) => prev + 1);
      if (soundRef.current) playAlertTone();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on(SOCKET_EVENTS.SNAPSHOT, onSnapshot);
    socket.on(SOCKET_EVENTS.VESSEL_LOCATION_UPDATED, onLocation);
    socket.on(SOCKET_EVENTS.VESSEL_STATUS_CHANGED, onStatusChanged);
    socket.on(SOCKET_EVENTS.VESSEL_CREATED, onVesselUpsert);
    socket.on(SOCKET_EVENTS.VESSEL_UPDATED, onVesselUpsert);
    socket.on(SOCKET_EVENTS.VESSEL_DELETED, onVesselDeleted);
    socket.on(SOCKET_EVENTS.ZONE_CREATED, onZoneUpsert);
    socket.on(SOCKET_EVENTS.ZONE_UPDATED, onZoneUpsert);
    socket.on(SOCKET_EVENTS.ZONE_DELETED, onZoneDeleted);
    socket.on(SOCKET_EVENTS.ALERT_CREATED, upsertAlert);
    socket.on(SOCKET_EVENTS.ALERT_ACKNOWLEDGED, upsertAlert);
    socket.on(SOCKET_EVENTS.ALERT_RESOLVED, upsertAlert);
    socket.on(SOCKET_EVENTS.INCIDENT_CREATED, upsertIncident);
    socket.on(SOCKET_EVENTS.INCIDENT_UPDATED, upsertIncident);
    socket.on(SOCKET_EVENTS.INTRUSION_DETECTED, onIntrusion);
    socket.on(SOCKET_EVENTS.SIMULATION_STATE, setSimulation);
    socket.on(SOCKET_EVENTS.STATS_UPDATED, setStats);

    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(SOCKET_EVENTS.SNAPSHOT, onSnapshot);
      socket.off(SOCKET_EVENTS.VESSEL_LOCATION_UPDATED, onLocation);
      socket.off(SOCKET_EVENTS.VESSEL_STATUS_CHANGED, onStatusChanged);
      socket.off(SOCKET_EVENTS.VESSEL_CREATED, onVesselUpsert);
      socket.off(SOCKET_EVENTS.VESSEL_UPDATED, onVesselUpsert);
      socket.off(SOCKET_EVENTS.VESSEL_DELETED, onVesselDeleted);
      socket.off(SOCKET_EVENTS.ZONE_CREATED, onZoneUpsert);
      socket.off(SOCKET_EVENTS.ZONE_UPDATED, onZoneUpsert);
      socket.off(SOCKET_EVENTS.ZONE_DELETED, onZoneDeleted);
      socket.off(SOCKET_EVENTS.ALERT_CREATED, upsertAlert);
      socket.off(SOCKET_EVENTS.ALERT_ACKNOWLEDGED, upsertAlert);
      socket.off(SOCKET_EVENTS.ALERT_RESOLVED, upsertAlert);
      socket.off(SOCKET_EVENTS.INCIDENT_CREATED, upsertIncident);
      socket.off(SOCKET_EVENTS.INCIDENT_UPDATED, upsertIncident);
      socket.off(SOCKET_EVENTS.INTRUSION_DETECTED, onIntrusion);
      socket.off(SOCKET_EVENTS.SIMULATION_STATE, setSimulation);
      socket.off(SOCKET_EVENTS.STATS_UPDATED, setStats);
    };
  }, [isAuthenticated, token]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      connection,
      live,
      vessels,
      zones,
      alerts,
      incidents,
      simulation,
      stats,
      latestIntrusion,
      sessionIntrusions,
      lastFrameAt,
      soundEnabled,
      setSoundEnabled,
      dismissIntrusion: () => setLatestIntrusion(null),
      patchAlert: (alert) =>
        setAlerts((prev) => {
          const without = prev.filter((a) => a.alertId !== alert.alertId);
          return [alert, ...without].slice(0, LIVE_ALERT_BUFFER);
        }),
      patchIncident: (incident) =>
        setIncidents((prev) => {
          const without = prev.filter((i) => i.incidentId !== incident.incidentId);
          return [incident, ...without].slice(0, LIVE_ALERT_BUFFER);
        }),
    }),
    [
      connection,
      live,
      vessels,
      zones,
      alerts,
      incidents,
      simulation,
      stats,
      latestIntrusion,
      sessionIntrusions,
      lastFrameAt,
      soundEnabled,
      setSoundEnabled,
    ],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return context;
}

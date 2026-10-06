import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Anchor,
  Check,
  Circle,
  Compass,
  Gauge,
  Hexagon,
  Loader2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Send,
  StepForward,
  Square,
  Waves,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { SIMULATION_SPEEDS } from '@/lib/constants';
import {
  cn,
  formatCoord,
  formatDistance,
  formatHeading,
  formatKnots,
  formatNumber,
  formatSpeed,
  timeAgo,
} from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useRealtime } from '@/store/realtime';
import { useToast } from '@/store/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  SectionLabel,
  Select,
  StatCard,
  Toggle,
} from '@/components/ui';
import type {
  AuthorizationStatus,
  GeofenceState,
  GeofenceVerdict,
  LocationBroadcast,
  SimulationScenario,
  SimulationStatus,
  TimelineStage,
  Vessel,
  VesselStatus,
  VesselType,
} from '@/types';

/**
 * A contact as the console needs it: the registry record merged with the latest
 * live position frame. The registry always has an entry, the frame only arrives
 * once the engine has ticked — so the panel is populated the moment a scenario
 * is staged, without waiting for telemetry.
 */
interface ContactView {
  vesselId: string;
  vesselCode: string;
  name: string;
  vesselType: VesselType;
  latitude: number;
  longitude: number;
  speed: number;
  direction: number;
  status: VesselStatus;
  authorizationStatus: AuthorizationStatus;
  verdict: GeofenceVerdict;
  zoneState: GeofenceState;
  nearestZone: string | null;
  nearestDistanceMeters: number | null;
}

function toContact(vessel: Vessel, frame?: LocationBroadcast): ContactView {
  return {
    vesselId: vessel.vesselId,
    vesselCode: vessel.vesselCode ?? vessel.vesselId,
    name: vessel.name,
    vesselType: vessel.vesselType,
    latitude: frame?.latitude ?? vessel.currentLatitude,
    longitude: frame?.longitude ?? vessel.currentLongitude,
    speed: frame?.speed ?? vessel.speed,
    direction: frame?.direction ?? vessel.direction,
    status: frame?.status ?? vessel.status,
    authorizationStatus: frame?.authorizationStatus ?? vessel.authorizationStatus,
    verdict: frame?.verdict ?? 'NORMAL',
    zoneState: frame?.state ?? 'OUTSIDE',
    nearestZone: frame?.nearestZone ?? null,
    nearestDistanceMeters: frame?.nearestDistanceMeters ?? null,
  };
}

const STATUS_STYLE: Record<SimulationStatus, string> = {
  RUNNING: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  STOPPED: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  IDLE: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
};

const BEHAVIOUR_STYLE: Record<string, string> = {
  INTRUDER: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  PATROL: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  TRANSIT: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
};

const VERDICT_STYLE: Record<string, string> = {
  NORMAL: 'text-slate-600',
  WARNING: 'text-amber-700',
  AUTHORIZED_ENTRY: 'text-emerald-700',
  INTRUSION: 'text-rose-700',
};

/**
 * GPS simulator console.
 *
 * Also doubles as the live demonstration of the ingestion contract: the manual
 * injector posts the exact JSON body a Raspberry Pi with a GNSS module would send,
 * which is the whole point of the "future extension" requirement — the same
 * endpoint, the same pipeline, no changes downstream.
 */
export function SimulationPage() {
  const { simulation, live, vessels, zones, alerts, incidents } = useRealtime();
  const { canOperate, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [purgeOnReset, setPurgeOnReset] = useState(false);
  const [selectedVesselId, setSelectedVesselId] = useState('');
  const [injectVesselId, setInjectVesselId] = useState('');
  const [injectLat, setInjectLat] = useState('8.5000');
  const [injectLng, setInjectLng] = useState('77.5500');
  const [injectSpeed, setInjectSpeed] = useState('12');
  const [injectHeading, setInjectHeading] = useState('90');

  const stateQuery = useQuery({
    queryKey: ['simulation', 'state'],
    queryFn: api.simulation.state,
    refetchInterval: 3000,
  });

  const state = stateQuery.data ?? simulation;
  const routes = stateQuery.data?.routes ?? [];
  const scenarios = stateQuery.data?.scenarios ?? [];
  const contacts = useMemo(
    () => Object.values(vessels).map((vessel) => toContact(vessel, live[vessel.vesselId])),
    [vessels, live],
  );
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.vesselId, contact])),
    [contacts],
  );
  const zoneList = Object.values(zones);

  const scenario = state?.scenario ?? 'MULTI_VESSEL';
  const definition = scenarios.find((entry) => entry.id === scenario);
  const timeline = stateQuery.data?.timeline ?? definition?.timeline ?? [];

  /* Default the contact selector to the scenario's lead — the unauthorized
     contact for the intrusion scenarios, otherwise the first contact on the
     plot. Keeps the panel pointed at the interesting vessel without a click. */
  useEffect(() => {
    if (selectedVesselId && contactById.has(selectedVesselId)) return;
    const lead =
      contacts.find((c) => c.authorizationStatus === 'UNAUTHORIZED') ?? contacts[0];
    if (lead) setSelectedVesselId(lead.vesselId);
  }, [contacts, contactById, selectedVesselId]);

  const selected = contactById.get(selectedVesselId);

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    if (!canOperate) {
      toast.warning('Insufficient permissions', 'Simulator control requires the Operator or Admin role.');
      return;
    }
    setBusy(label);
    try {
      await action();
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ['simulation'] });
    } catch (error) {
      toast.error('Command failed', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stageScenario = async (id: SimulationScenario) => {
    const name = scenarios.find((entry) => entry.id === id)?.name ?? id;
    await run(
      'scenario',
      () => api.simulation.scenario(id),
      `${name} staged — fleet moved to its start line`,
    );
  };

  const inject = async () => {
    if (!injectVesselId) {
      toast.warning('Select a vessel', 'Choose which vessel the position report belongs to.');
      return;
    }
    setBusy('inject');
    try {
      await api.telemetry.push({
        vesselId: injectVesselId,
        latitude: Number(injectLat),
        longitude: Number(injectLng),
        speed: Number(injectSpeed),
        direction: Number(injectHeading),
        source: 'MANUAL',
      });
      toast.success('Position accepted', 'The geofencing engine evaluated it immediately.');
      await queryClient.invalidateQueries({ queryKey: ['simulation'] });
    } catch (error) {
      toast.error('Ingestion rejected', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const isRunning = state?.status === 'RUNNING';
  const isPaused = state?.status === 'PAUSED';

  /* ── Timeline progress, derived from live engine output ──────────────── */

  const underWay = routes.filter((route) => !route.held).length;
  const converging = contacts.filter(
    (c) => c.zoneState === 'APPROACHING' || c.zoneState === 'INSIDE',
  ).length;
  const intrusionAlerts = alerts.filter((a) => a.alertType === 'UNAUTHORIZED_ENTRY');
  const criticalAlert = intrusionAlerts.some((a) => a.severity === 'CRITICAL');
  const leadIncident = incidents.find((incident) => incident.vesselId === selectedVesselId);

  const stageReached = (stage: TimelineStage): boolean => {
    const verdict = selected?.verdict ?? 'NORMAL';
    const zoneState = selected?.zoneState ?? 'OUTSIDE';
    const ticks = state?.ticks ?? 0;

    switch (stage.key) {
      case 'OPEN_SEA':
        return ticks > 0;
      case 'NORMAL':
        return ticks > 2;
      case 'APPROACHING':
        return verdict === 'WARNING' || zoneState === 'APPROACHING' || zoneState === 'INSIDE';
      case 'BOUNDARY':
        return zoneState === 'INSIDE';
      case 'INTRUSION':
        return verdict === 'INTRUSION' || intrusionAlerts.length > 0;
      case 'ALERT':
        return criticalAlert || intrusionAlerts.length > 0;
      case 'INCIDENT':
        return incidents.length > 0 || Boolean(leadIncident);
      case 'PATROL_LOOP':
        return ticks > 30;
      case 'HOLDING':
        return zoneState === 'APPROACHING' && (selected?.speed ?? 99) < 4;
      case 'WITHDRAWAL':
        return zoneState === 'OUTSIDE' && ticks > 30 && verdict === 'NORMAL';
      case 'MULTIPLE_CONTACTS':
        return underWay >= 3;
      case 'CONVERGING':
        return converging >= 2;
      case 'OFFLINE':
        return contacts.some((c) => c.status === 'OFFLINE');
      default:
        return false;
    }
  };

  const firstOpenIndex = timeline.findIndex((stage) => !stageReached(stage));

  return (
    <div className="space-y-4 p-4">
      {/* ══ Status KPIs ═════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Engine status"
          value={<span className={cn('chip text-sm', STATUS_STYLE[state?.status ?? 'IDLE'])}>{state?.status ?? 'IDLE'}</span>}
          hint={state?.lastTickAt ? `Last tick ${timeAgo(state.lastTickAt)}` : 'Not started'}
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard label="Ticks executed" value={formatNumber(state?.ticks ?? 0)} hint={`${state?.ticksPerSecond ?? 1} per second`} icon={<Activity className="h-4 w-4" />} />
        <StatCard
          label="Simulated time"
          value={`${formatNumber(Math.round((state?.elapsedSimSeconds ?? 0) / 60))} min`}
          hint={`${state?.speedMultiplier ?? 1}× compression`}
          icon={<Zap className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard label="Contacts under way" value={formatNumber(underWay)} hint={`${contacts.length} on the plot`} icon={<Anchor className="h-4 w-4" />} />
        <StatCard
          label="Alerts generated"
          value={formatNumber(state?.alertsGenerated ?? 0)}
          hint="This session"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(state?.alertsGenerated ?? 0) > 0 ? 'warning' : 'muted'}
        />
        <StatCard
          label="Intrusions generated"
          value={formatNumber(state?.intrusionsGenerated ?? 0)}
          hint="Confirmed unauthorized entries"
          icon={<Radio className="h-4 w-4" />}
          tone={(state?.intrusionsGenerated ?? 0) > 0 ? 'danger' : 'muted'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ══ Scenario + controls ══════════════════════════════════════ */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Simulation control"
            subtitle="Stage a demonstration scenario, then drive the simulated GNSS feed"
            icon={<Waves className="h-4 w-4" />}
            action={<Badge className={STATUS_STYLE[state?.status ?? 'IDLE']}>{state?.status ?? 'IDLE'}</Badge>}
          />

          <div className="space-y-4 p-4">
            {/* Scenario selector */}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <div>
                <Field label="Scenario">
                  <Select
                    value={scenario}
                    disabled={!canOperate || busy === 'scenario'}
                    onChange={(event) => void stageScenario(event.target.value as SimulationScenario)}
                  >
                    {scenarios.length ? (
                      scenarios.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))
                    ) : (
                      <option value={scenario}>{state?.scenarioName ?? scenario}</option>
                    )}
                  </Select>
                </Field>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  {definition?.summary ??
                    'Staging a scenario moves the participating contacts to the head of their assigned sea lane and clears the geofence memory.'}
                </p>
                {busy === 'scenario' ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-brand-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Staging fleet…
                  </p>
                ) : null}
              </div>

              {/* Timeline */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <SectionLabel className="mb-2">Demonstration timeline</SectionLabel>
                {timeline.length ? (
                  <ol className="space-y-1.5">
                    {timeline.map((stage, index) => {
                      const reached = stageReached(stage);
                      const isNext = index === firstOpenIndex;
                      return (
                        <li key={stage.key} className="flex gap-2.5">
                          <span className="mt-0.5 shrink-0">
                            {reached ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : isNext ? (
                              <span className="block h-3.5 w-3.5 rounded-full border-2 border-brand-500 bg-white" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-slate-300" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block text-[11px] font-semibold',
                                reached ? 'text-slate-800' : isNext ? 'text-brand-700' : 'text-slate-400',
                              )}
                            >
                              {stage.label}
                            </span>
                            <span className="block text-[10px] leading-snug text-slate-500">
                              {stage.detail}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Start the engine to begin the timeline.
                  </p>
                )}
              </div>
            </div>

            {/* Vessel selector + live position */}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <div>
                <Field label="Contact">
                  <Select
                    value={selectedVesselId}
                    onChange={(event) => setSelectedVesselId(event.target.value)}
                  >
                    {contacts.map((contact) => (
                      <option key={contact.vesselId} value={contact.vesselId}>
                        {contact.vesselCode} — {contact.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                  The timeline tracks this contact's own geofence verdict.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <SectionLabel className="mb-2">Current position</SectionLabel>
                {selected ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                    <PositionField label="Latitude" value={formatCoord(selected.latitude, 'lat')} />
                    <PositionField label="Longitude" value={formatCoord(selected.longitude, 'lng')} />
                    <PositionField label="Speed" value={formatKnots(selected.speed)} hint={formatSpeed(selected.speed)} />
                    <PositionField label="Heading" value={formatHeading(selected.direction)} />
                    <PositionField
                      label="Status"
                      value={selected.status}
                      tone={selected.status === 'INTRUSION' ? 'danger' : selected.status === 'WARNING' ? 'warning' : undefined}
                    />
                    <PositionField
                      label="Authorization"
                      value={selected.authorizationStatus}
                      tone={selected.authorizationStatus === 'UNAUTHORIZED' ? 'danger' : 'success'}
                    />
                    <PositionField
                      label="Nearest zone"
                      value={selected.nearestZone ?? 'None in range'}
                      span
                    />
                    <PositionField
                      label="Distance to zone"
                      value={selected.nearestZone ? formatDistance(selected.nearestDistanceMeters) : '—'}
                    />
                    <PositionField
                      label="Verdict"
                      value={selected.verdict.replace(/_/g, ' ')}
                      tone={selected.verdict === 'INTRUSION' ? 'danger' : selected.verdict === 'WARNING' ? 'warning' : undefined}
                    />
                  </dl>
                ) : (
                  <p className="text-[11px] text-slate-500">No contact selected.</p>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <SectionLabel className="mb-2">Transport</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="success"
                  icon={<Play className="h-4 w-4" />}
                  loading={busy === 'start'}
                  disabled={isRunning || !canOperate}
                  onClick={() => void run('start', api.simulation.start, 'Simulation started')}
                >
                  Start
                </Button>
                <Button
                  variant="secondary"
                  icon={<Pause className="h-4 w-4" />}
                  loading={busy === 'pause'}
                  disabled={!isRunning || !canOperate}
                  onClick={() => void run('pause', api.simulation.pause, 'Simulation paused')}
                >
                  Pause
                </Button>
                <Button
                  variant="secondary"
                  icon={<Play className="h-4 w-4" />}
                  loading={busy === 'resume'}
                  disabled={!isPaused || !canOperate}
                  onClick={() => void run('resume', api.simulation.resume, 'Simulation resumed')}
                >
                  Resume
                </Button>
                <Button
                  variant="secondary"
                  icon={<Square className="h-4 w-4" />}
                  loading={busy === 'stop'}
                  disabled={(!isRunning && !isPaused) || !canOperate}
                  onClick={() => void run('stop', api.simulation.stop, 'Simulation stopped')}
                >
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  icon={<StepForward className="h-4 w-4" />}
                  loading={busy === 'step'}
                  disabled={isRunning || !canOperate}
                  onClick={() => void run('step', api.simulation.step, 'Advanced one tick')}
                >
                  Single step
                </Button>
                <Button
                  variant="danger"
                  icon={<RotateCcw className="h-4 w-4" />}
                  disabled={!canOperate}
                  onClick={() => setConfirmReset(true)}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div>
              <SectionLabel className="mb-2">Time compression</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                {SIMULATION_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    disabled={!canOperate}
                    onClick={() => void run('speed', () => api.simulation.speed(speed), `Speed set to ${speed}×`)}
                    className={cn(
                      'rounded-lg border px-4 py-2 text-sm font-semibold transition',
                      state?.speedMultiplier === speed
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-brand-300',
                      !canOperate && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {speed}×
                  </button>
                ))}
                <p className="ml-2 max-w-md text-[11px] leading-relaxed text-slate-500">
                  The multiplier scales <span className="font-medium">simulated time per tick</span>, not the
                  tick rate — the bus always carries about one update per vessel per second, so the map stays
                  smooth at 10×.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat label="Tick interval" value={`${state?.tickMs ?? 1000} ms`} icon={<Gauge className="h-3.5 w-3.5" />} />
              <MiniStat label="Enabled zones" value={String(zoneList.filter((z) => z.status === 'ENABLED').length)} icon={<Hexagon className="h-3.5 w-3.5" />} />
              <MiniStat
                label="Started"
                value={state?.startedAt ? timeAgo(state.startedAt) : '—'}
                icon={<Activity className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        </Card>

        {/* ══ Manual ingestion ═════════════════════════════════════════ */}
        <Card>
          <CardHeader
            title="Manual position injection"
            subtitle="POST /api/v1/telemetry — the GNSS bridge contract"
            icon={<Send className="h-4 w-4" />}
          />
          <div className="space-y-3 p-4">
            <Field label="Vessel">
              <Select value={injectVesselId} onChange={(event) => setInjectVesselId(event.target.value)}>
                <option value="">Select a vessel…</option>
                {contacts.map((contact) => (
                  <option key={contact.vesselId} value={contact.vesselId}>
                    {contact.vesselCode} — {contact.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <Input value={injectLat} onChange={(event) => setInjectLat(event.target.value)} />
              </Field>
              <Field label="Longitude">
                <Input value={injectLng} onChange={(event) => setInjectLng(event.target.value)} />
              </Field>
              <Field label="Speed (km/h)">
                <Input value={injectSpeed} onChange={(event) => setInjectSpeed(event.target.value)} />
              </Field>
              <Field label="Heading (°)">
                <Input value={injectHeading} onChange={(event) => setInjectHeading(event.target.value)} />
              </Field>
            </div>

            <Button
              variant="primary"
              className="w-full"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={busy === 'inject'}
              disabled={!canOperate}
              onClick={() => void inject()}
            >
              Inject position
            </Button>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Equivalent device call
              </p>
              <pre className="mt-1.5 overflow-x-auto text-[10px] leading-relaxed text-slate-600">
{`curl -X POST /api/v1/telemetry \\
  -H "x-device-key: ••••" \\
  -d '{"vesselId":"${injectVesselId || 'VSL-XXXXXX'}",
       "latitude":${injectLat},"longitude":${injectLng},
       "speed":${injectSpeed},"direction":${injectHeading},
       "source":"GNSS_DEVICE"}'`}
              </pre>
            </div>
          </div>
        </Card>
      </div>

      {/* ══ Route assignments ══════════════════════════════════════════ */}
      <Card>
        <CardHeader
          title="Simulated routes"
          subtitle="Behaviour assigned per contact under the active scenario — every lane is a validated offshore sea lane"
          icon={<Compass className="h-4 w-4" />}
        />
        <div className="panel-scroll max-h-[420px]">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Assigned lane</th>
                <th>Behaviour</th>
                <th>Target zone</th>
                <th className="text-right">Speed</th>
                <th className="text-right">Heading</th>
                <th className="text-right">Authorization</th>
              </tr>
            </thead>
            <tbody>
              {routes.length ? (
                routes.map((route) => {
                  const vessel = contactById.get(route.vesselId);
                  const frame = vessel;
                  return (
                    <tr key={route.vesselId} className={cn(route.held && 'opacity-60')}>
                      <td>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-slate-800">
                            <span className="font-mono">{vessel?.vesselCode ?? route.vesselId}</span>
                            {' — '}
                            {vessel?.name ?? 'Unknown contact'}
                          </p>
                          <p className="truncate text-[10px] text-slate-400">
                            {vessel?.vesselType ? vessel.vesselType.replace(/_/g, ' ').toLowerCase() : '—'}
                          </p>
                        </div>
                      </td>
                      <td className="text-xs text-slate-600">
                        {route.held ? (
                          <span className="text-slate-400">Held at berth</span>
                        ) : (
                          <>
                            {route.routeName ?? '—'}
                            {typeof route.waypointIndex === 'number' ? (
                              <span className="ml-1 text-[10px] text-slate-400">
                                leg {route.waypointIndex + 1}
                                {route.waypointCount ? `/${route.waypointCount}` : ''}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {route.held ? (
                          <Badge className="bg-slate-100 text-slate-500">STANDBY</Badge>
                        ) : (
                          <Badge className={BEHAVIOUR_STYLE[route.behavior] ?? 'bg-slate-100 text-slate-600'}>
                            {route.behavior}
                          </Badge>
                        )}
                      </td>
                      <td className="text-xs text-slate-600">
                        {route.targetZoneId
                          ? zoneList.find((z) => z.zoneId === route.targetZoneId)?.name ?? route.targetZoneId
                          : '—'}
                      </td>
                      <td className="tnum text-right text-xs">{formatSpeed(frame?.speed ?? 0)}</td>
                      <td className="tnum text-right text-xs">{Math.round(frame?.direction ?? 0)}°</td>
                      <td className="text-right">
                        <Badge
                          className={
                            vessel?.authorizationStatus === 'AUTHORIZED'
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                              : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                          }
                        >
                          {vessel?.authorizationStatus ?? '—'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                    No routes yet — start the simulation to assign behaviours.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ══ Pipeline explainer ═════════════════════════════════════════ */}
      <Card>
        <CardHeader title="Detection pipeline" subtitle="How a position becomes an incident" icon={<Zap className="h-4 w-4" />} />
        <div className="grid gap-px bg-slate-200 md:grid-cols-5">
          {[
            { step: '1', title: 'GPS simulator', text: 'Generates a position per vessel per tick' },
            { step: '2', title: 'Ingestion API', text: 'POST /api/v1/telemetry validates and persists' },
            { step: '3', title: 'Geofencing engine', text: 'Point-in-polygon + buffer distance per zone' },
            { step: '4', title: 'Alert & incident', text: 'Intrusion raises an alert and opens an incident' },
            { step: '5', title: 'Socket.IO broadcast', text: 'Dashboard updates with no page refresh' },
          ].map((item) => (
            <div key={item.step} className="bg-white p-4">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                {item.step}
              </span>
              <p className="mt-2 text-[13px] font-semibold text-slate-800">{item.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          await run('reset', () => api.simulation.reset(purgeOnReset), purgeOnReset ? 'Simulation and history reset' : 'Simulation reset');
          setConfirmReset(false);
        }}
        title="Reset the simulation?"
        message={
          <div className="space-y-3">
            <p>
              Every participating contact is returned to the head of its assigned sea lane and the geofence
              engine state is cleared. Track history is deleted.
            </p>
            <Toggle
              checked={purgeOnReset}
              onChange={setPurgeOnReset}
              label="Also purge alerts and incidents"
              description={isAdmin ? 'Removes the entire detection history.' : 'Requires the Administrator role.'}
              disabled={!isAdmin}
            />
          </div>
        }
        confirmLabel="Reset simulation"
        loading={busy === 'reset'}
      />
    </div>
  );
}

function PositionField({
  label,
  value,
  hint,
  tone,
  span,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger' | 'warning' | 'success';
  span?: boolean;
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : tone === 'success'
          ? 'text-emerald-700'
          : 'text-slate-800';
  return (
    <div className={cn('min-w-0', span && 'col-span-2 sm:col-span-3')}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={cn('tnum truncate text-[13px] font-semibold', toneClass)}>{value}</dd>
      {hint ? <dd className="text-[10px] text-slate-400">{hint}</dd> : null}
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="tnum mt-1 text-[13px] font-semibold text-slate-800">{value}</p>
    </div>
  );
}

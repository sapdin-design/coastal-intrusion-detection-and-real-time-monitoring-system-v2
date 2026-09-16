import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CircleDot,
  ClipboardList,
  Gauge,
  Hexagon,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Ship,
  Siren,
  TrendingUp,
  Waves,
  WifiOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ALERT_TYPE_LABELS, THREAT_LEVEL_STYLES, ZONE_TYPE_LABELS } from '@/lib/constants';
import {
  cn,
  formatNumber,
  formatUptime,
  severityClasses,
  severityDot,
  timeAgo,
} from '@/lib/format';
import { useRealtime } from '@/store/realtime';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  SectionLabel,
  Skeleton,
  SkeletonCards,
  StatCard,
  StatusDot,
} from '@/components/ui';
import { ActivityTrendChart } from '@/components/charts/TrendCharts';
import { SeverityDonut, VesselTypeChart } from '@/components/charts/DistributionCharts';
import { LiveMap } from '@/components/map/LiveMap';
import { MapLegend } from '@/components/map/MapLegend';
import { VesselDetailPanel } from '@/components/map/VesselDetailPanel';
import { Drawer } from '@/components/ui';

/**
 * Operations dashboard (spec §6.2).
 *
 * Deliberately organised as a single "scan path": posture counters first, then the
 * live map with the alert feed beside it, then trend and distribution analytics, and
 * finally the system health strip. Everything above the fold is realtime; everything
 * below is refreshed on a slower cadence so the page never thrashes.
 */
export function DashboardPage() {
  const { live, zones, alerts, incidents, vessels, stats, connection, lastFrameAt, simulation } =
    useRealtime();
  const [selected, setSelected] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: api.analytics.overview,
    refetchInterval: 15_000,
  });

  const hourly = useQuery({
    queryKey: ['analytics', 'hourly', 24],
    queryFn: () => api.analytics.hourly(24),
    refetchInterval: 60_000,
  });

  const zoneActivity = useQuery({
    queryKey: ['analytics', 'zones'],
    queryFn: api.analytics.zones,
    refetchInterval: 30_000,
  });

  const data = overview.data ?? stats ?? undefined;
  const zoneList = useMemo(() => Object.values(zones), [zones]);
  const frames = live;
  const activeAlerts = useMemo(() => alerts.filter((a) => a.status !== 'RESOLVED').slice(0, 12), [alerts]);
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED').slice(0, 8),
    [incidents],
  );
  const selectedVessel = selected ? vessels[selected] : undefined;

  const vesselTypeData = useMemo(
    () =>
      Object.entries(data?.vessels.byType ?? {}).map(([type, count]) => ({ type, count })),
    [data],
  );

  const threat = data?.threatLevel ?? 'LOW';
  const threatStyle = THREAT_LEVEL_STYLES[threat];
  const streamHealthy = lastFrameAt !== null && Date.now() - lastFrameAt < 5_000;

  if (overview.isLoading && !data) {
    return (
      <div className="space-y-4 p-4">
        <SkeletonCards count={8} className="xl:grid-cols-4" />
        <Skeleton className="h-[520px] w-full rounded-xl" />
      </div>
    );
  }

  if (overview.isError && !data) {
    return (
      <div className="p-6">
        <Card>
          <ErrorState message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* ══ KPI band ════════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total vessels"
          value={formatNumber(data?.vessels.total)}
          hint={`${formatNumber(data?.vessels.authorized)} authorized · ${formatNumber(data?.vessels.unauthorized)} unauthorized`}
          icon={<Ship className="h-4 w-4" />}
        />
        <StatCard
          label="Active contacts"
          value={formatNumber(data?.vessels.active)}
          hint={`Avg speed ${data?.vessels.averageSpeed ?? 0} km/h`}
          icon={<Activity className="h-4 w-4" />}
          tone="positive"
        />
        <StatCard
          label="Under intrusion"
          value={formatNumber(data?.vessels.intrusion)}
          hint={`${formatNumber(data?.vessels.warning)} approaching a zone`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={data?.vessels.intrusion ? 'danger' : 'muted'}
        />
        <StatCard
          label="Active alerts"
          value={formatNumber(data?.alerts.active)}
          hint={`${formatNumber(data?.alerts.new)} unacknowledged`}
          icon={<BellRing className="h-4 w-4" />}
          tone={data?.alerts.new ? 'danger' : 'muted'}
        />
        <StatCard
          label="Intrusions today"
          value={formatNumber(data?.today.intrusions)}
          hint={`${formatNumber(data?.alerts.byType.UNAUTHORIZED_ENTRY ?? 0)} all-time`}
          icon={<Siren className="h-4 w-4" />}
          tone={data?.today.intrusions ? 'warning' : 'muted'}
        />
        <StatCard
          label="Open incidents"
          value={formatNumber((data?.incidents.open ?? 0) + (data?.incidents.acknowledged ?? 0) + (data?.incidents.investigating ?? 0))}
          hint={`${formatNumber(data?.incidents.critical)} critical · MTTR ${data?.incidents.meanTimeToResolveMinutes ?? '—'} min`}
          icon={<ClipboardList className="h-4 w-4" />}
          tone={data?.incidents.critical ? 'danger' : 'muted'}
        />
        <StatCard
          label="Offline vessels"
          value={formatNumber(data?.vessels.offline)}
          hint="Telemetry lost beyond threshold"
          icon={<WifiOff className="h-4 w-4" />}
          tone={data?.vessels.offline ? 'warning' : 'muted'}
        />
        <StatCard
          label="Monitored zones"
          value={formatNumber(data?.zones.total)}
          hint={`${formatNumber(data?.zones.enabled)} enabled · ${data?.zones.areaSqKm ?? 0} km²`}
          icon={<Hexagon className="h-4 w-4" />}
        />
      </div>

      {/* ══ Live map + live feeds ═══════════════════════════════════════ */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="Live vessel map"
            subtitle={`${Object.keys(frames).length} contacts · ${zoneList.length} zones · ${THREAT_LEVEL_STYLES[threat].label}`}
            icon={<Radar className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    'ring-1 ring-inset',
                    streamHealthy
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-amber-50 text-amber-800 ring-amber-200',
                  )}
                >
                  <StatusDot className={streamHealthy ? 'bg-emerald-500' : 'bg-amber-500'} pulse={streamHealthy} />
                  {streamHealthy ? 'Streaming' : connection}
                </Badge>
                <Link to="/map" className="btn btn-secondary btn-xs">
                  Open full map
                </Link>
              </div>
            }
          />
          <div className="relative h-[460px]">
            <LiveMap
              frames={frames}
              zones={zoneList}
              selectedVesselId={selected}
              onSelectVessel={setSelected}
              showTracks={false}
              className="h-full w-full"
              overlay={
                <>
                  <div className="pointer-events-none absolute right-3 top-3 z-[500]">
                    <MapLegend compact />
                  </div>
                  <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-raised backdrop-blur">
                    <SectionLabel>Threat posture</SectionLabel>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn('legend-dot', threatStyle.dot)} />
                      <span className="text-sm font-semibold text-slate-800">
                        {threatStyle.label.replace('Threat Level: ', '')}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {data?.zones.critical ?? 0} critical zones · {data?.vessels.intrusion ?? 0} contacts inside
                    </p>
                  </div>
                  {!Object.keys(frames).length ? (
                    <div className="absolute inset-0 z-[400] grid place-items-center bg-white/70 backdrop-blur-[1px]">
                      <div className="max-w-xs text-center">
                        <Siren className="mx-auto h-6 w-6 text-slate-400" />
                        <p className="mt-2 text-sm font-semibold text-slate-700">No telemetry yet</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Start the GPS simulator to begin receiving vessel positions.
                        </p>
                        <Link to="/simulation" className="btn btn-primary btn-sm mt-3">
                          Open simulator
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </>
              }
            />
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {/* ── active alerts ─────────────────────────────────────────── */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader
              title="Active alerts"
              subtitle={`${alerts.filter((a) => a.status === 'NEW').length} awaiting acknowledgement`}
              icon={<BellRing className="h-4 w-4" />}
              action={
                <Link to="/alerts" className="btn btn-ghost btn-xs">
                  View all
                </Link>
              }
            />
            <div className="panel-scroll max-h-[300px] flex-1">
              {activeAlerts.length ? (
                <ul className="divide-y divide-slate-100">
                  {activeAlerts.map((alert) => (
                    <li key={alert.alertId} className="px-4 py-2.5 transition-colors hover:bg-slate-50">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            severityDot[alert.severity],
                            alert.status === 'NEW' && 'animate-pulse',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold text-slate-800">
                              {ALERT_TYPE_LABELS[alert.alertType]}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {timeAgo(alert.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                            {alert.message}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Badge className={severityClasses[alert.severity]}>{alert.severity}</Badge>
                            {alert.status === 'NEW' ? (
                              <Badge className="bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200">
                                New
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No active alerts"
                  description="Every detection has been acknowledged or resolved."
                  icon={<ShieldCheck className="h-5 w-5" />}
                />
              )}
            </div>
          </Card>

          {/* ── recent incidents ──────────────────────────────────────── */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader
              title="Recent incidents"
              subtitle={`${incidents.length} on the board`}
              icon={<ClipboardList className="h-4 w-4" />}
              action={
                <Link to="/incidents" className="btn btn-ghost btn-xs">
                  Open board
                </Link>
              }
            />
            <div className="panel-scroll max-h-[260px] flex-1">
              {openIncidents.length ? (
                <ul className="divide-y divide-slate-100">
                  {openIncidents.map((incident) => (
                    <li key={incident.incidentId} className="px-4 py-2.5 transition-colors hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px] text-slate-400">
                          {incident.incidentId}
                        </span>
                        <Badge className={severityClasses[incident.severity]}>{incident.severity}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-slate-700">
                        {incident.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="truncate">{incident.vesselName}</span>
                        <span>{timeAgo(incident.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No open incidents"
                  description="Confirmed intrusions will appear here automatically."
                  icon={<ClipboardList className="h-5 w-5" />}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ══ Trends and distributions ════════════════════════════════════ */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Intrusion activity — last 24 hours"
            subtitle="Confirmed intrusions, zone approaches and incidents opened per hour"
            icon={<TrendingUp className="h-4 w-4" />}
            action={
              <Badge className="bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200">
                {hourly.data?.reduce((sum, point) => sum + point.intrusions, 0) ?? 0} intrusions
              </Badge>
            }
          />
          <div className="px-3 py-3">
            {hourly.isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : hourly.isError ? (
              <ErrorState message={(hourly.error as Error).message} onRetry={() => void hourly.refetch()} />
            ) : (
              <ActivityTrendChart data={hourly.data ?? []} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Alert severity mix"
            subtitle="Distribution across the whole log"
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <div className="px-3 py-3">
            {data ? (
              <SeverityDonut
                data={(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => ({
                  severity,
                  count: data.alerts.bySeverity[severity] ?? 0,
                }))}
              />
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
          </div>
        </Card>
      </div>

      {/* ══ Zone activity, fleet mix, system status ═════════════════════ */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Zone activity"
            subtitle="Alerts, intrusions and contacts per monitored zone"
            icon={<Hexagon className="h-4 w-4" />}
          />
          <div className="panel-scroll max-h-[320px]">
            {zoneActivity.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Type</th>
                    <th className="text-center">Severity</th>
                    <th className="text-right">Contacts</th>
                    <th className="text-right">Alerts</th>
                    <th className="text-right">Intrusions</th>
                  </tr>
                </thead>
                <tbody>
                  {(zoneActivity.data ?? []).map((zone) => (
                    <tr key={zone.zoneId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <StatusDot
                            className={zone.status === 'ENABLED' ? 'bg-emerald-500' : 'bg-slate-400'}
                          />
                          <span className="max-w-[200px] truncate font-medium text-slate-800">
                            {zone.name}
                          </span>
                        </div>
                      </td>
                      <td className="text-xs text-slate-500">{ZONE_TYPE_LABELS[zone.zoneType]}</td>
                      <td className="text-center">
                        <Badge className={severityClasses[zone.severity]}>{zone.severity}</Badge>
                      </td>
                      <td className="tnum text-right">{zone.vesselCount ?? 0}</td>
                      <td className="tnum text-right">{zone.alertCount ?? 0}</td>
                      <td className="tnum text-right">
                        <span
                          className={cn(
                            'font-semibold',
                            (zone.intrusionCount ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400',
                          )}
                        >
                          {zone.intrusionCount ?? 0}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Fleet composition" subtitle="Registered vessels by type" icon={<Ship className="h-4 w-4" />} />
          <div className="px-3 py-3">
            {vesselTypeData.length ? (
              <VesselTypeChart data={vesselTypeData} />
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-3">
            <SectionLabel className="mb-2">Authorization split</SectionLabel>
            <div className="space-y-2">
              <SplitBar
                label="Authorized"
                value={data?.vessels.authorized ?? 0}
                total={data?.vessels.total ?? 1}
                className="bg-emerald-500"
              />
              <SplitBar
                label="Unauthorized"
                value={data?.vessels.unauthorized ?? 0}
                total={data?.vessels.total ?? 1}
                className="bg-rose-500"
              />
            </div>
          </div>
        </Card>
      </div>

      {/* ══ System status ═══════════════════════════════════════════════ */}
      <Card>
        <CardHeader
          title="System status"
          subtitle="Backend, realtime bus and simulation engine"
          icon={<Gauge className="h-4 w-4" />}
          action={
            <Badge
              className={cn(
                'ring-1 ring-inset',
                connection === 'connected'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200',
              )}
            >
              <StatusDot className={connection === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'} />
              {connection}
            </Badge>
          }
        />
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCell label="Data driver" value={data ? 'Connected' : '—'} hint="Repository layer" icon={<CircleDot className="h-3.5 w-3.5" />} />
          <StatusCell
            label="Simulation"
            value={simulation?.status ?? 'IDLE'}
            hint={simulation ? `${simulation.speedMultiplier}× · ${formatNumber(simulation.ticks)} ticks` : 'Not started'}
            icon={<Waves className="h-3.5 w-3.5" />}
          />
          <StatusCell
            label="Geofence evaluations"
            value={formatNumber(Object.keys(frames).length * zoneList.length)}
            hint={`${zoneList.length} zones × ${Object.keys(frames).length} contacts`}
            icon={<Hexagon className="h-3.5 w-3.5" />}
          />
          <StatusCell
            label="Last frame"
            value={lastFrameAt ? timeAgo(new Date(lastFrameAt).toISOString()) : '—'}
            hint={`Uptime ${data?.generatedAt ? formatUptime(Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 1000)) : '—'}`}
            icon={<Activity className="h-3.5 w-3.5" />}
          />
        </div>
      </Card>

      {/* ══ Vessel drawer ═══════════════════════════════════════════════ */}
      <Drawer
        open={Boolean(selected && frames[selected])}
        onClose={() => setSelected(null)}
        title={selected ? frames[selected]?.name ?? 'Vessel' : 'Vessel'}
        subtitle={selected ? <span className="font-mono">{selected}</span> : null}
        width="sm"
      >
        {selected && frames[selected] ? (
          <VesselDetailPanel
            frame={frames[selected]}
            vessel={selectedVessel}
            alerts={alerts.filter((a) => a.vesselId === selected)}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function SplitBar({
  label,
  value,
  total,
  className,
}: {
  label: string;
  value: number;
  total: number;
  className: string;
}) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-600">{label}</span>
        <span className="tnum font-semibold text-slate-700">
          {value} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className={cn('h-full rounded-full transition-[width] duration-500', className)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusCell({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-slate-800">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

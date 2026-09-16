import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  FileSpreadsheet,
  Gauge,
  Hexagon,
  Printer,
  ShieldAlert,
  Ship,
  Target,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ZONE_TYPE_LABELS } from '@/lib/constants';
import {
  cn,
  downloadFile,
  formatDuration,
  formatNumber,
  formatUptime,
  severityClasses,
  timeAgo,
  toCsv,
  vesselStatusClasses,
} from '@/lib/format';
import { useToast } from '@/store/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Skeleton,
  StatCard,
  Tabs,
  type Column,
} from '@/components/ui';
import { ActivityTrendChart, DailyTrendChart } from '@/components/charts/TrendCharts';
import {
  AlertTypeChart,
  RateGauge,
  SeverityDonut,
  VesselTypeChart,
} from '@/components/charts/DistributionCharts';
import type { AuditEntry, VesselStatus, ZoneWithStats } from '@/types';

type RangeKey = '6h' | '24h' | '72h' | '7d';

const RANGE_HOURS: Record<RangeKey, { hours: number; days: number; label: string }> = {
  '6h': { hours: 6, days: 3, label: 'Last 6 hours' },
  '24h': { hours: 24, days: 7, label: 'Last 24 hours' },
  '72h': { hours: 72, days: 14, label: 'Last 3 days' },
  '7d': { hours: 168, days: 30, label: 'Last 7 days' },
};

/**
 * Analytics and reporting (spec §6.2 — analytics section).
 *
 * One request hydrates the page: the server aggregates alerts, incidents, zones and
 * response metrics together, which keeps the charts mutually consistent instead of
 * being sampled at slightly different moments.
 */
export function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('24h');
  const [tab, setTab] = useState<'trends' | 'zones' | 'vessels' | 'audit'>('trends');
  const toast = useToast();

  const { hours, days, label } = RANGE_HOURS[range];

  const analytics = useQuery({
    queryKey: ['analytics', 'full', hours, days],
    queryFn: () => api.analytics.full(hours, days),
    refetchInterval: 30_000,
  });

  const audit = useQuery({
    queryKey: ['analytics', 'audit'],
    queryFn: () => api.analytics.audit(200),
    refetchInterval: 30_000,
    enabled: tab === 'audit',
  });

  const data = analytics.data;

  const exportSnapshot = () => {
    if (!data) return;
    downloadFile(
      `cidrtm-analytics-${range}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
    );
    toast.success('Report exported', 'Full analytics snapshot written to JSON.');
  };

  const exportZones = () => {
    if (!data) return;
    downloadFile(
      `cidrtm-zone-activity-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        data.zoneActivity.map((zone) => ({
          zoneId: zone.zoneId,
          name: zone.name,
          type: zone.zoneType,
          severity: zone.severity,
          status: zone.status,
          areaSqKm: zone.areaSqKm,
          contacts: zone.vesselCount ?? 0,
          alerts: zone.alertCount ?? 0,
          intrusions: zone.intrusionCount ?? 0,
        })),
      ),
      'text/csv',
    );
    toast.success('Zone report exported', 'Zone activity written to CSV.');
  };

  const zoneColumns: Array<Column<ZoneWithStats>> = [
    {
      key: 'name',
      header: 'Zone',
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-800">{row.name}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{row.zoneId}</p>
        </div>
      ),
    },
    {
      key: 'zoneType',
      header: 'Type',
      sortValue: (row) => row.zoneType,
      render: (row) => <span className="text-xs text-slate-600">{ZONE_TYPE_LABELS[row.zoneType]}</span>,
    },
    {
      key: 'severity',
      header: 'Severity',
      width: '110px',
      align: 'center',
      sortValue: (row) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[row.severity],
      render: (row) => <Badge className={severityClasses[row.severity]}>{row.severity}</Badge>,
    },
    {
      key: 'areaSqKm',
      header: 'Area (km²)',
      align: 'right',
      sortValue: (row) => row.areaSqKm,
      render: (row) => <span className="tnum text-xs">{row.areaSqKm}</span>,
    },
    {
      key: 'vesselCount',
      header: 'Contacts',
      align: 'right',
      sortValue: (row) => row.vesselCount ?? 0,
      render: (row) => <span className="tnum text-xs">{row.vesselCount ?? 0}</span>,
    },
    {
      key: 'alertCount',
      header: 'Alerts',
      align: 'right',
      sortValue: (row) => row.alertCount ?? 0,
      render: (row) => <span className="tnum text-xs">{row.alertCount ?? 0}</span>,
    },
    {
      key: 'intrusionCount',
      header: 'Intrusions',
      align: 'right',
      sortValue: (row) => row.intrusionCount ?? 0,
      render: (row) => (
        <span
          className={cn('tnum text-xs font-semibold', (row.intrusionCount ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400')}
        >
          {row.intrusionCount ?? 0}
        </span>
      ),
    },
  ];

  const auditColumns: Array<Column<AuditEntry>> = [
    {
      key: 'createdAt',
      header: 'When',
      width: '150px',
      sortValue: (row) => row.createdAt,
      render: (row) => (
        <div>
          <p className="text-xs text-slate-600">{timeAgo(row.createdAt)}</p>
          <p className="text-[10px] text-slate-400">{new Date(row.createdAt).toLocaleString('en-GB')}</p>
        </div>
      ),
    },
    {
      key: 'actorName',
      header: 'Actor',
      width: '140px',
      sortValue: (row) => row.actorName,
      render: (row) => <span className="text-[13px] font-medium text-slate-700">{row.actorName}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      width: '130px',
      sortValue: (row) => row.action,
      render: (row) => (
        <Badge className="bg-slate-100 font-mono text-[10px] text-slate-600 ring-1 ring-inset ring-slate-200">
          {row.action}
        </Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      width: '130px',
      sortValue: (row) => row.entity,
      render: (row) => (
        <div>
          <p className="text-xs text-slate-600">{row.entity}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{row.entityId}</p>
        </div>
      ),
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (row) => <p className="line-clamp-2 text-xs text-slate-600">{row.detail}</p>,
    },
  ];

  if (analytics.isLoading && !data) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  if (analytics.isError && !data) {
    return (
      <div className="p-6">
        <Card>
          <ErrorState message={(analytics.error as Error).message} onRetry={() => void analytics.refetch()} />
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const totalIntrusions = data.hourly.reduce((sum, point) => sum + point.intrusions, 0);
  const totalApproaches = data.hourly.reduce((sum, point) => sum + point.approaches, 0);

  return (
    <div className="space-y-4 p-4">
      {/* ══ Range + export ══════════════════════════════════════════════ */}
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Reporting window</p>
            <p className="text-[11px] text-slate-500">{label} · refreshed every 30 s</p>
          </div>
        </div>

        <SegmentedControl
          value={range}
          onChange={setRange}
          className="ml-2"
          options={[
            { value: '6h', label: '6 h' },
            { value: '24h', label: '24 h' },
            { value: '72h', label: '3 d' },
            { value: '7d', label: '7 d' },
          ]}
        />

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()} className="no-print">
            Print
          </Button>
          <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={exportZones}>
            Zone CSV
          </Button>
          <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSnapshot}>
            Export report
          </Button>
        </div>
      </Card>

      {/* ══ KPIs ════════════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Confirmed intrusions"
          value={formatNumber(totalIntrusions)}
          hint={`${formatNumber(totalApproaches)} approaches`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={totalIntrusions ? 'danger' : 'muted'}
        />
        <StatCard
          label="Alerts raised"
          value={formatNumber(data.hourly.reduce((s, p) => s + p.intrusions + p.approaches + p.otherAlerts, 0))}
          hint={`${formatNumber(data.overview.alerts.resolved)} resolved all-time`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Incidents opened"
          value={formatNumber(data.hourly.reduce((s, p) => s + p.incidents, 0))}
          hint={`${formatNumber(data.overview.incidents.total)} lifetime`}
          icon={<Target className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Mean time to acknowledge"
          value={formatDuration(data.response.meanTimeToAcknowledgeMinutes)}
          hint={`${data.response.acknowledgementRate}% acknowledged`}
          icon={<Timer className="h-4 w-4" />}
        />
        <StatCard
          label="Mean time to resolve"
          value={formatDuration(data.response.meanTimeToResolveMinutes)}
          hint={`${data.response.resolutionRate}% resolved`}
          icon={<Clock className="h-4 w-4" />}
          tone="positive"
        />
        <StatCard
          label="Zone coverage"
          value={`${formatNumber(data.overview.zones.areaSqKm, 1)} km²`}
          hint={`${data.overview.zones.enabled} of ${data.overview.zones.total} enforced`}
          icon={<Hexagon className="h-4 w-4" />}
        />
      </div>

      {/* ══ Tabs ════════════════════════════════════════════════════════ */}
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trends', label: 'Trends & distributions' },
          { value: 'zones', label: 'Zone performance' },
          { value: 'vessels', label: 'Fleet risk' },
          { value: 'audit', label: 'Operator activity' },
        ]}
      />

      {/* ── trends ───────────────────────────────────────────────────── */}
      {tab === 'trends' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Detection activity — ${label.toLowerCase()}`}
              subtitle="Confirmed intrusions are the filled area; approaches and incidents are overlaid"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <div className="px-3 py-3">
              <ActivityTrendChart data={data.hourly} height={300} />
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Daily volume" subtitle="Alert and incident counts per day" icon={<BarChart3 className="h-4 w-4" />} />
              <div className="px-3 py-3">
                <DailyTrendChart data={data.daily} height={260} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Severity mix" subtitle="All alerts in the log" icon={<ShieldAlert className="h-4 w-4" />} />
              <div className="px-3 py-3">
                <SeverityDonut data={data.severityDistribution} height={260} />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Detection types" subtitle="Volume per alert category" icon={<Activity className="h-4 w-4" />} />
              <div className="px-3 py-3">
                <AlertTypeChart data={data.alertTypeDistribution} height={240} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Response performance" subtitle="Acknowledgement and resolution rates" icon={<Gauge className="h-4 w-4" />} />
              <div className="grid grid-cols-2 gap-2 px-3 py-3">
                <RateGauge value={data.response.acknowledgementRate} label="Acknowledged" color="#0d9488" />
                <RateGauge value={data.response.resolutionRate} label="Resolved" color="#1d5a92" />
              </div>
              <div className="border-t border-slate-200 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
                Rates are computed across the entire alert log, not just the reporting window, so they remain
                meaningful when the window is short.
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ── zones ────────────────────────────────────────────────────── */}
      {tab === 'zones' ? (
        <Card>
          <CardHeader
            title="Zone performance"
            subtitle="Enforcement outcomes per monitored polygon"
            icon={<Hexagon className="h-4 w-4" />}
          />
          <DataTable
            columns={zoneColumns}
            rows={data.zoneActivity}
            rowKey={(row) => row.zoneId}
            initialSortKey="intrusionCount"
            maxHeight="560px"
            emptyTitle="No zones configured"
            emptyDescription="Draw a polygon on the Restricted Zones page to begin enforcement."
          />
        </Card>
      ) : null}

      {/* ── fleet risk ───────────────────────────────────────────────── */}
      {tab === 'vessels' ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Highest risk contacts"
              subtitle="Ranked by composite risk score — intrusions and approaches raise it, clean transit decays it"
              icon={<ShieldAlert className="h-4 w-4" />}
            />
            <div className="panel-scroll max-h-[420px]">
              {data.topRiskVessels.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vessel</th>
                      <th>Type</th>
                      <th className="text-center">Authorization</th>
                      <th className="text-center">Status</th>
                      <th className="text-right">Risk score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topRiskVessels.map((vessel) => (
                      <tr key={vessel.vesselId}>
                        <td>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-slate-800">{vessel.name}</p>
                            <p className="truncate font-mono text-[10px] text-slate-400">{vessel.vesselId}</p>
                          </div>
                        </td>
                        <td className="text-xs text-slate-600">{vessel.vesselType.replace(/_/g, ' ')}</td>
                        <td className="text-center">
                          <Badge
                            className={
                              vessel.authorizationStatus === 'AUTHORIZED'
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                                : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                            }
                          >
                            {vessel.authorizationStatus}
                          </Badge>
                        </td>
                        <td className="text-center">
                          <Badge className={vesselStatusClasses[vessel.status as VesselStatus]}>
                            {vessel.status}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="tnum text-xs font-semibold text-slate-700">{vessel.riskScore}</span>
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  vessel.riskScore >= 70
                                    ? 'bg-rose-500'
                                    : vessel.riskScore >= 40
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500',
                                )}
                                style={{ width: `${vessel.riskScore}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="No vessel data" description="Register vessels to build a risk picture." icon={<Ship className="h-5 w-5" />} />
              )}
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Fleet composition" subtitle="Registered vessels by type" icon={<Ship className="h-4 w-4" />} />
              <div className="px-3 py-3">
                <VesselTypeChart data={data.vesselTypeDistribution} height={220} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Authorization split" subtitle="Permit status across the fleet" icon={<Users className="h-4 w-4" />} />
              <div className="space-y-3 px-4 py-3">
                {data.authorizationSplit.map((entry) => {
                  const total = data.authorizationSplit.reduce((sum, item) => sum + item.value, 0) || 1;
                  const pct = (entry.value / total) * 100;
                  return (
                    <div key={entry.name}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">{entry.name}</span>
                        <span className="tnum font-semibold text-slate-700">
                          {entry.value} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            entry.name === 'Authorized' ? 'bg-emerald-500' : 'bg-rose-500',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ── audit ────────────────────────────────────────────────────── */}
      {tab === 'audit' ? (
        <Card>
          <CardHeader
            title="Operator activity log"
            subtitle="Every state-changing action, newest first"
            icon={<Users className="h-4 w-4" />}
            action={
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5" />}
                disabled={!audit.data?.length}
                onClick={() => {
                  if (!audit.data) return;
                  downloadFile(
                    `cidrtm-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                    toCsv(
                      audit.data.map((entry) => ({
                        at: entry.createdAt,
                        actor: entry.actorName,
                        action: entry.action,
                        entity: entry.entity,
                        entityId: entry.entityId,
                        detail: entry.detail,
                        ip: entry.ip,
                      })),
                    ),
                    'text/csv',
                  );
                  toast.success('Audit log exported');
                }}
              >
                Export
              </Button>
            }
          />
          <DataTable
            columns={auditColumns}
            rows={audit.data ?? []}
            rowKey={(row) => row._id}
            loading={audit.isLoading}
            initialSortKey="createdAt"
            maxHeight="600px"
            emptyTitle="No activity recorded yet"
            emptyDescription="Sign-ins, zone edits, alert acknowledgements and simulator commands all appear here."
          />
        </Card>
      ) : null}

      {/* ══ System footer ═══════════════════════════════════════════════ */}
      <Card>
        <CardHeader title="System information" subtitle="Backend runtime captured with this report" icon={<Gauge className="h-4 w-4" />} />
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCell label="Data driver" value={data.system.driver} hint={`${data.system.collections} collections · ${formatNumber(data.system.documents)} documents`} />
          <InfoCell label="Node runtime" value={data.system.nodeVersion} hint={`Heap ${data.system.memoryMb} MB`} />
          <InfoCell label="Process uptime" value={formatUptime(data.system.uptimeSeconds)} hint={`Geofence pairs cached: ${data.system.geofencePairs}`} />
          <InfoCell
            label="Simulation"
            value={data.system.simulation.status}
            hint={`${data.system.simulation.speedMultiplier}× · ${formatNumber(data.system.simulation.ticks)} ticks`}
          />
        </div>
      </Card>
    </div>
  );
}

function InfoCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

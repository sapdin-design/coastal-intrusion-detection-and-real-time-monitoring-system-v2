import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCheck,
  Download,
  Filter,
  Hexagon,
  Radio,
  ShieldAlert,
  Ship,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ALERT_TYPE_LABELS } from '@/lib/constants';
import {
  alertStatusClasses,
  cn,
  downloadFile,
  formatDateTime,
  severityClasses,
  severityDot,
  timeAgo,
  toCsv,
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
  DataTable,
  Drawer,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  type Column,
} from '@/components/ui';
import type { Alert, AlertType, Severity } from '@/types';

type StatusTab = 'ACTIVE' | 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ALL';

/**
 * Alert console (spec §13).
 *
 * The alert list is read from the realtime store rather than polled, so a detection
 * lands in this table the instant the geofencing engine raises it. Filters and
 * sorting are client-side because the working set is the recent tail — which is
 * precisely what an operator triages.
 */
export function AlertsPage() {
  const { alerts, patchAlert } = useRealtime();
  const { canOperate } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<StatusTab>('ACTIVE');
  const [severity, setSeverity] = useState<Severity | 'ALL'>('ALL');
  const [type, setType] = useState<AlertType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const summary = useQuery({
    queryKey: ['alerts', 'summary'],
    queryFn: api.alerts.summary,
    refetchInterval: 20_000,
  });

  const counts = useMemo(() => {
    const base = { ACTIVE: 0, NEW: 0, ACKNOWLEDGED: 0, RESOLVED: 0, ALL: alerts.length };
    for (const alert of alerts) {
      if (alert.status !== 'RESOLVED') base.ACTIVE += 1;
      base[alert.status] += 1;
    }
    return base;
  }, [alerts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return alerts
      .filter((alert) => {
        if (tab === 'ACTIVE' && alert.status === 'RESOLVED') return false;
        if (tab !== 'ACTIVE' && tab !== 'ALL' && alert.status !== tab) return false;
        if (severity !== 'ALL' && alert.severity !== severity) return false;
        if (type !== 'ALL' && alert.alertType !== type) return false;
        if (needle) {
          return (
            alert.message.toLowerCase().includes(needle) ||
            alert.vesselName.toLowerCase().includes(needle) ||
            alert.vesselId.toLowerCase().includes(needle) ||
            alert.alertId.toLowerCase().includes(needle) ||
            (alert.zoneName ?? '').toLowerCase().includes(needle)
          );
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [alerts, tab, severity, type, search]);

  const act = async (alert: Alert, action: 'acknowledge' | 'resolve') => {
    if (!canOperate) {
      toast.warning('Insufficient permissions', 'Acknowledging alerts requires the Operator or Admin role.');
      return;
    }
    setBusy(true);
    try {
      const updated =
        action === 'acknowledge'
          ? await api.alerts.acknowledge(alert.alertId)
          : await api.alerts.resolve(alert.alertId);
      patchAlert(updated);
      setSelected((prev) => (prev?.alertId === updated.alertId ? updated : prev));
      toast.success(
        action === 'acknowledge' ? 'Alert acknowledged' : 'Alert resolved',
        `${alert.alertId} · ${ALERT_TYPE_LABELS[alert.alertType]}`,
      );
      void summary.refetch();
    } catch (error) {
      toast.error('Action failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const acknowledgeAllNew = async () => {
    const pending = alerts.filter((alert) => alert.status === 'NEW');
    setBusy(true);
    let done = 0;
    for (const alert of pending) {
      try {
        patchAlert(await api.alerts.acknowledge(alert.alertId));
        done += 1;
      } catch {
        /* keep going: one failure must not abort the sweep */
      }
    }
    setBusy(false);
    setBulkConfirm(false);
    toast.success(`${done} alert${done === 1 ? '' : 's'} acknowledged`);
    void summary.refetch();
  };

  const exportCsv = () => {
    downloadFile(
      `cidrtm-alerts-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        filtered.map((alert) => ({
          alertId: alert.alertId,
          severity: alert.severity,
          type: alert.alertType,
          vesselId: alert.vesselId,
          vesselName: alert.vesselName,
          zone: alert.zoneName ?? '',
          status: alert.status,
          latitude: alert.latitude,
          longitude: alert.longitude,
          createdAt: alert.createdAt,
          acknowledgedBy: alert.acknowledgedBy ?? '',
          message: alert.message,
        })),
      ),
      'text/csv',
    );
    toast.success('Export ready', `${filtered.length} alerts written to CSV.`);
  };

  const columns: Array<Column<Alert>> = [
    {
      key: 'severity',
      header: 'Severity',
      width: '110px',
      sortValue: (row) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[row.severity],
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', severityDot[row.severity])} />
          <Badge className={severityClasses[row.severity]}>{row.severity}</Badge>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Detection',
      width: '170px',
      sortValue: (row) => row.alertType,
      render: (row) => (
        <span className="text-[13px] font-medium text-slate-700">{ALERT_TYPE_LABELS[row.alertType]}</span>
      ),
    },
    {
      key: 'vessel',
      header: 'Vessel',
      sortValue: (row) => row.vesselName,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-800">{row.vesselName}</p>
          <p className="truncate font-mono text-[10px] text-slate-400">{row.vesselId}</p>
        </div>
      ),
    },
    {
      key: 'zone',
      header: 'Zone',
      sortValue: (row) => row.zoneName ?? '',
      render: (row) =>
        row.zoneName ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
            <Hexagon className="h-3 w-3 text-slate-400" />
            {row.zoneName}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: 'message',
      header: 'Detail',
      render: (row) => <p className="line-clamp-2 max-w-md text-xs text-slate-600">{row.message}</p>,
    },
    {
      key: 'createdAt',
      header: 'Raised',
      width: '110px',
      align: 'right',
      sortValue: (row) => row.createdAt,
      render: (row) => (
        <div className="text-right">
          <p className="text-xs text-slate-600">{timeAgo(row.createdAt)}</p>
          <p className="text-[10px] text-slate-400">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      align: 'center',
      sortValue: (row) => row.status,
      render: (row) => <Badge className={alertStatusClasses[row.status]}>{row.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: '92px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {row.status === 'NEW' ? (
            <Button
              size="xs"
              variant="secondary"
              icon={<Check className="h-3 w-3" />}
              disabled={busy}
              onClick={() => void act(row, 'acknowledge')}
            >
              Ack
            </Button>
          ) : row.status === 'ACKNOWLEDGED' ? (
            <Button
              size="xs"
              variant="success"
              icon={<CheckCheck className="h-3 w-3" />}
              disabled={busy}
              onClick={() => void act(row, 'resolve')}
            >
              Resolve
            </Button>
          ) : (
            <span className="text-[10px] text-slate-400">Closed</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4">
      {/* ══ KPIs ════════════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total alerts"
          value={summary.data?.total ?? counts.ALL}
          hint="Entire log"
          icon={<BellRing className="h-4 w-4" />}
        />
        <StatCard
          label="Awaiting action"
          value={summary.data?.new ?? counts.NEW}
          hint="Status NEW"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={(summary.data?.new ?? counts.NEW) > 0 ? 'danger' : 'muted'}
        />
        <StatCard
          label="Critical"
          value={summary.data?.bySeverity.CRITICAL ?? 0}
          hint={`${summary.data?.bySeverity.HIGH ?? 0} high severity`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone="danger"
        />
        <StatCard
          label="Unauthorized entries"
          value={summary.data?.byType.UNAUTHORIZED_ENTRY ?? 0}
          hint="Confirmed intrusions"
          icon={<Radio className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Last 24 hours"
          value={summary.data?.last24h ?? 0}
          hint={`${summary.data?.resolved ?? 0} resolved all-time`}
          icon={<CheckCheck className="h-4 w-4" />}
          tone="positive"
        />
      </div>

      {/* ══ Filters ═════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader
          title="Alert log"
          subtitle={`${filtered.length} of ${alerts.length} buffered events shown`}
          icon={<Filter className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<CheckCheck className="h-3.5 w-3.5" />}
                disabled={!canOperate || counts.NEW === 0 || busy}
                onClick={() => setBulkConfirm(true)}
              >
                Acknowledge all new
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportCsv}
                disabled={!filtered.length}
              >
                Export CSV
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Tabs
            value={tab}
            onChange={setTab}
            size="sm"
            options={[
              { value: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
              { value: 'NEW', label: 'New', count: counts.NEW },
              { value: 'ACKNOWLEDGED', label: 'Acknowledged', count: counts.ACKNOWLEDGED },
              { value: 'RESOLVED', label: 'Resolved', count: counts.RESOLVED },
              { value: 'ALL', label: 'All', count: counts.ALL },
            ]}
          />

          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as Severity | 'ALL')}
            className="w-36"
          >
            <option value="ALL">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>

          <Select
            value={type}
            onChange={(event) => setType(event.target.value as AlertType | 'ALL')}
            className="w-48"
          >
            <option value="ALL">All detection types</option>
            {Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search vessel, zone, alert ID…"
            className="ml-auto w-full sm:w-72"
          />
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.alertId}
          onRowClick={setSelected}
          initialSortKey="createdAt"
          maxHeight="560px"
          emptyTitle={alerts.length ? 'No alerts match these filters' : 'No alerts recorded yet'}
          emptyDescription={
            alerts.length
              ? 'Try widening the status or severity filter.'
              : 'Start the GPS simulator — detections will stream in here in real time.'
          }
        />
      </Card>

      {/* ══ Detail drawer ═══════════════════════════════════════════════ */}
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? ALERT_TYPE_LABELS[selected.alertType] : 'Alert'}
        subtitle={selected ? <span className="font-mono">{selected.alertId}</span> : null}
        width="sm"
        footer={
          selected ? (
            <div className="flex w-full items-center justify-between gap-2">
              <Badge className={alertStatusClasses[selected.status]}>{selected.status}</Badge>
              <div className="flex gap-2">
                {selected.status === 'NEW' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Check className="h-3.5 w-3.5" />}
                    loading={busy}
                    onClick={() => void act(selected, 'acknowledge')}
                  >
                    Acknowledge
                  </Button>
                ) : null}
                {selected.status !== 'RESOLVED' ? (
                  <Button
                    size="sm"
                    variant="success"
                    icon={<CheckCheck className="h-3.5 w-3.5" />}
                    loading={busy}
                    onClick={() => void act(selected, 'resolve')}
                  >
                    Resolve
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
      >
        {selected ? <AlertDetail alert={selected} /> : null}
      </Drawer>

      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={() => void acknowledgeAllNew()}
        title="Acknowledge all new alerts?"
        message={
          <>
            This will mark <span className="font-semibold">{counts.NEW}</span> unacknowledged alert
            {counts.NEW === 1 ? '' : 's'} as acknowledged and attribute them to you. The detections
            themselves are not removed.
          </>
        }
        confirmLabel="Acknowledge all"
        variant="primary"
        loading={busy}
      />
    </div>
  );
}

function AlertDetail({ alert }: { alert: Alert }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Severity', <Badge className={severityClasses[alert.severity]}>{alert.severity}</Badge>],
    ['Detection type', ALERT_TYPE_LABELS[alert.alertType]],
    ['Vessel', `${alert.vesselName} (${alert.vesselId})`],
    ['Zone', alert.zoneName ?? '—'],
    ['Position', `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`],
    ['Raised', formatDateTime(alert.createdAt)],
    ['Acknowledged', alert.acknowledgedAt ? `${formatDateTime(alert.acknowledgedAt)} by ${alert.acknowledgedBy}` : '—'],
    ['Resolved', alert.resolvedAt ? formatDateTime(alert.resolvedAt) : '—'],
    ['Linked incident', alert.incidentId ?? '—'],
  ];

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-lg border px-3 py-2.5',
          alert.severity === 'CRITICAL' || alert.severity === 'HIGH'
            ? 'border-rose-200 bg-rose-50'
            : 'border-slate-200 bg-slate-50',
        )}
      >
        <p className="text-[13px] leading-relaxed text-slate-700">{alert.message}</p>
      </div>

      <dl className="divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="text-right text-[13px] text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>

      {Object.keys(alert.metadata ?? {}).length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Engine metadata
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
            {JSON.stringify(alert.metadata, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <Ship className="h-3 w-3" /> Suggested action
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          {alert.alertType === 'UNAUTHORIZED_ENTRY'
            ? 'Dispatch the nearest patrol asset for interception and verify the contact visually. Keep the track recording until the vessel clears the zone.'
            : alert.alertType === 'ZONE_APPROACH'
              ? 'Issue a warning on the working channel. Escalate automatically if the contact crosses the boundary.'
              : alert.alertType === 'VESSEL_OFFLINE'
                ? 'Confirm whether the transponder failed or the vessel has gone dark deliberately. Check the last known position against radar.'
                : alert.alertType === 'SUSPICIOUS_MOVEMENT'
                  ? 'Increase observation frequency and log the behaviour pattern for the intelligence analyst.'
                  : 'Review the engine log for the affected evaluation cycle.'}
        </p>
      </div>
    </div>
  );
}

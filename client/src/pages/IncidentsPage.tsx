import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ClipboardList,
  Clock,
  Filter,
  Gauge,
  MapPin,
  ShieldAlert,
  Timer,
  UserPlus,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  INCIDENT_COLUMNS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TRANSITIONS,
} from '@/lib/constants';
import {
  cn,
  formatDateTime,
  formatDuration,
  incidentStatusClasses,
  severityClasses,
  severityDot,
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
  DataTable,
  Drawer,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  type Column,
} from '@/components/ui';
import type { Incident, IncidentStatus, Severity } from '@/types';

/**
 * Incident management (spec §14).
 *
 * Two views over the same workflow. The board is the working view — a card sits in
 * the column that matches its state and offers exactly the transitions the server
 * will accept, so an illegal move is impossible rather than merely rejected. The
 * table is the reporting view, for sorting and audit.
 */
export function IncidentsPage() {
  const { incidents, patchIncident } = useRealtime();
  const { canOperate, user } = useAuth();
  const toast = useToast();

  const [view, setView] = useState<'board' | 'table'>('board');
  const [severity, setSeverity] = useState<Severity | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useQuery({
    queryKey: ['incidents', 'summary'],
    queryFn: api.incidents.summary,
    refetchInterval: 20_000,
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return incidents
      .filter((incident) => severity === 'ALL' || incident.severity === severity)
      .filter((incident) =>
        needle
          ? incident.title.toLowerCase().includes(needle) ||
            incident.vesselName.toLowerCase().includes(needle) ||
            incident.incidentId.toLowerCase().includes(needle) ||
            (incident.zoneName ?? '').toLowerCase().includes(needle)
          : true,
      );
  }, [incidents, severity, search]);

  const byColumn = useMemo(() => {
    const map = new Map<IncidentStatus, Incident[]>();
    for (const status of INCIDENT_COLUMNS) {
      map.set(
        status,
        filtered
          .filter((incident) => incident.status === status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    }
    return map;
  }, [filtered]);

  const transition = async (incident: Incident, next: IncidentStatus) => {
    if (!canOperate) {
      toast.warning('Insufficient permissions', 'Moving an incident requires the Operator or Admin role.');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.incidents.transition(incident.incidentId, next);
      patchIncident(updated);
      setSelected((prev) => (prev?.incidentId === updated.incidentId ? updated : prev));
      toast.success(`Incident moved to ${INCIDENT_STATUS_LABELS[next]}`, updated.incidentId);
      void summary.refetch();
    } catch (error) {
      toast.error('Transition rejected', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assignToMe = async (incident: Incident) => {
    if (!canOperate || !user) return;
    setBusy(true);
    try {
      const updated = await api.incidents.assign(incident.incidentId, user.name);
      patchIncident(updated);
      setSelected((prev) => (prev?.incidentId === updated.incidentId ? updated : prev));
      toast.success('Incident assigned', `${incident.incidentId} → ${user.name}`);
    } catch (error) {
      toast.error('Assignment failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<Column<Incident>> = [
    {
      key: 'incidentId',
      header: 'Incident',
      width: '130px',
      sortValue: (row) => row.incidentId,
      render: (row) => <span className="font-mono text-[11px] text-slate-500">{row.incidentId}</span>,
    },
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
      key: 'title',
      header: 'Title',
      sortValue: (row) => row.title,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-800">{row.title}</p>
          <p className="truncate text-[11px] text-slate-400">
            {row.vesselName} · {row.zoneName ?? 'no zone'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      align: 'center',
      sortValue: (row) => row.status,
      render: (row) => <Badge className={incidentStatusClasses[row.status]}>{INCIDENT_STATUS_LABELS[row.status]}</Badge>,
    },
    {
      key: 'assignedTo',
      header: 'Owner',
      width: '130px',
      sortValue: (row) => row.assignedTo ?? '',
      render: (row) =>
        row.assignedTo ? (
          <span className="text-xs text-slate-600">{row.assignedTo}</span>
        ) : (
          <span className="text-xs italic text-slate-400">Unassigned</span>
        ),
    },
    {
      key: 'age',
      header: 'Age',
      width: '110px',
      align: 'right',
      sortValue: (row) => row.createdAt,
      render: (row) => (
        <div className="text-right">
          <p className="text-xs text-slate-600">{timeAgo(row.createdAt)}</p>
          <p className="text-[10px] text-slate-400">
            {row.resolvedAt ? `closed in ${formatDuration(Math.round((new Date(row.resolvedAt).getTime() - new Date(row.createdAt).getTime()) / 60000))}` : 'open'}
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4">
      {/* ══ KPIs ════════════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Total incidents" value={summary.data?.total ?? incidents.length} hint="All time" icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard
          label="Open"
          value={summary.data?.open ?? 0}
          hint={`${summary.data?.acknowledged ?? 0} acknowledged`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={(summary.data?.open ?? 0) > 0 ? 'danger' : 'muted'}
        />
        <StatCard
          label="Investigating"
          value={summary.data?.investigating ?? 0}
          hint="Active response"
          icon={<Gauge className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Critical open"
          value={summary.data?.critical ?? 0}
          hint="Severity CRITICAL"
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={(summary.data?.critical ?? 0) > 0 ? 'danger' : 'muted'}
        />
        <StatCard
          label="Mean time to ack"
          value={formatDuration(summary.data?.meanTimeToAcknowledgeMinutes)}
          hint="Detection → acknowledgement"
          icon={<Timer className="h-4 w-4" />}
        />
        <StatCard
          label="Mean time to resolve"
          value={formatDuration(summary.data?.meanTimeToResolveMinutes)}
          hint="Detection → resolution"
          icon={<Clock className="h-4 w-4" />}
          tone="positive"
        />
      </div>

      {/* ══ Controls ════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader
          title="Incident board"
          subtitle="OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED"
          icon={<Filter className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
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
              <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-56" />
              <Tabs
                value={view}
                onChange={setView}
                size="sm"
                options={[
                  { value: 'board', label: 'Board' },
                  { value: 'table', label: 'Table' },
                ]}
              />
            </div>
          }
        />

        {view === 'board' ? (
          <div className="overflow-x-auto p-3">
            <div className="grid min-w-[1100px] grid-cols-5 gap-3">
              {INCIDENT_COLUMNS.map((status) => {
                const items = byColumn.get(status) ?? [];
                return (
                  <div key={status} className="flex min-w-0 flex-col rounded-lg bg-slate-50/80 p-2">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status])} />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                          {INCIDENT_STATUS_LABELS[status]}
                        </span>
                      </div>
                      <span className="tnum rounded bg-white px-1.5 text-[10px] font-bold text-slate-500 ring-1 ring-inset ring-slate-200">
                        {items.length}
                      </span>
                    </div>

                    <div className="panel-scroll flex-1 space-y-2" style={{ maxHeight: '560px' }}>
                      {items.length ? (
                        items.map((incident) => (
                          <IncidentCard
                            key={incident.incidentId}
                            incident={incident}
                            onOpen={() => setSelected(incident)}
                            onTransition={(next) => void transition(incident, next)}
                            busy={busy}
                            canOperate={canOperate}
                          />
                        ))
                      ) : (
                        <p className="px-1 py-6 text-center text-[11px] text-slate-400">No incidents</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.incidentId}
            onRowClick={setSelected}
            initialSortKey="age"
            maxHeight="600px"
            emptyTitle="No incidents match these filters"
            emptyDescription="Confirmed intrusions open an incident automatically."
          />
        )}
      </Card>

      {/* ══ Detail drawer ═══════════════════════════════════════════════ */}
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Incident'}
        subtitle={selected ? <span className="font-mono">{selected.incidentId}</span> : null}
        width="md"
      >
        {selected ? (
          <IncidentDetail
            incident={selected}
            busy={busy}
            canOperate={canOperate}
            onTransition={(next) => void transition(selected, next)}
            onAssign={() => void assignToMe(selected)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

const STATUS_DOT: Record<IncidentStatus, string> = {
  OPEN: 'bg-rose-500',
  ACKNOWLEDGED: 'bg-sky-500',
  INVESTIGATING: 'bg-violet-500',
  RESOLVED: 'bg-emerald-500',
  CLOSED: 'bg-slate-400',
};

function IncidentCard({
  incident,
  onOpen,
  onTransition,
  busy,
  canOperate,
}: {
  incident: Incident;
  onOpen: () => void;
  onTransition: (next: IncidentStatus) => void;
  busy: boolean;
  canOperate: boolean;
}) {
  const nextStates = INCIDENT_TRANSITIONS[incident.status];
  const primary = nextStates[0];

  return (
    <div
      className={cn(
        'group cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-card transition',
        'hover:border-brand-300 hover:shadow-raised',
      )}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', severityDot[incident.severity])} />
        <span className="truncate font-mono text-[10px] text-slate-400">{incident.incidentId}</span>
        <Badge className={severityClasses[incident.severity]}>{incident.severity}</Badge>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-slate-800">
        {incident.title}
      </p>

      <div className="mt-1.5 space-y-0.5 text-[10px] text-slate-500">
        <p className="truncate">
          <span className="font-medium text-slate-600">{incident.vesselName}</span>
          {incident.zoneName ? ` · ${incident.zoneName}` : ''}
        </p>
        <p className="flex items-center gap-1">
          <MapPin className="h-2.5 w-2.5" />
          {incident.location.lat.toFixed(4)}, {incident.location.lng.toFixed(4)}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-[10px] text-slate-400">{timeAgo(incident.createdAt)}</span>
        {primary && canOperate ? (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onTransition(primary);
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
          >
            {INCIDENT_STATUS_LABELS[primary]}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        ) : incident.assignedTo ? (
          <span className="truncate text-[10px] text-slate-400">{incident.assignedTo}</span>
        ) : null}
      </div>
    </div>
  );
}

function IncidentDetail({
  incident,
  busy,
  canOperate,
  onTransition,
  onAssign,
}: {
  incident: Incident;
  busy: boolean;
  canOperate: boolean;
  onTransition: (next: IncidentStatus) => void;
  onAssign: () => void;
}) {
  const nextStates = INCIDENT_TRANSITIONS[incident.status];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={incidentStatusClasses[incident.status]}>
          {INCIDENT_STATUS_LABELS[incident.status]}
        </Badge>
        <Badge className={severityClasses[incident.severity]}>{incident.severity}</Badge>
        {incident.alertId ? (
          <Badge className="bg-slate-100 font-mono text-slate-600 ring-1 ring-inset ring-slate-200">
            {incident.alertId}
          </Badge>
        ) : null}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-[13px] leading-relaxed text-slate-700">{incident.description}</p>
      </div>

      {canOperate ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Workflow actions
          </p>
          <div className="flex flex-wrap gap-2">
            {nextStates.length ? (
              nextStates.map((next) => (
                <Button
                  key={next}
                  size="sm"
                  variant={next === 'CLOSED' || next === 'RESOLVED' ? 'success' : 'primary'}
                  disabled={busy}
                  onClick={() => onTransition(next)}
                >
                  {INCIDENT_STATUS_LABELS[next]}
                </Button>
              ))
            ) : (
              <p className="text-xs text-slate-500">
                This incident is closed. No further transitions are permitted by the workflow.
              </p>
            )}
            {!incident.assignedTo ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<UserPlus className="h-3.5 w-3.5" />}
                disabled={busy}
                onClick={onAssign}
              >
                Assign to me
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          Your role is read-only. Ask an Operator or Administrator to action this incident.
        </p>
      )}

      <dl className="divide-y divide-slate-100">
        <Row label="Vessel" value={`${incident.vesselName} (${incident.vesselId})`} />
        <Row label="Zone" value={incident.zoneName ?? '—'} />
        <Row
          label="Location"
          value={`${incident.location.lat.toFixed(5)}, ${incident.location.lng.toFixed(5)}`}
        />
        <Row label="Owner" value={incident.assignedTo ?? 'Unassigned'} />
        <Row label="Raised" value={formatDateTime(incident.createdAt)} />
        <Row label="Acknowledged" value={formatDateTime(incident.acknowledgedAt)} />
        <Row label="Resolved" value={formatDateTime(incident.resolvedAt)} />
        <Row label="Closed" value={formatDateTime(incident.closedAt)} />
      </dl>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Case timeline
        </p>
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {incident.timeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="relative">
              <span
                className={cn(
                  'absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white',
                  STATUS_DOT[entry.status],
                )}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-slate-700">
                  {INCIDENT_STATUS_LABELS[entry.status]}
                </span>
                <span className="text-[10px] text-slate-400">{formatDateTime(entry.at)}</span>
              </div>
              <p className="text-[11px] text-slate-500">{entry.note}</p>
              <p className="text-[10px] text-slate-400">by {entry.by}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="truncate text-right text-[13px] text-slate-800">{value}</dd>
    </div>
  );
}

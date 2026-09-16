import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Anchor,
  CheckCircle2,
  Download,
  Map as MapIcon,
  Pencil,
  Plus,
  Ship,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { AUTHORIZATION_LABELS, HOME_PORTS_LABEL, VESSEL_TYPE_LABELS } from '@/lib/constants';
import {
  cn,
  downloadFile,
  formatCoord,
  formatHeading,
  formatNumber,
  formatSpeed,
  timeAgo,
  toCsv,
  vesselStatusClasses,
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
  Field,
  Input,
  Modal,
  ProgressBar,
  SearchInput,
  Select,
  StatCard,
  Textarea,
  Tabs,
  type Column,
} from '@/components/ui';
import { LiveMap } from '@/components/map/LiveMap';
import { VesselDetailPanel } from '@/components/map/VesselDetailPanel';
import type { AuthorizationStatus, Vessel, VesselStatus, VesselType } from '@/types';

/* ───────────────────────────── Form schema ───────────────────────────── */

const vesselFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  registrationNumber: z.string().max(40).optional(),
  vesselType: z.enum(['FISHING_BOAT', 'CARGO_SHIP', 'PASSENGER_BOAT', 'PATROL_BOAT', 'UNKNOWN']),
  owner: z.string().max(120).optional(),
  authorizationStatus: z.enum(['AUTHORIZED', 'UNAUTHORIZED']),
  homePort: z.string().max(80).optional(),
  simulated: z.boolean(),
  speed: z.coerce.number().min(0).max(120).optional(),
  direction: z.coerce.number().min(0).max(360).optional(),
  notes: z.string().max(500).optional(),
});

type VesselFormValues = z.infer<typeof vesselFormSchema>;

/**
 * Vessel registry (spec §10).
 *
 * The table is backed by the API for filtering and pagination, but live telemetry
 * columns are overlaid from the realtime store — so a row's speed and heading move
 * while the static fields stay authoritative on the server.
 */
export function VesselsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { live, alerts } = useRealtime();
  const { canOperate, isAdmin } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState<VesselStatus | 'ALL'>('ALL');
  const [authorization, setAuthorization] = useState<AuthorizationStatus | 'ALL'>('ALL');
  const [type, setType] = useState<VesselType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vessel | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(searchParams.get('vessel'));
  const [pendingDelete, setPendingDelete] = useState<Vessel | null>(null);

  const vesselsQuery = useQuery({
    queryKey: ['vessels', { status, authorization, type, search }],
    queryFn: () =>
      api.vessels.list({
        status: status === 'ALL' ? undefined : status,
        authorizationStatus: authorization === 'ALL' ? undefined : authorization,
        vesselType: type === 'ALL' ? undefined : type,
        search: search || undefined,
      }),
    refetchInterval: 30_000,
  });

  const summary = useQuery({
    queryKey: ['vessels', 'summary'],
    queryFn: api.vessels.summary,
    refetchInterval: 20_000,
  });

  const statsQuery = useQuery({
    queryKey: ['vessel-stats', detailId],
    queryFn: () => api.vessels.stats(detailId!),
    enabled: Boolean(detailId),
  });

  const trackQuery = useQuery({
    queryKey: ['track', detailId, 200],
    queryFn: () => api.telemetry.track(detailId!, 200),
    enabled: Boolean(detailId),
    refetchInterval: 6000,
  });

  // Keep the deep-link parameter in sync with the open drawer.
  useEffect(() => {
    const current = searchParams.get('vessel');
    if (detailId && current !== detailId) setSearchParams({ vessel: detailId }, { replace: true });
    else if (!detailId && current) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  const rows = vesselsQuery.data?.rows ?? [];
  const detailVessel = rows.find((v) => v.vesselId === detailId) ?? null;

  const removeMutation = useMutation({
    mutationFn: (vessel: Vessel) => api.vessels.remove(vessel.vesselId),
    onSuccess: (_result, vessel) => {
      toast.success('Vessel removed', `${vessel.name} (${vessel.vesselId}) deleted from the registry.`);
      setPendingDelete(null);
      if (detailId === vessel.vesselId) setDetailId(null);
      void queryClient.invalidateQueries({ queryKey: ['vessels'] });
    },
    onError: (error) => toast.error('Delete failed', (error as Error).message),
  });

  const exportCsv = () => {
    downloadFile(
      `cidrtm-vessels-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        rows.map((vessel) => ({
          vesselId: vessel.vesselId,
          name: vessel.name,
          registrationNumber: vessel.registrationNumber,
          vesselType: vessel.vesselType,
          owner: vessel.owner,
          authorizationStatus: vessel.authorizationStatus,
          status: vessel.status,
          latitude: vessel.currentLatitude,
          longitude: vessel.currentLongitude,
          speed: vessel.speed,
          direction: vessel.direction,
          homePort: vessel.homePort,
          riskScore: vessel.riskScore,
          lastSeen: vessel.lastSeen ?? '',
        })),
      ),
      'text/csv',
    );
    toast.success('Export ready', `${rows.length} vessels written to CSV.`);
  };

  const columns: Array<Column<Vessel>> = [
    {
      key: 'vesselId',
      header: 'Vessel ID',
      width: '120px',
      sortValue: (row) => row.vesselId,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              live[row.vesselId]?.status === 'INTRUSION'
                ? 'bg-rose-500'
                : live[row.vesselId]?.status === 'WARNING'
                  ? 'bg-amber-500'
                  : live[row.vesselId]?.status === 'OFFLINE'
                    ? 'bg-slate-400'
                    : 'bg-emerald-500',
            )}
          />
          <span className="font-mono text-[11px] text-slate-500">{row.vesselId}</span>
        </div>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-[10px] text-slate-400">{row.registrationNumber}</p>
        </div>
      ),
    },
    {
      key: 'vesselType',
      header: 'Type',
      width: '130px',
      sortValue: (row) => row.vesselType,
      render: (row) => <span className="text-xs text-slate-600">{VESSEL_TYPE_LABELS[row.vesselType]}</span>,
    },
    {
      key: 'authorizationStatus',
      header: 'Authorization',
      width: '140px',
      align: 'center',
      sortValue: (row) => row.authorizationStatus,
      render: (row) => (
        <Badge
          className={
            row.authorizationStatus === 'AUTHORIZED'
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
              : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
          }
        >
          {row.authorizationStatus === 'AUTHORIZED' ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <ShieldAlert className="h-3 w-3" />
          )}
          {AUTHORIZATION_LABELS[row.authorizationStatus]}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      align: 'center',
      sortValue: (row) => row.status,
      render: (row) => <Badge className={vesselStatusClasses[row.status]}>{row.status}</Badge>,
    },
    {
      key: 'position',
      header: 'Position',
      width: '170px',
      render: (row) => {
        const frame = live[row.vesselId];
        return (
          <div className="font-mono text-[10px] leading-relaxed text-slate-500">
            <p>{formatCoord(frame?.latitude ?? row.currentLatitude, 'lat')}</p>
            <p>{formatCoord(frame?.longitude ?? row.currentLongitude, 'lng')}</p>
          </div>
        );
      },
    },
    {
      key: 'motion',
      header: 'Motion',
      width: '130px',
      sortValue: (row) => live[row.vesselId]?.speed ?? row.speed,
      render: (row) => {
        const frame = live[row.vesselId];
        return (
          <div className="text-right text-[11px] text-slate-600">
            <p className="tnum font-medium">{formatSpeed(frame?.speed ?? row.speed)}</p>
            <p className="text-[10px] text-slate-400">{formatHeading(frame?.direction ?? row.direction)}</p>
          </div>
        );
      },
      align: 'right',
    },
    {
      key: 'riskScore',
      header: 'Risk',
      width: '100px',
      align: 'right',
      sortValue: (row) => row.riskScore,
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <span className="tnum text-[11px] font-semibold text-slate-600">{row.riskScore}</span>
          <ProgressBar
            value={row.riskScore}
            className="w-12"
            barClassName={
              row.riskScore >= 70 ? 'bg-rose-500' : row.riskScore >= 40 ? 'bg-amber-500' : 'bg-emerald-500'
            }
          />
        </div>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Last seen',
      width: '110px',
      align: 'right',
      sortValue: (row) => row.lastSeen ?? '',
      render: (row) => <span className="text-[11px] text-slate-500">{timeAgo(row.lastSeen)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            size="xs"
            variant="ghost"
            icon={<Pencil className="h-3 w-3" />}
            disabled={!canOperate}
            onClick={() => setEditing(row)}
          />
          <Button
            size="xs"
            variant="ghost"
            icon={<Trash2 className="h-3 w-3" />}
            className="text-rose-600 hover:bg-rose-50"
            disabled={!isAdmin}
            onClick={() => setPendingDelete(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Registered" value={formatNumber(summary.data?.total)} hint="All vessels" icon={<Ship className="h-4 w-4" />} />
        <StatCard
          label="Active"
          value={formatNumber(summary.data?.active)}
          hint={`Avg ${summary.data?.averageSpeed ?? 0} km/h`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="positive"
        />
        <StatCard
          label="Authorized"
          value={formatNumber(summary.data?.authorized)}
          hint={`${summary.data?.unauthorized ?? 0} unauthorized`}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Under intrusion"
          value={formatNumber(summary.data?.intrusion)}
          hint={`${summary.data?.warning ?? 0} approaching`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={(summary.data?.intrusion ?? 0) > 0 ? 'danger' : 'muted'}
        />
        <StatCard
          label="Offline"
          value={formatNumber(summary.data?.offline)}
          hint="No recent telemetry"
          icon={<WifiOff className="h-4 w-4" />}
          tone={(summary.data?.offline ?? 0) > 0 ? 'warning' : 'muted'}
        />
      </div>

      <Card>
        <CardHeader
          title="Vessel registry"
          subtitle={`${rows.length} of ${vesselsQuery.data?.meta.total ?? 0} records`}
          icon={<Anchor className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" />}
                disabled={!canOperate}
                onClick={() => setCreating(true)}
              >
                Register vessel
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Tabs
            value={status}
            onChange={setStatus}
            size="sm"
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'WARNING', label: 'Warning' },
              { value: 'INTRUSION', label: 'Intrusion' },
              { value: 'OFFLINE', label: 'Offline' },
            ]}
          />
          <Select
            value={authorization}
            onChange={(event) => setAuthorization(event.target.value as AuthorizationStatus | 'ALL')}
            className="w-40"
          >
            <option value="ALL">All authorizations</option>
            <option value="AUTHORIZED">Authorized</option>
            <option value="UNAUTHORIZED">Unauthorized</option>
          </Select>
          <Select
            value={type}
            onChange={(event) => setType(event.target.value as VesselType | 'ALL')}
            className="w-44"
          >
            <option value="ALL">All vessel types</option>
            {Object.entries(VESSEL_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, ID, owner…"
            className="ml-auto w-full sm:w-72"
          />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.vesselId}
          loading={vesselsQuery.isLoading}
          onRowClick={(row) => setDetailId(row.vesselId)}
          initialSortKey="vesselId"
          initialSortDir="asc"
          maxHeight="600px"
          emptyTitle="No vessels match these filters"
          emptyDescription="Adjust the filters or register a new contact."
        />
      </Card>

      {/* ══ Create / edit ═══════════════════════════════════════════════ */}
      <VesselFormModal
        open={creating || Boolean(editing)}
        vessel={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ['vessels'] });
        }}
      />

      {/* ══ Detail ══════════════════════════════════════════════════════ */}
      <Drawer
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detailVessel?.name ?? 'Vessel'}
        subtitle={detailId ? <span className="font-mono">{detailId}</span> : null}
        width="lg"
      >
        {detailId && live[detailId] ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="h-[280px]">
                <LiveMap
                  frames={{ [detailId]: live[detailId] }}
                  zones={[]}
                  selectedVesselId={detailId}
                  onSelectVessel={() => undefined}
                  track={trackQuery.data ?? []}
                  showTracks
                  showZones={false}
                  className="h-full w-full"
                />
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <MapIcon className="h-3 w-3" />
                  {trackQuery.data?.length ?? 0} position reports plotted
                </span>
                <span className="text-[11px] text-slate-400">
                  Last contact {timeAgo(live[detailId].lastSeen)}
                </span>
              </div>
            </div>

            <VesselDetailPanel
              frame={live[detailId]}
              vessel={detailVessel ?? undefined}
              stats={statsQuery.data}
              trackPoints={trackQuery.data?.length}
              alerts={alerts.filter((a) => a.vesselId === detailId)}
            />
          </div>
        ) : detailVessel ? (
          <p className="text-sm text-slate-500">
            No live telemetry for this vessel. Start the GPS simulator to begin receiving positions.
          </p>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && removeMutation.mutate(pendingDelete)}
        title="Delete vessel?"
        message={
          <>
            <span className="font-semibold">{pendingDelete?.name}</span> ({pendingDelete?.vesselId}) will be
            removed from the registry along with its position history. Alerts and incidents already raised
            are kept for the audit trail.
          </>
        }
        confirmLabel="Delete vessel"
        loading={removeMutation.isPending}
      />
    </div>
  );
}

/* ──────────────────────────── Form modal ─────────────────────────────── */

function VesselFormModal({
  open,
  vessel,
  onClose,
  onSaved,
}: {
  open: boolean;
  vessel: Vessel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(vessel);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VesselFormValues>({
    resolver: zodResolver(vesselFormSchema),
    defaultValues: {
      name: '',
      registrationNumber: '',
      vesselType: 'FISHING_BOAT',
      owner: '',
      authorizationStatus: 'AUTHORIZED',
      homePort: HOME_PORTS_LABEL[0],
      simulated: true,
      speed: 10,
      direction: 90,
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      vessel
        ? {
            name: vessel.name,
            registrationNumber: vessel.registrationNumber,
            vesselType: vessel.vesselType,
            owner: vessel.owner,
            authorizationStatus: vessel.authorizationStatus,
            homePort: vessel.homePort,
            simulated: vessel.simulated,
            speed: vessel.speed,
            direction: vessel.direction,
            notes: vessel.notes,
          }
        : {
            name: '',
            registrationNumber: '',
            vesselType: 'FISHING_BOAT',
            owner: '',
            authorizationStatus: 'AUTHORIZED',
            homePort: HOME_PORTS_LABEL[0],
            simulated: true,
            speed: 10,
            direction: 90,
            notes: '',
          },
    );
  }, [open, vessel, reset]);

  const onSubmit = async (values: VesselFormValues) => {
    try {
      if (isEdit && vessel) {
        await api.vessels.update(vessel.vesselId, values);
        toast.success('Vessel updated', `${values.name} saved.`);
      } else {
        const created = await api.vessels.create(values);
        toast.success('Vessel registered', `${created.name} · ${created.vesselId}`);
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors();
        let matched = false;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof VesselFormValues, { message });
          matched = true;
        }
        if (!matched) toast.error('Save failed', error.message);
      } else {
        toast.error('Save failed', (error as Error).message);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit vessel' : 'Register new vessel'}
      description={
        isEdit
          ? 'Changing the authorization flag re-evaluates every active geofence for this contact.'
          : 'Unauthorized vessels are picked up by the GPS simulator as intruders on its next tick.'
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Register vessel'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Vessel name" error={errors.name?.message} required>
          <Input placeholder="e.g. Sea Guardian" invalid={Boolean(errors.name)} {...register('name')} />
        </Field>

        <Field label="Registration number" error={errors.registrationNumber?.message}>
          <Input placeholder="IN-KLK-1234" {...register('registrationNumber')} />
        </Field>

        <Field label="Vessel type" error={errors.vesselType?.message} required>
          <Select {...register('vesselType')}>
            {Object.entries(VESSEL_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Authorization status" error={errors.authorizationStatus?.message} required>
          <Select {...register('authorizationStatus')}>
            <option value="AUTHORIZED">Authorized</option>
            <option value="UNAUTHORIZED">Unauthorized</option>
          </Select>
        </Field>

        <Field label="Owner / operator" error={errors.owner?.message}>
          <Input placeholder="Owner name" {...register('owner')} />
        </Field>

        <Field label="Home port" error={errors.homePort?.message}>
          <Select {...register('homePort')}>
            {HOME_PORTS_LABEL.map((port) => (
              <option key={port} value={port}>
                {port}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Initial speed (km/h)" error={errors.speed?.message}>
          <Input type="number" step="0.1" {...register('speed')} />
        </Field>

        <Field label="Initial heading (degrees)" error={errors.direction?.message}>
          <Input type="number" step="1" min={0} max={360} {...register('direction')} />
        </Field>

        <Field label="Notes" className="sm:col-span-2" error={errors.notes?.message}>
          <Textarea rows={3} placeholder="Operational notes, permit references…" {...register('notes')} />
        </Field>

        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
            {...register('simulated')}
          />
          Drive this vessel with the GPS simulator
        </label>
      </form>
    </Modal>
  );
}

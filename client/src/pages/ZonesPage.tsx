import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Eye,
  EyeOff,
  Hexagon,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Ruler,
  ShieldAlert,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { THEATRE, ZONE_TYPE_LABELS } from '@/lib/constants';
import {
  cn,
  formatNumber,
  severityClasses,
  timeAgo,
  zoneSeverityHex,
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
  EmptyState,
  Field,
  Input,
  Modal,
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '@/components/ui';
import { LiveMap } from '@/components/map/LiveMap';
import type { LatLng, Zone, ZoneWithStats } from '@/types';

const zoneFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80),
  description: z.string().max(500).optional(),
  zoneType: z.enum(['SECURITY_ZONE', 'RESTRICTED_ZONE', 'HARBOUR_ZONE', 'NO_ENTRY_ZONE', 'CUSTOM_ZONE']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  approachBufferMeters: z.coerce.number().min(50).max(10_000),
  status: z.enum(['ENABLED', 'DISABLED']),
});

type ZoneFormValues = z.infer<typeof zoneFormSchema>;

/** Default pentagon so a new zone starts from something editable, not an empty map. */
const defaultPentagon = (): LatLng[] => {
  const [lat, lng] = THEATRE.center;
  const d = 0.02;
  return [
    { lat: lat + d, lng },
    { lat: lat + d * 0.3, lng: lng + d },
    { lat: lat - d * 0.7, lng: lng + d * 0.6 },
    { lat: lat - d * 0.7, lng: lng - d * 0.6 },
    { lat: lat + d * 0.3, lng: lng - d },
  ];
};

/**
 * Restricted zone management (spec §8).
 *
 * The polygon editor is the interesting part: vertices are dragged, midpoints
 * clicked to insert new ones, and the ring is validated to at least three points
 * before it will save. The server stores both a readable `{lat,lng}[]` ring and a
 * derived GeoJSON Polygon, so the same data is ready for a 2dsphere index later.
 */
export function ZonesPage() {
  const queryClient = useQueryClient();
  const { canOperate } = useAuth();
  const { zones: liveZones, live, alerts } = useRealtime();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Zone | null>(null);

  const zonesQuery = useQuery({
    queryKey: ['zones', 'activity'],
    queryFn: api.analytics.zones,
    refetchInterval: 30_000,
  });

  // Memoised so the `?? []` fallback keeps a stable identity between renders —
  // otherwise both memos below would recompute on every render.
  const zones = useMemo<ZoneWithStats[]>(() => zonesQuery.data ?? [], [zonesQuery.data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return zones;
    return zones.filter(
      (zone) =>
        zone.name.toLowerCase().includes(needle) ||
        zone.description.toLowerCase().includes(needle) ||
        zone.zoneId.toLowerCase().includes(needle),
    );
  }, [zones, search]);

  const totals = useMemo(
    () => ({
      total: zones.length,
      enabled: zones.filter((z) => z.status === 'ENABLED').length,
      disabled: zones.filter((z) => z.status === 'DISABLED').length,
      critical: zones.filter((z) => z.severity === 'CRITICAL').length,
      area: zones.reduce((sum, z) => sum + z.areaSqKm, 0),
      intrusions: zones.reduce((sum, z) => sum + (z.intrusionCount ?? 0), 0),
    }),
    [zones],
  );

  const toggleMutation = useMutation({
    mutationFn: (zone: Zone) => api.zones.toggle(zone.zoneId),
    onSuccess: (zone) => {
      toast.success(`Zone ${zone.status === 'ENABLED' ? 'enabled' : 'disabled'}`, zone.name);
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
    onError: (error) => toast.error('Could not toggle zone', (error as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (zone: Zone) => api.zones.remove(zone.zoneId),
    onSuccess: (_result, zone) => {
      toast.success('Zone deleted', `${zone.name} is no longer enforced.`);
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
    onError: (error) => toast.error('Delete failed', (error as Error).message),
  });

  const openEditor = (zone: Zone | null) => {
    setEditingZone(zone);
    setDraft(zone ? zone.coordinates.map((c) => ({ ...c })) : defaultPentagon());
    setEditorOpen(true);
  };

  const liveZoneList = useMemo(
    () =>
      Object.values(liveZones).map((zone) => ({
        ...zone,
        coordinates: zone.coordinates,
      })),
    [liveZones],
  );

  return (
    <div className="space-y-4 p-4">
      {/* ══ KPIs ════════════════════════════════════════════════════════ */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Monitored zones" value={totals.total} hint={`${totals.enabled} enforced`} icon={<Hexagon className="h-4 w-4" />} />
        <StatCard label="Disabled" value={totals.disabled} hint="Not evaluated by the engine" icon={<EyeOff className="h-4 w-4" />} tone="muted" />
        <StatCard label="Critical severity" value={totals.critical} hint="Highest enforcement tier" icon={<ShieldAlert className="h-4 w-4" />} tone={totals.critical ? 'danger' : 'muted'} />
        <StatCard label="Total area" value={`${formatNumber(totals.area, 1)} km²`} hint="Across all polygons" icon={<Ruler className="h-4 w-4" />} />
        <StatCard label="Intrusions logged" value={totals.intrusions} hint="Unauthorized entries in zones" icon={<Layers className="h-4 w-4" />} tone={totals.intrusions ? 'warning' : 'muted'} />
      </div>

      {/* ══ Overview map ════════════════════════════════════════════════ */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Zone overview"
          subtitle={`${totals.total} polygons · ${Object.keys(live).length} live contacts`}
          icon={<MapPin className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search zones…" className="w-52" />
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" />}
                disabled={!canOperate}
                onClick={() => openEditor(null)}
              >
                Draw zone
              </Button>
            </div>
          }
        />
        <div className="h-[340px]">
          <LiveMap
            frames={live}
            zones={liveZoneList}
            selectedVesselId={null}
            onSelectVessel={() => undefined}
            showTracks={false}
            className="h-full w-full"
          />
        </div>
      </Card>

      {/* ══ Zone cards ══════════════════════════════════════════════════ */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {zonesQuery.isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-44 animate-pulse bg-slate-100">
                {null}
              </Card>
            ))
          : filtered.map((zone) => (
              <Card key={zone.zoneId} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: zoneSeverityHex[zone.severity] }}
                      />
                      <h3 className="truncate text-sm font-semibold text-slate-800">{zone.name}</h3>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">{zone.zoneId}</p>
                  </div>
                  <Badge
                    className={
                      zone.status === 'ENABLED'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                        : 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200'
                    }
                  >
                    {zone.status}
                  </Badge>
                </div>

                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">
                  {zone.description || 'No description provided.'}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge className={severityClasses[zone.severity]}>{zone.severity}</Badge>
                  <Badge className="bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                    {ZONE_TYPE_LABELS[zone.zoneType]}
                  </Badge>
                  <Badge className="bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                    {zone.coordinates.length} vertices
                  </Badge>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400">Area</dt>
                    <dd className="tnum text-[13px] font-semibold text-slate-700">{zone.areaSqKm} km²</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400">Contacts</dt>
                    <dd className="tnum text-[13px] font-semibold text-slate-700">{zone.vesselCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400">Intrusions</dt>
                    <dd
                      className={cn(
                        'tnum text-[13px] font-semibold',
                        (zone.intrusionCount ?? 0) > 0 ? 'text-rose-600' : 'text-slate-700',
                      )}
                    >
                      {zone.intrusionCount ?? 0}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[10px] text-slate-400">
                    Updated {timeAgo(zone.updatedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={zone.status === 'ENABLED' ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      disabled={!canOperate || toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(zone)}
                    >
                      {zone.status === 'ENABLED' ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<Pencil className="h-3 w-3" />}
                      disabled={!canOperate}
                      onClick={() => openEditor(zone)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50"
                      icon={<Trash2 className="h-3 w-3" />}
                      disabled={!canOperate}
                      onClick={() => setPendingDelete(zone)}
                    />
                  </div>
                </div>
              </Card>
            ))}
      </div>

      {!zonesQuery.isLoading && !filtered.length ? (
        <Card>
          <EmptyState
            title={search ? 'No zones match your search' : 'No restricted zones defined'}
            description={
              search
                ? 'Try a different name or zone identifier.'
                : 'Draw your first polygon to begin enforcing a coastal geofence.'
            }
            icon={<Hexagon className="h-5 w-5" />}
            action={
              !search && canOperate ? (
                <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openEditor(null)}>
                  Draw zone
                </Button>
              ) : null
            }
          />
        </Card>
      ) : null}

      {/* ══ Polygon editor ══════════════════════════════════════════════ */}
      <ZoneEditor
        open={editorOpen}
        zone={editingZone}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          setEditingZone(null);
          void queryClient.invalidateQueries({ queryKey: ['zones'] });
        }}
        alertCount={alerts.filter((a) => a.zoneId === editingZone?.zoneId).length}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
        title="Delete restricted zone?"
        message={
          <>
            <span className="font-semibold">{pendingDelete?.name}</span> will stop being enforced immediately.
            Alerts already raised against it are retained for the audit trail, but the polygon itself is gone
            and cannot be recovered.
          </>
        }
        confirmLabel="Delete zone"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/* ─────────────────────────── Polygon editor ──────────────────────────── */

function ZoneEditor({
  open,
  zone,
  draft,
  setDraft,
  onClose,
  onSaved,
  alertCount,
}: {
  open: boolean;
  zone: Zone | null;
  draft: LatLng[];
  setDraft: (next: LatLng[]) => void;
  onClose: () => void;
  onSaved: () => void;
  alertCount: number;
}) {
  const toast = useToast();
  const { live } = useRealtime();
  const isEdit = Boolean(zone);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneFormSchema),
    defaultValues: {
      name: '',
      description: '',
      zoneType: 'RESTRICTED_ZONE',
      severity: 'HIGH',
      approachBufferMeters: 500,
      status: 'ENABLED',
    },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      zone
        ? {
            name: zone.name,
            description: zone.description,
            zoneType: zone.zoneType,
            severity: zone.severity,
            approachBufferMeters: zone.approachBufferMeters,
            status: zone.status,
          }
        : {
            name: '',
            description: '',
            zoneType: 'RESTRICTED_ZONE',
            severity: 'HIGH',
            approachBufferMeters: 500,
            status: 'ENABLED',
          },
    );
  }, [open, zone, reset]);

  const onSubmit = async (values: ZoneFormValues) => {
    if (draft.length < 3) {
      toast.warning('Polygon incomplete', 'A zone needs at least three vertices. Click the map to add them.');
      return;
    }
    try {
      if (isEdit && zone) {
        await api.zones.update(zone.zoneId, { ...values, coordinates: draft });
        toast.success('Zone updated', `${values.name} · ${draft.length} vertices`);
      } else {
        const created = await api.zones.create({ ...values, coordinates: draft });
        toast.success('Zone created', `${created.name} is now being enforced.`);
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors();
        let matched = false;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof ZoneFormValues, { message });
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
      title={isEdit ? `Edit zone — ${zone?.name}` : 'Draw a new restricted zone'}
      description="Click the map to add a vertex. Drag a white handle to move it, click a small grey handle to insert one between two vertices."
      size="xl"
      footer={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {isEdit ? 'Save zone' : 'Create zone'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* ── map canvas ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="h-[420px]">
              <LiveMap
                frames={live}
                zones={isEdit && zone ? [] : []}
                selectedVesselId={null}
                onSelectVessel={() => undefined}
                showZones={false}
                showTracks={false}
                draft={draft}
                drawing
                onMapClick={(point) => setDraft([...draft, point])}
                onVertexDrag={(index, point) =>
                  setDraft(draft.map((vertex, i) => (i === index ? point : vertex)))
                }
                onVertexInsert={(index, point) => {
                  const next = [...draft];
                  next.splice(index, 0, point);
                  setDraft(next);
                }}
                className="h-full w-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Undo2 className="h-3.5 w-3.5" />}
              disabled={!draft.length}
              onClick={() => setDraft(draft.slice(0, -1))}
            >
              Undo last vertex
            </Button>
            <Button size="sm" variant="secondary" disabled={!draft.length} onClick={() => setDraft([])}>
              Clear polygon
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDraft(defaultPentagon())}>
              Reset to template
            </Button>
            <Badge
              className={cn(
                'ring-1 ring-inset',
                draft.length >= 3
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200',
              )}
            >
              {draft.length} vertices {draft.length < 3 ? '· need at least 3' : '· valid polygon'}
            </Badge>
          </div>
        </div>

        {/* ── attributes ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Field label="Zone name" error={errors.name?.message} required>
            <Input placeholder="e.g. Harbour Approach North" invalid={Boolean(errors.name)} {...register('name')} />
          </Field>

          <Field label="Zone type" error={errors.zoneType?.message} required>
            <Select {...register('zoneType')}>
              {Object.entries(ZONE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Severity" error={errors.severity?.message} required>
            <Select {...register('severity')}>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </Field>

          <Field
            label="Approach buffer (metres)"
            error={errors.approachBufferMeters?.message}
            hint="Distance from the boundary that raises an 'approaching' warning."
          >
            <Input type="number" step="50" min={50} max={10000} {...register('approachBufferMeters')} />
          </Field>

          <Field label="Description" error={errors.description?.message}>
            <Textarea rows={3} placeholder="Operational purpose, references…" {...register('description')} />
          </Field>

          <Field label="Enforcement" error={errors.status?.message}>
            <Select {...register('status')}>
              <option value="ENABLED">Enabled — evaluate on every position frame</option>
              <option value="DISABLED">Disabled — stored but not enforced</option>
            </Select>
          </Field>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Zone summary
            </p>
            <dl className="mt-1.5 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between">
                <dt>Vertices</dt>
                <dd className="tnum font-medium">{draft.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Centroid</dt>
                <dd className="tnum font-mono text-[11px]">
                  {draft.length
                    ? `${(draft.reduce((s, v) => s + v.lat, 0) / draft.length).toFixed(4)}, ${(
                        draft.reduce((s, v) => s + v.lng, 0) / draft.length
                      ).toFixed(4)}`
                    : '—'}
                </dd>
              </div>
              {isEdit ? (
                <>
                  <div className="flex justify-between">
                    <dt>Alerts raised</dt>
                    <dd className="tnum font-medium">{alertCount}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Created</dt>
                    <dd className="font-medium">{timeAgo(zone?.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Created by</dt>
                    <dd className="truncate font-medium">{zone?.createdBy}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-700">
              <Layers className="h-3 w-3" /> How enforcement works
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-900/80">
              Every accepted position is tested against this ring. A contact outside the buffer is
              <span className="font-semibold"> NORMAL</span>; inside the buffer it is
              <span className="font-semibold"> WARNING</span>; inside the polygon an authorized vessel
              logs <span className="font-semibold">AUTHORIZED_ENTRY</span> and an unauthorized one raises an
              <span className="font-semibold"> INTRUSION</span> alert plus an incident.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

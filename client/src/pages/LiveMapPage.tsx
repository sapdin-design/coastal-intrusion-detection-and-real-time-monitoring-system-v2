import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Crosshair,
  Eye,
  EyeOff,
  Hexagon,
  Layers,
  ListFilter,
  Maximize2,
  Minimize2,
  Route,
  Ship,
  SlidersHorizontal,
  Video,
} from 'lucide-react';
import { api } from '@/lib/api';
import { TILE_LAYERS, TRACK_LIMIT, type TileLayerKey } from '@/lib/constants';
import {
  cn,
  formatDistance,
  formatHeading,
  formatSpeed,
  timeAgo,
  vesselStatusClasses,
} from '@/lib/format';
import { useRealtime } from '@/store/realtime';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  SearchInput,
  SectionLabel,
  Tabs,
  Toggle,
} from '@/components/ui';
import { LiveMap } from '@/components/map/LiveMap';
import { MapLegend } from '@/components/map/MapLegend';
import { VesselDetailPanel } from '@/components/map/VesselDetailPanel';
import type { LocationBroadcast } from '@/types';

type StatusFilter = 'ALL' | 'ACTIVE' | 'WARNING' | 'INTRUSION' | 'OFFLINE' | 'UNAUTHORIZED';

/**
 * Full-screen live monitoring console (spec §7).
 *
 * Three coordinated surfaces: a filterable contact list on the left, the map in the
 * centre, and the vessel information panel on the right. Selection is shared, so
 * clicking a row flies the map to that contact and vice-versa — the two views are
 * never out of sync.
 */
export function LiveMapPage() {
  const { live, zones, vessels, alerts, connection } = useRealtime();

  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [showZones, setShowZones] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [followSelected, setFollowSelected] = useState(false);
  const [tileLayer, setTileLayer] = useState<TileLayerKey>('standard');
  const [fitToken, setFitToken] = useState(0);
  const [listOpen, setListOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const frames = useMemo(() => Object.values(live), [live]);
  const zoneList = useMemo(() => Object.values(zones), [zones]);

  const track = useQuery({
    queryKey: ['track', selected],
    queryFn: () => api.telemetry.track(selected!, TRACK_LIMIT),
    enabled: Boolean(selected) && showTracks,
    refetchInterval: 5000,
  });

  const vesselStats = useQuery({
    queryKey: ['vessel-stats', selected],
    queryFn: () => api.vessels.stats(selected!),
    enabled: Boolean(selected),
  });

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      ALL: frames.length,
      ACTIVE: 0,
      WARNING: 0,
      INTRUSION: 0,
      OFFLINE: 0,
      UNAUTHORIZED: 0,
    };
    for (const frame of frames) {
      base[frame.status as StatusFilter] = (base[frame.status as StatusFilter] ?? 0) + 1;
      if (frame.authorizationStatus === 'UNAUTHORIZED') base.UNAUTHORIZED += 1;
    }
    return base;
  }, [frames]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return frames
      .filter((frame) => {
        if (statusFilter === 'UNAUTHORIZED') return frame.authorizationStatus === 'UNAUTHORIZED';
        if (statusFilter !== 'ALL' && frame.status !== statusFilter) return false;
        return true;
      })
      .filter((frame) =>
        needle
          ? frame.name.toLowerCase().includes(needle) || frame.vesselId.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => {
        const rank = (frame: LocationBroadcast) =>
          frame.status === 'INTRUSION' ? 0 : frame.status === 'WARNING' ? 1 : frame.status === 'OFFLINE' ? 3 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
  }, [frames, statusFilter, search]);

  const selectedFrame = selected ? live[selected] : undefined;

  return (
    <div className={cn('flex flex-col gap-3 p-4', fullscreen && 'fixed inset-0 z-40 bg-slate-100 p-2')}>
      {/* ══ toolbar ═════════════════════════════════════════════════════ */}
      <Card className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <IconButton
            label={listOpen ? 'Hide contact list' : 'Show contact list'}
            icon={listOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            onClick={() => setListOpen((prev) => !prev)}
          />
          <span className="text-[13px] font-semibold text-slate-700">
            {counts.ALL} contacts
          </span>
          <Badge
            className={cn(
              'ring-1 ring-inset',
              connection === 'connected'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-amber-50 text-amber-800 ring-amber-200',
            )}
          >
            {connection}
          </Badge>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

        <Tabs
          value={statusFilter}
          onChange={setStatusFilter}
          size="sm"
          options={[
            { value: 'ALL', label: 'All', count: counts.ALL },
            { value: 'INTRUSION', label: 'Intrusion', count: counts.INTRUSION },
            { value: 'WARNING', label: 'Approaching', count: counts.WARNING },
            { value: 'UNAUTHORIZED', label: 'Unauthorized', count: counts.UNAUTHORIZED },
            { value: 'OFFLINE', label: 'Offline', count: counts.OFFLINE },
          ]}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or ID…" className="w-48" />

          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <Layers className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
            {(Object.keys(TILE_LAYERS) as TileLayerKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTileLayer(key)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  tileLayer === key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {TILE_LAYERS[key].label}
              </button>
            ))}
          </div>

          <IconButton
            label="Fit map to fleet"
            icon={<Crosshair className="h-4 w-4" />}
            variant="secondary"
            onClick={() => setFitToken((prev) => prev + 1)}
          />
          <IconButton
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            icon={fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            variant="secondary"
            onClick={() => setFullscreen((prev) => !prev)}
          />
        </div>
      </Card>

      {/* ══ map + panels ════════════════════════════════════════════════ */}
      <div className={cn('relative flex gap-3', fullscreen ? 'h-[calc(100vh-5.5rem)]' : 'h-[calc(100vh-13rem)] min-h-[520px]')}>
        {/* ── contact list ────────────────────────────────────────────── */}
        {listOpen ? (
          <Card className="hidden w-[290px] shrink-0 flex-col md:flex">
            <CardHeader
              title="Contacts"
              subtitle={`${filtered.length} of ${counts.ALL} shown`}
              icon={<ListFilter className="h-4 w-4" />}
            />
            <div className="panel-scroll flex-1">
              {filtered.length ? (
                <ul className="divide-y divide-slate-100">
                  {filtered.map((frame) => (
                    <li key={frame.vesselId}>
                      <button
                        type="button"
                        onClick={() => setSelected(frame.vesselId)}
                        className={cn(
                          'w-full px-3 py-2.5 text-left transition-colors hover:bg-slate-50',
                          selected === frame.vesselId && 'bg-brand-50/70',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800">
                            {frame.name}
                          </span>
                          <Badge className={vesselStatusClasses[frame.status]}>{frame.status}</Badge>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] text-slate-400">
                            {frame.vesselId}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {timeAgo(frame.lastSeen)}
                          </span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-slate-500">
                          <span>{formatSpeed(frame.speed)}</span>
                          <span className="truncate text-center">{formatHeading(frame.direction)}</span>
                          <span className="truncate text-right">
                            {frame.state === 'INSIDE'
                              ? 'Inside zone'
                              : frame.nearestDistanceMeters !== null
                                ? formatDistance(frame.nearestDistanceMeters)
                                : '—'}
                          </span>
                        </div>
                        {frame.nearestZone ? (
                          <p className="mt-1 truncate text-[10px] text-slate-400">
                            <Hexagon className="mr-0.5 inline h-2.5 w-2.5" />
                            {frame.nearestZone}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No contacts match"
                  description="Adjust the filter or start the GPS simulator."
                  icon={<Ship className="h-5 w-5" />}
                />
              )}
            </div>
            <div className="border-t border-slate-200 p-3">
              <SectionLabel className="mb-2">Map layers</SectionLabel>
              <div className="space-y-2">
                <Toggle checked={showZones} onChange={setShowZones} label="Restricted zones" />
                <Toggle checked={showTracks} onChange={setShowTracks} label="Route history" />
                <Toggle
                  checked={followSelected}
                  onChange={setFollowSelected}
                  label="Follow selected"
                  description="Centre the map on the selected contact"
                />
              </div>
            </div>
          </Card>
        ) : null}

        {/* ── map ─────────────────────────────────────────────────────── */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 shadow-card">
          <LiveMap
            frames={live}
            zones={zoneList}
            selectedVesselId={selected}
            onSelectVessel={setSelected}
            track={track.data ?? []}
            showTracks={showTracks}
            showZones={showZones}
            tileLayer={tileLayer}
            followSelected={followSelected}
            fitToken={fitToken}
            className="h-full w-full"
            overlay={
              <>
                <div className="pointer-events-none absolute left-3 top-3 z-[500] hidden lg:block">
                  <MapLegend />
                </div>
                {track.isLoading && selected ? (
                  <div className="absolute right-3 top-3 z-[500]">
                    <Badge className="bg-white/95 text-slate-600 ring-1 ring-inset ring-slate-200">
                      <Route className="h-3 w-3" /> Loading route…
                    </Badge>
                  </div>
                ) : null}
                {fullscreen ? (
                  <div className="absolute right-3 top-3 z-[500]">
                    <Button size="xs" variant="secondary" onClick={() => setFullscreen(false)}>
                      Exit fullscreen
                    </Button>
                  </div>
                ) : null}
              </>
            }
          />
        </div>

        {/* ── vessel detail ───────────────────────────────────────────── */}
        {selectedFrame ? (
          <Card className="hidden w-[330px] shrink-0 flex-col overflow-hidden lg:flex">
            <VesselDetailPanel
              frame={selectedFrame}
              vessel={vessels[selected!]}
              stats={vesselStats.data}
              trackPoints={track.data?.length}
              alerts={alerts.filter((a) => a.vesselId === selected)}
              onClose={() => setSelected(null)}
              onFocus={() => setFollowSelected(true)}
            />
          </Card>
        ) : (
          <Card className="hidden w-[330px] shrink-0 lg:flex">
            <CardHeader title="Vessel information" subtitle="Select a contact on the map" icon={<SlidersHorizontal className="h-4 w-4" />} />
            <EmptyState
              title="No contact selected"
              description="Click a vessel marker or a row in the contact list to inspect its telemetry, zone context and history."
              icon={<Video className="h-5 w-5" />}
            />
          </Card>
        )}
      </div>

      {/* Compact drawer for narrow screens */}
      {selectedFrame ? (
        <Card className="lg:hidden">
          <CardHeader title={selectedFrame.name} subtitle={selectedFrame.vesselId} icon={<Ship className="h-4 w-4" />} />
          <div className="max-h-[420px] overflow-y-auto">
            <VesselDetailPanel
              frame={selectedFrame}
              vessel={vessels[selected!]}
              stats={vesselStats.data}
              alerts={alerts.filter((a) => a.vesselId === selected)}
              onClose={() => setSelected(null)}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { TILE_LAYERS, THEATRE, COASTLINE, type TileLayerKey } from '@/lib/constants';
import { formatDistance, formatHeading, formatSpeed, timeAgo, zoneSeverityHex } from '@/lib/format';
import type { LatLng, LocationBroadcast, TrackPoint, Zone } from '@/types';
import { vesselIcon, vertexIcon } from './vesselIcon';

export interface LiveMapProps {
  frames: Record<string, LocationBroadcast>;
  zones: Zone[];
  selectedVesselId: string | null;
  onSelectVessel: (vesselId: string | null) => void;
  track?: TrackPoint[];
  showTracks?: boolean;
  showZones?: boolean;
  tileLayer?: TileLayerKey;
  followSelected?: boolean;
  /** In-progress polygon while the zone editor is drawing. */
  draft?: LatLng[];
  /** When true, map clicks append to the draft instead of selecting vessels. */
  drawing?: boolean;
  onMapClick?: (point: LatLng) => void;
  onVertexDrag?: (index: number, point: LatLng) => void;
  onVertexInsert?: (index: number, point: LatLng) => void;
  /** Increment to re-frame the whole fleet (the "fit to fleet" control). */
  fitToken?: number;
  className?: string;
  /** Rendered inside the map container, above the tiles (legend, controls). */
  overlay?: React.ReactNode;
}

/** Imperative helpers that need access to the Leaflet map instance. */
function MapController({
  selectedFrame,
  followSelected,
  frames,
  drawing,
  onMapClick,
  fitToken = 0,
}: {
  selectedFrame?: LocationBroadcast;
  followSelected: boolean;
  frames: Record<string, LocationBroadcast>;
  drawing: boolean;
  onMapClick?: (point: LatLng) => void;
  fitToken?: number;
}) {
  const map = useMap();
  const first = useRef(true);
  const lastFitToken = useRef(fitToken);

  useMapEvents({
    click(event) {
      if (drawing && onMapClick) onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  const fitFleet = () => {
    const points = Object.values(frames);
    if (!points.length) return;
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])).pad(0.25),
      { animate: true },
    );
  };

  // Frame the whole fleet once, the first time positions arrive.
  useEffect(() => {
    const points = Object.values(frames);
    if (!first.current || points.length === 0) return;
    first.current = false;
    fitFleet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, map]);

  // Manual re-frame requested from the toolbar.
  useEffect(() => {
    if (lastFitToken.current === fitToken) return;
    lastFitToken.current = fitToken;
    fitFleet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  // Optional follow-cam on the selected vessel.
  useEffect(() => {
    if (!followSelected || !selectedFrame) return;
    map.panTo([selectedFrame.latitude, selectedFrame.longitude], { animate: true, duration: 0.4 });
  }, [followSelected, selectedFrame, map]);

  return null;
}

/**
 * The live monitoring map (spec §7).
 *
 * Renders four independent layers:
 *   1. restricted zones — severity-coloured polygons with a soft halo band that
 *      visualises the approach buffer, plus a permanent tooltip with the name;
 *   2. vessel markers — heading-rotated arrows, coloured by status, with a pulse
 *      ring on intrusion or approach;
 *   3. the selected vessel's route history, drawn from the track API;
 *   4. the in-progress polygon while an administrator is drawing a new zone.
 */
export function LiveMap({
  frames,
  zones,
  selectedVesselId,
  onSelectVessel,
  track = [],
  showTracks = true,
  showZones = true,
  tileLayer = 'standard',
  followSelected = false,
  draft = [],
  drawing = false,
  onMapClick,
  onVertexDrag,
  onVertexInsert,
  fitToken = 0,
  className,
  overlay,
}: LiveMapProps) {
  const tiles = TILE_LAYERS[tileLayer] ?? TILE_LAYERS.standard;
  const framesArray = useMemo(() => Object.values(frames), [frames]);
  const selectedFrame = selectedVesselId ? frames[selectedVesselId] : undefined;

  const trackPath = useMemo(
    () => track.map((point) => [point.lat, point.lng] as [number, number]),
    [track],
  );

  return (
    <div className={className ?? 'h-full w-full'}>
      <MapContainer
        center={THEATRE.center}
        zoom={THEATRE.defaultZoom}
        maxZoom={THEATRE.maxZoom}
        minZoom={4}
        zoomControl={false}
        attributionControl
        preferCanvas
        className="h-full w-full"
      >
        <TileLayer
          url={tiles.url}
          attribution={tiles.attribution}
          maxZoom={tiles.maxZoom}
          // Keep tiles readable under the operational overlay colours.
          className="map-tiles"
        />

        <MapController
          frames={frames}
          selectedFrame={selectedFrame}
          followSelected={followSelected}
          drawing={drawing}
          onMapClick={onMapClick}
          fitToken={fitToken}
        />

        {/* ── coastal boundary ─────────────────────────────────────────── */}
        {showZones ? (
          <>
            {/* Soft landward wash so the coastline reads as a shore, not a line. */}
            <Polyline
              positions={COASTLINE}
              pane="overlayPane"
              pathOptions={{
                color: '#0f172a',
                weight: 14,
                opacity: 0.06,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            >
              {null}
            </Polyline>
            {/* The trace itself. */}
            <Polyline
              positions={COASTLINE}
              pane="overlayPane"
              pathOptions={{
                color: '#0f172a',
                weight: 2,
                opacity: 0.55,
                dashArray: '1 0',
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            >
              <Tooltip sticky direction="top" className="zone-tooltip">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-800">{THEATRE.name}</div>
                  <div className="text-[10px] text-slate-500">
                    Coastal boundary · schematic trace, not for navigation
                  </div>
                </div>
              </Tooltip>
            </Polyline>
          </>
        ) : null}

        {/* ── restricted zones ─────────────────────────────────────────── */}
        {showZones
          ? zones.map((zone) => {
              const color = zoneSeverityHex[zone.severity] ?? '#38bdf8';
              const disabled = zone.status === 'DISABLED';
              const path = zone.coordinates.map((c) => [c.lat, c.lng] as [number, number]);

              return (
                <Polygon
                  key={`halo-${zone.zoneId}`}
                  positions={path}
                  pane="overlayPane"
                  pathOptions={{
                    color,
                    weight: Math.max(10, Math.min(22, zone.approachBufferMeters / 40)),
                    opacity: disabled ? 0.04 : 0.13,
                    fill: false,
                    lineCap: 'round',
                  }}
                  interactive={false}
                >
                  {null}
                </Polygon>
              );
            })
          : null}

        {showZones
          ? zones.map((zone) => {
              const color = zoneSeverityHex[zone.severity] ?? '#38bdf8';
              const disabled = zone.status === 'DISABLED';
              const path = zone.coordinates.map((c) => [c.lat, c.lng] as [number, number]);

              return (
                <Polygon
                  key={zone.zoneId}
                  positions={path}
                  pathOptions={{
                    color,
                    weight: disabled ? 1.5 : 2.5,
                    opacity: disabled ? 0.45 : 0.95,
                    dashArray: disabled ? '6 6' : undefined,
                    fill: true,
                    fillColor: color,
                    fillOpacity: disabled ? 0.04 : 0.14,
                  }}
                >
                  <Tooltip sticky direction="top" className="zone-tooltip">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-800">{zone.name}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        {zone.zoneType.replace(/_/g, ' ')} · {zone.severity}
                        {disabled ? ' · DISABLED' : ''}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Approach buffer {zone.approachBufferMeters} m
                      </div>
                    </div>
                  </Tooltip>
                </Polygon>
              );
            })
          : null}

        {/* ── selected vessel route history ────────────────────────────── */}
        {showTracks && trackPath.length > 1 ? (
          <>
            <Polyline
              positions={trackPath}
              pathOptions={{ color: '#1d5a92', weight: 5, opacity: 0.16, lineCap: 'round' }}
            />
            <Polyline
              positions={trackPath}
              pathOptions={{
                color: '#2b72ad',
                weight: 2,
                opacity: 0.85,
                dashArray: '5 6',
                lineCap: 'round',
              }}
            />
          </>
        ) : null}

        {/* ── draft polygon while drawing a zone ───────────────────────── */}
        {draft.length > 1 ? (
          <Polygon
            positions={draft.map((c) => [c.lat, c.lng] as [number, number])}
            pathOptions={{
              color: '#1d5a92',
              weight: 2,
              dashArray: '5 5',
              fill: true,
              fillColor: '#2b72ad',
              fillOpacity: 0.15,
            }}
          />
        ) : null}

        {draft.map((vertex, index) => (
          <Marker
            key={`vertex-${index}-${vertex.lat}-${vertex.lng}`}
            position={[vertex.lat, vertex.lng]}
            icon={vertexIcon('vertex')}
            draggable={Boolean(onVertexDrag)}
            eventHandlers={{
              dragend: (event) => {
                const position = (event.target as L.Marker).getLatLng();
                onVertexDrag?.(index, { lat: position.lat, lng: position.lng });
              },
            }}
          />
        ))}

        {draft.length > 2
          ? draft.map((vertex, index) => {
              const next = draft[(index + 1) % draft.length];
              const midpoint = { lat: (vertex.lat + next.lat) / 2, lng: (vertex.lng + next.lng) / 2 };
              return (
                <Marker
                  key={`mid-${index}-${midpoint.lat}-${midpoint.lng}`}
                  position={[midpoint.lat, midpoint.lng]}
                  icon={vertexIcon('midpoint')}
                  eventHandlers={{ click: () => onVertexInsert?.(index + 1, midpoint) }}
                />
              );
            })
          : null}

        {/* ── vessel markers ───────────────────────────────────────────── */}
        {framesArray.map((frame) => (
          <Marker
            key={frame.vesselId}
            position={[frame.latitude, frame.longitude]}
            icon={vesselIcon(frame, frame.vesselId === selectedVesselId)}
            zIndexOffset={frame.status === 'INTRUSION' ? 1000 : frame.vesselId === selectedVesselId ? 500 : 0}
            eventHandlers={{ click: () => onSelectVessel(frame.vesselId) }}
          >
            <Tooltip direction="top" offset={[0, -14]} opacity={1}>
              <div className="min-w-[168px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">{frame.name}</span>
                  <span
                    className="rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                    style={{
                      background:
                        frame.status === 'INTRUSION'
                          ? '#fee2e2'
                          : frame.status === 'WARNING'
                            ? '#fef3c7'
                            : frame.status === 'OFFLINE'
                              ? '#e2e8f0'
                              : '#d1fae5',
                      color:
                        frame.status === 'INTRUSION'
                          ? '#b91c1c'
                          : frame.status === 'WARNING'
                            ? '#92400e'
                            : frame.status === 'OFFLINE'
                              ? '#475569'
                              : '#047857',
                    }}
                  >
                    {frame.status}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-500">{frame.vesselId}</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-600">
                  <span>Speed</span>
                  <span className="text-right font-medium">{formatSpeed(frame.speed)}</span>
                  <span>Heading</span>
                  <span className="text-right font-medium">{formatHeading(frame.direction)}</span>
                  <span>Auth</span>
                  <span className="text-right font-medium">
                    {frame.authorizationStatus === 'AUTHORIZED' ? 'Authorized' : 'Unauthorized'}
                  </span>
                  <span>Seen</span>
                  <span className="text-right font-medium">{timeAgo(frame.lastSeen)}</span>
                </div>
                {frame.nearestZone ? (
                  <div className="border-t border-slate-200 pt-1 text-[10px] text-slate-500">
                    {frame.state === 'INSIDE' ? 'Inside' : 'Nearest'}:{' '}
                    <span className="font-medium text-slate-700">{frame.nearestZone}</span>
                    {frame.state === 'APPROACHING' && frame.nearestDistanceMeters !== null
                      ? ` · ${formatDistance(frame.nearestDistanceMeters)}`
                      : ''}
                  </div>
                ) : null}
              </div>
            </Tooltip>
          </Marker>
        ))}

        {/* Selected vessel gets an accuracy-style halo for quick re-acquisition. */}
        {selectedFrame ? (
          <Marker
            position={[selectedFrame.latitude, selectedFrame.longitude]}
            icon={L.divIcon({
              html: `<div style="width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:9999px;border:2px dashed rgba(29,90,146,.7)"></div>`,
              className: '',
              iconSize: [56, 56],
            })}
            interactive={false}
            zIndexOffset={-1}
          />
        ) : null}
      </MapContainer>
      {overlay}
    </div>
  );
}

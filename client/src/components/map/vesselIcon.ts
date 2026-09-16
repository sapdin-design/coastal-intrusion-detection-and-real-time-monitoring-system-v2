import L from 'leaflet';
import { vesselStatusHex } from '@/lib/format';
import type { GeofenceVerdict, LocationBroadcast, VesselStatus } from '@/types';

/**
 * Vessel marker factory.
 *
 * Markers are built with `L.divIcon` and inline SVG instead of Leaflet's default
 * PNG pins. Two reasons: bundlers famously break the default marker image paths,
 * and a div icon lets each vessel carry its own status colour, heading rotation
 * and intrusion pulse ring without shipping a sprite sheet.
 *
 * Icon instances are cached per (status, heading bucket, selected, verdict) tuple —
 * rebuilding an icon for 20 vessels on every animation frame is pure waste.
 */
const cache = new Map<string, L.DivIcon>();

const HEADING_BUCKET = 10;

export function vesselIcon(
  frame: Pick<LocationBroadcast, 'status' | 'direction' | 'authorizationStatus' | 'verdict'>,
  selected = false,
): L.DivIcon {
  const heading = Math.round((frame.direction ?? 0) / HEADING_BUCKET) * HEADING_BUCKET;
  const key = `${frame.status}|${heading}|${frame.authorizationStatus}|${frame.verdict}|${selected}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const color = vesselStatusHex[frame.status as VesselStatus] ?? '#64748b';
  const isIntrusion = frame.status === 'INTRUSION' || frame.verdict === 'INTRUSION';
  const isWarning = frame.status === 'WARNING' || frame.verdict === 'WARNING';

  // Unauthorized contacts get a white chevron outline so they read differently
  // from authorized traffic even when both are in the ACTIVE state.
  const strokeColor = frame.authorizationStatus === 'UNAUTHORIZED' ? '#ffffff' : 'rgba(255,255,255,0.85)';
  const shape =
    frame.authorizationStatus === 'UNAUTHORIZED'
      ? '<path d="M12 2.5 21.5 21H2.5z" fill="currentColor" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>'
      : '<path d="M12 2.5 20 21l-8-4.6L4 21z" fill="currentColor" stroke="' +
        strokeColor +
        '" stroke-width="1.1" stroke-linejoin="round"/>';

  const ring = isIntrusion
    ? '<span class="vessel-marker__ring" style="background:rgba(220,38,38,0.35)"></span>'
    : isWarning
      ? '<span class="vessel-marker__ring" style="background:rgba(217,119,6,0.28);animation-duration:2.6s"></span>'
      : '';

  const html = `
    <div class="vessel-marker${selected ? ' vessel-marker--selected' : ''}">
      ${ring}
      <div class="vessel-marker__glyph" style="background:${color}">
        <svg viewBox="0 0 24 24" width="16" height="16" style="transform:rotate(${heading}deg);color:#fff">
          ${shape}
        </svg>
      </div>
    </div>`;

  const icon = L.divIcon({
    html,
    className: 'vessel-marker-wrapper',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    tooltipAnchor: [0, -16],
  });

  cache.set(key, icon);
  return icon;
}

/** Small square handle used for polygon vertices in the zone drawing editor. */
export function vertexIcon(kind: 'vertex' | 'midpoint' = 'vertex'): L.DivIcon {
  return L.divIcon({
    html: `<div class="vertex-handle${kind === 'midpoint' ? ' vertex-handle--mid' : ''}"></div>`,
    className: 'vertex-wrapper',
    iconSize: kind === 'vertex' ? [14, 14] : [9, 9],
    iconAnchor: kind === 'vertex' ? [7, 7] : [4.5, 4.5],
  });
}

export const VERDICT_LABELS: Record<GeofenceVerdict, string> = {
  NORMAL: 'Normal',
  WARNING: 'Approaching',
  AUTHORIZED_ENTRY: 'Authorized transit',
  INTRUSION: 'Intrusion',
};

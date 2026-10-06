import L from 'leaflet';
import { vesselStatusHex } from '@/lib/format';
import type { GeofenceVerdict, LocationBroadcast, VesselStatus, VesselType } from '@/types';

/**
 * Vessel marker factory.
 *
 * Markers are built with `L.divIcon` and inline SVG rather than Leaflet's default
 * PNG pins: bundlers famously break the default marker image paths, and a div
 * icon lets each vessel carry its own hull shape, status colour, heading rotation
 * and intrusion ring without shipping a sprite sheet.
 *
 * **The hulls are drawn in plan view, bow pointing up.** That matters because the
 * marker is rotated by the vessel's heading — a side-on boat silhouette rotated
 * 90° reads as a capsized boat, whereas a plan-view hull simply points east. Each
 * class gets a shape an operator can tell apart at sector zoom:
 *
 *   fishing boat  — short hull, wheelhouse aft
 *   patrol boat   — sharp bow, wheelhouse amidships, radar dome
 *   cargo ship    — long slab sides, stacked container blocks
 *   passenger     — full-length deck with a row of windows
 *   unknown       — narrow double-ended speedboat
 *
 * Icon instances are cached per (type, status, heading bucket, authorization,
 * verdict, selected) tuple — rebuilding an icon for 20 vessels on every animation
 * frame is pure waste.
 */
const cache = new Map<string, L.DivIcon>();

const HEADING_BUCKET = 10;

interface Hull {
  /** Outer hull outline, filled with the status colour. */
  body: string;
  /** Superstructure, drawn over the hull in a translucent white. */
  detail: string;
}

/** Exported so the legend can draw the same silhouettes the map uses. */
export const VESSEL_HULLS: Record<VesselType, Hull> = {
  FISHING_BOAT: {
    body: 'M12 2.2 L16.2 8.2 L16.2 19.4 Q12 21.6 7.8 19.4 L7.8 8.2 Z',
    detail: 'M10.2 13.1 h3.6 v4.3 h-3.6 Z',
  },
  PATROL_BOAT: {
    body: 'M12 1.5 L16.7 7.4 L16.1 20.3 Q12 22.5 7.9 20.3 L7.3 7.4 Z',
    detail: 'M10.1 10.7 h3.8 v5.3 h-3.8 Z M12 8.4 a1.15 1.15 0 1 0 0.01 0 Z',
  },
  CARGO_SHIP: {
    body: 'M12 2.6 L17.3 5.5 L17.3 21.2 L6.7 21.2 L6.7 5.5 Z',
    detail:
      'M8.5 8.1 h3 v2.7 h-3 Z M12.5 8.1 h3 v2.7 h-3 Z M8.5 12.2 h3 v2.7 h-3 Z M12.5 12.2 h3 v2.7 h-3 Z',
  },
  PASSENGER_BOAT: {
    body: 'M12 2.2 L16.5 7.2 L16.5 19.7 Q12 21.9 7.5 19.7 L7.5 7.2 Z',
    detail:
      'M9.5 9.7 h5 v7.5 h-5 Z M10.4 11.4 a0.6 0.6 0 1 0 0.01 0 Z M13.6 11.4 a0.6 0.6 0 1 0 0.01 0 Z ' +
      'M10.4 14.2 a0.6 0.6 0 1 0 0.01 0 Z M13.6 14.2 a0.6 0.6 0 1 0 0.01 0 Z',
  },
  UNKNOWN: {
    body: 'M12 1.5 L15.5 9.4 L14.3 20.5 L9.7 20.5 L8.5 9.4 Z',
    detail: 'M10.6 11.1 h2.8 v4.1 h-2.8 Z',
  },
};

export function vesselIcon(
  frame: Pick<
    LocationBroadcast,
    'status' | 'direction' | 'authorizationStatus' | 'verdict' | 'vesselType'
  >,
  selected = false,
): L.DivIcon {
  const heading = Math.round((frame.direction ?? 0) / HEADING_BUCKET) * HEADING_BUCKET;
  const vesselType: VesselType = frame.vesselType ?? 'UNKNOWN';
  const key = `${vesselType}|${frame.status}|${heading}|${frame.authorizationStatus}|${frame.verdict}|${selected}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const color = vesselStatusHex[frame.status as VesselStatus] ?? '#64748b';
  const isIntrusion = frame.status === 'INTRUSION' || frame.verdict === 'INTRUSION';
  const isWarning = frame.status === 'WARNING' || frame.verdict === 'WARNING';
  const isOffline = frame.status === 'OFFLINE';
  const unauthorized = frame.authorizationStatus === 'UNAUTHORIZED';

  const hull = VESSEL_HULLS[vesselType] ?? VESSEL_HULLS.UNKNOWN;

  // Only genuine events get a ring, and only an intrusion pulses hard. If every
  // marker animated, none of them would draw the eye.
  const ring = isIntrusion
    ? '<span class="vessel-marker__ring vessel-marker__ring--critical"></span>'
    : isWarning
      ? '<span class="vessel-marker__ring vessel-marker__ring--warning"></span>'
      : '';

  // Authorized / unauthorized is a separate axis from state, so it gets its own
  // small badge rather than recolouring the hull.
  const badge = isOffline
    ? ''
    : `<span class="vessel-marker__badge" style="background:${
        unauthorized ? '#dc2626' : '#16a34a'
      }" title="${unauthorized ? 'Unauthorized' : 'Authorized'}"></span>`;

  const html = `
    <div class="vessel-marker${selected ? ' vessel-marker--selected' : ''}${
      isIntrusion ? ' vessel-marker--intrusion' : ''
    }${isOffline ? ' vessel-marker--offline' : ''}">
      ${ring}
      <div class="vessel-marker__hull" style="color:${color}">
        <svg viewBox="0 0 24 24" width="22" height="22" style="transform:rotate(${heading}deg)">
          <path d="${hull.body}" fill="currentColor" stroke="rgba(15,23,42,0.85)" stroke-width="1" stroke-linejoin="round"/>
          <path d="${hull.detail}" fill="rgba(255,255,255,0.82)"/>
        </svg>
      </div>
      ${badge}
    </div>`;

  const icon = L.divIcon({
    html,
    className: 'vessel-marker-wrapper',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    tooltipAnchor: [0, -18],
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

/** Human label for each hull class — used by the legend and the vessel popup. */
export const VESSEL_TYPE_NAMES: Record<VesselType, string> = {
  FISHING_BOAT: 'Fishing Boat',
  PATROL_BOAT: 'Patrol Boat',
  CARGO_SHIP: 'Cargo Ship',
  PASSENGER_BOAT: 'Passenger Boat',
  UNKNOWN: 'Unknown Craft',
};

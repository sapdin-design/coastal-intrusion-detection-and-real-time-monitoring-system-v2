import { useState } from 'react';
import { Layers, X } from 'lucide-react';
import { cn } from '@/lib/format';
import type { VesselType } from '@/types';
import { VESSEL_HULLS, VESSEL_TYPE_NAMES } from './vesselIcon';

const VESSEL_STATES = [
  { label: 'Authorized', color: '#059669', hint: 'Valid authorization' },
  { label: 'Approaching', color: '#d97706', hint: 'Inside zone buffer' },
  { label: 'Intrusion', color: '#dc2626', hint: 'Unauthorized inside zone' },
  { label: 'Offline', color: '#64748b', hint: 'Telemetry lost' },
];

const ZONE_STATES = [
  { label: 'Low', color: '#38bdf8' },
  { label: 'Medium', color: '#fbbf24' },
  { label: 'High', color: '#fb923c' },
  { label: 'Critical', color: '#f43f5e' },
];

/** The classes an operator will actually meet in this sector. */
const HULL_CLASSES: VesselType[] = [
  'FISHING_BOAT',
  'PATROL_BOAT',
  'CARGO_SHIP',
  'PASSENGER_BOAT',
  'UNKNOWN',
];

/** Miniature of a hull silhouette, drawn the same way the map draws it. */
function HullGlyph({ type, color = '#334155' }: { type: VesselType; color?: string }) {
  const hull = VESSEL_HULLS[type];
  if (!hull) return null;
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" style={{ color }} aria-hidden>
      <path d={hull.body} fill="currentColor" stroke="rgba(15,23,42,0.7)" strokeWidth="1" strokeLinejoin="round" />
      <path d={hull.detail} fill="rgba(255,255,255,0.85)" />
    </svg>
  );
}

/**
 * Map legend.
 *
 * Two axes are shown separately because they are independent — a hull shape tells
 * you *what* the contact is, a colour tells you *what it is doing*.
 *
 * Over the map it collapses to a "Legend" chip: the panel is useful, but it sits
 * on top of the plot and a permanently expanded legend hides exactly the contacts
 * an operator is looking for. In the sidebar it stays open — the meaning of a
 * symbol should never require a hover to discover, but neither should it obscure
 * the picture.
 */
export function MapLegend({
  className,
  compact = false,
  collapsible = false,
}: {
  className?: string;
  compact?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);

  if (collapsible && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'pointer-events-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 shadow-raised backdrop-blur transition hover:text-slate-800',
          className,
        )}
      >
        <Layers className="h-3 w-3" />
        Legend
      </button>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-raised backdrop-blur',
        compact ? 'text-[10px]' : 'text-[11px]',
        className,
      )}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mb-2 flex w-full items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition hover:text-slate-700"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            Legend
          </span>
          <X className="h-3 w-3" />
        </button>
      ) : (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Vessel class
        </p>
      )}
      <ul className={cn('gap-x-3 gap-y-1.5', compact ? 'space-y-1.5' : 'grid grid-cols-2')}>
        {HULL_CLASSES.map((type) => (
          <li key={type} className="flex items-center gap-2">
            <HullGlyph type={type} />
            <span className="text-slate-600">{VESSEL_TYPE_NAMES[type]}</span>
          </li>
        ))}
      </ul>

      <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Status
      </p>
      <ul className="space-y-1.5">
        {VESSEL_STATES.map((state) => (
          <li key={state.label} className="flex items-center gap-2">
            <span
              className="legend-dot"
              style={{ backgroundColor: state.color, boxShadow: '0 0 0 2px rgba(255,255,255,1)' }}
            />
            <span className="font-medium text-slate-700">{state.label}</span>
            {!compact ? <span className="text-slate-400">· {state.hint}</span> : null}
          </li>
        ))}
      </ul>

      <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Restricted zone severity
      </p>
      <ul className="grid grid-cols-2 gap-1.5">
        {ZONE_STATES.map((state) => (
          <li key={state.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-4 rounded-sm ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: state.color }}
            />
            <span className="text-slate-600">{state.label}</span>
          </li>
        ))}
      </ul>

      <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Track
      </p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="#2b72ad" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.75" />
          </svg>
          <span className="text-slate-600">Recent track</span>
        </li>
        <li className="flex items-center gap-2">
          <svg width="22" height="6" aria-hidden>
            <line x1="0" y1="3" x2="22" y2="3" stroke="#dc2626" strokeWidth="2.5" />
          </svg>
          <span className="text-slate-600">Intrusion track</span>
        </li>
      </ul>

      {!compact ? (
        <p className="mt-3 border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">
          The soft halo around each polygon is the approach buffer — a contact inside it is
          reported as <span className="font-medium text-amber-700">Approaching</span>. The small dot
          on each marker shows authorization: green authorized, red not.
        </p>
      ) : null}
    </div>
  );
}

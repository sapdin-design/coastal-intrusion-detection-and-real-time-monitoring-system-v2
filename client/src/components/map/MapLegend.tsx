import { cn } from '@/lib/format';

const VESSEL_STATES = [
  { label: 'Authorized', color: '#059669', hint: 'Normal transit' },
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

/**
 * Map legend. Deliberately always visible: in an operations console the meaning of
 * a colour must never require a hover to discover.
 */
export function MapLegend({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white/95 p-3 shadow-raised backdrop-blur',
        compact ? 'text-[10px]' : 'text-[11px]',
        className,
      )}
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Vessel status
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
        Zone severity
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

      {!compact ? (
        <p className="mt-3 border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">
          The soft halo around each polygon is the approach buffer — a contact inside it is
          reported as <span className="font-medium text-amber-700">Approaching</span>.
        </p>
      ) : null}
    </div>
  );
}

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '@/types';

const AXIS_STYLE = {
  fontSize: 11,
  fill: '#64748b',
} as const;

const GRID_STROKE = '#e2e8f0';

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/97 px-3 py-2 shadow-raised backdrop-blur">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-600">{entry.name}</span>
            <span className="tnum ml-auto font-semibold text-slate-800">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Detection activity over time (spec §6.2 — intrusion statistics).
 *
 * Intrusions are drawn as a filled area because the *volume* of confirmed breaches
 * is the number an operator actually reasons about; approaches and incidents sit on
 * top as lines so a spike in one can be read against the others.
 */
export function ActivityTrendChart({
  data,
  height = 260,
  showIncidents = true,
}: {
  data: SeriesPoint[];
  height?: number;
  showIncidents?: boolean;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="intrusionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e11d48" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#e11d48" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="approachFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            axisLine={{ stroke: GRID_STROKE }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={38} />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, paddingTop: 4, color: '#64748b' }}
          />
          <Area
            type="monotone"
            dataKey="approaches"
            name="Zone approaches"
            stroke="#f59e0b"
            strokeWidth={1.6}
            fill="url(#approachFill)"
          />
          <Area
            type="monotone"
            dataKey="intrusions"
            name="Confirmed intrusions"
            stroke="#e11d48"
            strokeWidth={2}
            fill="url(#intrusionFill)"
          />
          {showIncidents ? (
            <Line
              type="monotone"
              dataKey="incidents"
              name="Incidents opened"
              stroke="#7c3aed"
              strokeWidth={1.8}
              dot={false}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Daily intrusion volume — the reporting view. */
export function DailyTrendChart({ data, height = 240 }: { data: SeriesPoint[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={38} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 4, color: '#64748b' }} />
          <Bar dataKey="intrusions" name="Intrusions" fill="#e11d48" radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Bar dataKey="approaches" name="Approaches" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={26} />
          <Bar dataKey="otherAlerts" name="Other alerts" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Fleet average speed over the window — a health signal for the telemetry feed. */
export function SpeedTrendChart({
  data,
  height = 200,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={38} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            name="Avg speed (km/h)"
            stroke="#1d5a92"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

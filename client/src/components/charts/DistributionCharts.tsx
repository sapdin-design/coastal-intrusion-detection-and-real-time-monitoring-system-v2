import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ALERT_TYPE_LABELS, VESSEL_TYPE_LABELS } from '@/lib/constants';
import { CHART_COLORS, severityHex } from '@/lib/format';
import type { AlertType, Severity } from '@/types';

const AXIS_STYLE = { fontSize: 11, fill: '#64748b' } as const;
const GRID_STROKE = '#e2e8f0';

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}

function DonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const value = Number(entry.value ?? 0);
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/97 px-3 py-2 shadow-raised">
      <p className="text-xs font-semibold text-slate-800">{entry.name}</p>
      <p className="tnum text-[11px] text-slate-500">
        {value} · {pct}%
      </p>
    </div>
  );
}

/** Severity breakdown of all alerts, as a donut with a centred total. */
export function SeverityDonut({
  data,
  height = 220,
}: {
  data: Array<{ severity: Severity; count: number }>;
  height?: number;
}) {
  const total = data.reduce((sum, entry) => sum + entry.count, 0);
  const chartData = data.map((entry) => ({
    name: entry.severity,
    value: entry.count,
    fill: severityHex[entry.severity],
  }));

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="#ffffff"
            strokeWidth={2}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip total={total} />} />
          <Legend
            iconType="circle"
            iconSize={7}
            layout="vertical"
            align="right"
            verticalAlign="middle"
            wrapperStyle={{ fontSize: 11, color: '#64748b', lineHeight: '18px' }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-2xl font-semibold text-slate-900">{total}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Alerts</span>
      </div>
    </div>
  );
}

/** Alert volume per detection type — horizontal bars read better than labels on an axis. */
export function AlertTypeChart({
  data,
  height = 220,
}: {
  data: Array<{ type: AlertType; count: number }>;
  height?: number;
}) {
  const chartData = data.map((entry) => ({
    name: ALERT_TYPE_LABELS[entry.type] ?? entry.type,
    value: entry.count,
  }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
          <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ ...AXIS_STYLE, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={132}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.12)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const entry = payload[0];
              return (
                <div className="rounded-lg border border-slate-200 bg-white/97 px-3 py-2 shadow-raised">
                  <p className="text-xs font-semibold text-slate-800">{String(entry.payload?.name ?? '')}</p>
                  <p className="tnum text-[11px] text-slate-500">{String(entry.value ?? 0)} events</p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {chartData.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Fleet composition by vessel type. */
export function VesselTypeChart({
  data,
  height = 220,
}: {
  data: Array<{ type: string; count: number }>;
  height?: number;
}) {
  const chartData = data.map((entry) => ({
    name: VESSEL_TYPE_LABELS[entry.type as keyof typeof VESSEL_TYPE_LABELS] ?? entry.type,
    value: entry.count,
  }));

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ ...AXIS_STYLE, fontSize: 10 }}
            axisLine={{ stroke: GRID_STROKE }}
            tickLine={false}
            interval={0}
          />
          <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} allowDecimals={false} width={34} />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.12)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-slate-200 bg-white/97 px-3 py-2 shadow-raised">
                  <p className="text-xs font-semibold text-slate-800">{String(payload[0].payload?.name ?? '')}</p>
                  <p className="tnum text-[11px] text-slate-500">{String(payload[0].value ?? 0)} vessels</p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" fill="#1d5a92" radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-value gauge used for response-rate KPIs. */
export function RateGauge({
  value,
  label,
  color = '#0d9488',
  height = 150,
}: {
  value: number;
  label: string;
  color?: string;
  height?: number;
}) {
  const data = [{ name: label, value: Math.min(100, Math.max(0, value)), fill: color }];
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          innerRadius="68%"
          outerRadius="100%"
          startAngle={210}
          endAngle={-30}
          barSize={12}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#e2e8f0' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-3">
        <span className="tnum text-xl font-semibold text-slate-900">{value.toFixed(1)}%</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      </div>
    </div>
  );
}

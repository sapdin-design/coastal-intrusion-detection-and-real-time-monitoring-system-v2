import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Compass,
  Gauge,
  MapPin,
  Radio,
  Route,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { Badge, Button, DetailRow, ProgressBar, SectionLabel } from '@/components/ui/base';
import { VESSEL_TYPE_NAMES } from './vesselIcon';
import {
  AUTHORIZATION_LABELS,
  VESSEL_TYPE_LABELS,
  VESSEL_STATUS_LABELS,
} from '@/lib/constants';
import {
  cn,
  formatCoord,
  formatDistance,
  formatHeading,
  formatKnots,
  formatNumber,
  formatSpeed,
  timeAgo,
  vesselStatusClasses,
} from '@/lib/format';
import type { Alert, LocationBroadcast, Vessel, VesselStats } from '@/types';

/**
 * Vessel information panel (spec §7).
 *
 * Combines three sources of truth that arrive at different speeds: the realtime
 * frame (sub-second), the vessel record (on mutation) and the aggregated trip
 * statistics (on demand). Keeping them separate means the panel can show live
 * motion without re-fetching the static record.
 */
export function VesselDetailPanel({
  frame,
  vessel,
  stats,
  alerts,
  onClose,
  onFocus,
  trackPoints,
}: {
  frame: LocationBroadcast;
  vessel?: Vessel;
  stats?: VesselStats;
  alerts: Alert[];
  onClose?: () => void;
  onFocus?: () => void;
  trackPoints?: number;
}) {
  const record = vessel;
  const status = frame.status;
  const isIntrusion = status === 'INTRUSION';
  const riskScore = frame.riskScore ?? record?.riskScore ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'border-b px-4 py-3.5',
          isIntrusion ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">
                <span className="font-mono">{frame.vesselCode ?? frame.vesselId}</span> — {frame.name}
              </h3>
              <Badge className={vesselStatusClasses[status]}>
                {VESSEL_STATUS_LABELS[status] ?? status}
              </Badge>
            </div>
            {/* Class, authorization and state on one line — the three things an
                operator needs before reading any numbers. */}
            <p className="mt-0.5 text-[11px] text-slate-500">
              {VESSEL_TYPE_NAMES[frame.vesselType] ?? 'Vessel'} ·{' '}
              {frame.authorizationStatus === 'AUTHORIZED' ? 'Authorized' : 'Unauthorized'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onFocus ? (
              <Button size="xs" variant="secondary" onClick={onFocus} icon={<MapPin className="h-3 w-3" />}>
                Focus
              </Button>
            ) : null}
            {onClose ? (
              <Button size="xs" variant="ghost" onClick={onClose}>
                Close
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge
            className={
              frame.authorizationStatus === 'AUTHORIZED'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
            }
          >
            {frame.authorizationStatus === 'AUTHORIZED' ? (
              <ShieldCheck className="h-3 w-3" />
            ) : (
              <ShieldAlert className="h-3 w-3" />
            )}
            {AUTHORIZATION_LABELS[frame.authorizationStatus]}
          </Badge>
          {frame.verdict !== 'NORMAL' ? (
            <Badge
              className={
                frame.verdict === 'INTRUSION'
                  ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                  : 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
              }
            >
              <AlertTriangle className="h-3 w-3" />
              {frame.verdict.replace(/_/g, ' ')}
            </Badge>
          ) : null}
          {record ? (
            <Badge className="bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
              {VESSEL_TYPE_LABELS[record.vesselType]}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="panel-scroll flex-1 px-4 py-3.5">
        {/* ── telemetry grid ───────────────────────────────────────────── */}
        <SectionLabel className="mb-2">Live telemetry</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Speed"
            value={formatKnots(frame.speed)}
            hint={formatSpeed(frame.speed)}
          />
          <MetricTile
            icon={<Compass className="h-3.5 w-3.5" />}
            label="Heading"
            value={formatHeading(frame.direction)}
          />
          <MetricTile
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Latitude"
            value={formatCoord(frame.latitude, 'lat')}
            mono
          />
          <MetricTile
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Longitude"
            value={formatCoord(frame.longitude, 'lng')}
            mono
          />
          <MetricTile
            icon={<Timer className="h-3.5 w-3.5" />}
            label="Last update"
            value={timeAgo(frame.lastSeen)}
          />
          <MetricTile
            icon={<Radio className="h-3.5 w-3.5" />}
            label="Source"
            value={record?.simulated === false ? 'GNSS device' : 'Simulator'}
          />
        </div>

        {/* ── zone context ─────────────────────────────────────────────── */}
        <SectionLabel className="mb-2 mt-4">Zone context</SectionLabel>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          {frame.nearestZone ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-slate-800">
                  {frame.nearestZone}
                </span>
                <span
                  className={cn(
                    'chip',
                    frame.state === 'INSIDE'
                      ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
                      : frame.state === 'APPROACHING'
                        ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
                  )}
                >
                  {frame.state}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {frame.state === 'INSIDE'
                  ? 'Contact is inside the polygon boundary.'
                  : `Distance to boundary: ${formatDistance(frame.nearestDistanceMeters)}`}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">No active zone contact — vessel is clear of all monitored areas.</p>
          )}
        </div>

        {/* ── risk ─────────────────────────────────────────────────────── */}
        <SectionLabel className="mb-2 mt-4">Risk assessment</SectionLabel>
        <div className="rounded-lg border border-slate-200 px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-500">Composite risk score</span>
            <span className="tnum text-lg font-semibold text-slate-900">{riskScore}</span>
          </div>
          <ProgressBar
            value={riskScore}
            className="mt-2"
            barClassName={riskScore >= 70 ? 'bg-rose-600' : riskScore >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Raised by confirmed intrusions (+12), zone approaches (+4) and decayed on clean transit.
          </p>
        </div>

        {/* ── identity ─────────────────────────────────────────────────── */}
        {record ? (
          <>
            <SectionLabel className="mb-1 mt-4">Registration</SectionLabel>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Registration no." value={record.registrationNumber} mono />
              <DetailRow label="Owner" value={record.owner || '—'} />
              <DetailRow label="Home port" value={record.homePort} />
              <DetailRow label="Type" value={VESSEL_TYPE_LABELS[record.vesselType]} />
              <DetailRow label="Status" value={VESSEL_STATUS_LABELS[record.status] ?? record.status} />
              <DetailRow label="Tracked since" value={timeAgo(record.createdAt)} />
            </dl>
          </>
        ) : null}

        {/* ── trip statistics ──────────────────────────────────────────── */}
        {stats ? (
          <>
            <SectionLabel className="mb-2 mt-4">Trip statistics</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <MetricTile icon={<Route className="h-3.5 w-3.5" />} label="Distance" value={`${formatNumber(stats.distanceKm, 2)} km`} />
              <MetricTile icon={<Activity className="h-3.5 w-3.5" />} label="Avg speed" value={`${formatNumber(stats.averageSpeedKmh, 1)} km/h`} />
              <MetricTile icon={<Gauge className="h-3.5 w-3.5" />} label="Max speed" value={`${formatNumber(stats.maxSpeedKmh, 1)} km/h`} />
              <MetricTile icon={<Radio className="h-3.5 w-3.5" />} label="Positions" value={formatNumber(trackPoints ?? stats.trackPoints)} />
            </div>
          </>
        ) : null}

        {/* ── recent alerts ────────────────────────────────────────────── */}
        <SectionLabel className="mb-2 mt-4">Recent alerts</SectionLabel>
        {alerts.length ? (
          <ul className="space-y-1.5">
            {alerts.slice(0, 5).map((alert) => (
              <li key={alert.alertId} className="rounded-lg border border-slate-200 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {alert.alertType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] text-slate-400">{timeAgo(alert.createdAt)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{alert.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No alerts recorded for this vessel.</p>
        )}
      </div>

      {record ? (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3">
          <Link
            to={`/vessels?vessel=${record.vesselId}`}
            className="btn btn-secondary btn-sm w-full"
          >
            Open full vessel record
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  hint,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Secondary readout, e.g. the same speed in the stored unit. */
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-slate-400">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn('tnum mt-1 truncate text-[13px] font-semibold text-slate-800', mono && 'font-mono text-xs')}>
        {value}
      </p>
      {hint ? <p className="tnum truncate text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

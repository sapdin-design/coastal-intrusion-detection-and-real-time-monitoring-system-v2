import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BellRing,
  Menu,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api } from '@/lib/api';
import { NAV_SECTIONS, THREAT_LEVEL_STYLES } from '@/lib/constants';
import { cn, formatTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useRealtime } from '@/store/realtime';
import { useToast } from '@/store/toast';
import { Badge, Button, StatusDot } from '@/components/ui/base';

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Operations Dashboard', subtitle: 'Fleet posture and live threat picture' },
  '/map': { title: 'Live Monitoring Map', subtitle: 'Vessel tracks, restricted zones and geofence state' },
  '/alerts': { title: 'Alert Console', subtitle: 'Triage and acknowledge detection events' },
  '/incidents': { title: 'Incident Management', subtitle: 'Workflow board for confirmed intrusions' },
  '/vessels': { title: 'Vessel Registry', subtitle: 'Register, authorize and monitor contacts' },
  '/zones': { title: 'Restricted Zones', subtitle: 'Draw and manage coastal geofences' },
  '/simulation': { title: 'GPS Simulator', subtitle: 'Drive the simulated telemetry feed' },
  '/analytics': { title: 'Analytics & Reporting', subtitle: 'Intrusion trends and response metrics' },
  '/settings': { title: 'Settings', subtitle: 'Accounts, system status and data controls' },
};

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const location = useLocation();
  const { canOperate } = useAuth();
  const { stats, alerts, connection, simulation, soundEnabled, setSoundEnabled } = useRealtime();
  const toast = useToast();

  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const meta = PAGE_META[location.pathname] ?? { title: 'CIDRTM', subtitle: 'Coastal monitoring' };
  const newAlerts = alerts.filter((a) => a.status === 'NEW').length;
  const threat = stats?.threatLevel ?? 'LOW';
  const threatStyle = THREAT_LEVEL_STYLES[threat];

  const toggleSimulation = async () => {
    if (!canOperate) {
      toast.warning('Insufficient permissions', 'Starting the simulator requires the Operator or Admin role.');
      return;
    }
    setBusy(true);
    try {
      const running = simulation?.status === 'RUNNING';
      await (running ? api.simulation.pause() : api.simulation.start());
      toast.success(running ? 'Simulation paused' : 'Simulation running');
    } catch (error) {
      toast.error('Simulator control failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-4.5 w-4.5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight text-slate-900">{meta.title}</h1>
        <p className="truncate text-[11px] leading-tight text-slate-500">{meta.subtitle}</p>
      </div>

      {/* ── simulation mode ─────────────────────────────────────────────
          Always visible. This is a software prototype fed by a GPS simulator —
          no radar, AIS, satellite or camera input is involved, and the console
          should never imply otherwise. */}
      <span
        className="hidden rounded-md bg-sky-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700 ring-1 ring-inset ring-sky-200 lg:inline"
        title="Prototype — every position on this console comes from a software GPS simulator, not live sensors."
      >
        Simulation mode
      </span>

      {/* ── threat posture ─────────────────────────────────────────────── */}
      <Badge className={cn('hidden ring-1 ring-inset md:inline-flex', threatStyle.className)}>
        <span className={cn('legend-dot', threatStyle.dot)} />
        {threatStyle.label}
      </Badge>

      {/* ── simulator quick control ────────────────────────────────────── */}
      <div className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 md:flex">
        <StatusDot
          className={
            simulation?.status === 'RUNNING'
              ? 'bg-emerald-500'
              : simulation?.status === 'PAUSED'
                ? 'bg-amber-500'
                : 'bg-slate-400'
          }
          pulse={simulation?.status === 'RUNNING'}
        />
        <span className="text-[11px] font-semibold text-slate-600">
          {simulation?.status ?? 'IDLE'}
          {simulation?.status === 'RUNNING' ? ` · ${simulation.speedMultiplier}×` : ''}
        </span>
        <button
          type="button"
          onClick={() => void toggleSimulation()}
          disabled={busy}
          title={simulation?.status === 'RUNNING' ? 'Pause simulation' : 'Start simulation'}
          className="rounded p-1 text-slate-500 transition-colors hover:bg-white hover:text-brand-700 disabled:opacity-50"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : simulation?.status === 'RUNNING' ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* ── sound ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setSoundEnabled(!soundEnabled)}
        title={soundEnabled ? 'Mute intrusion alarm' : 'Unmute intrusion alarm'}
        aria-label={soundEnabled ? 'Mute intrusion alarm' : 'Unmute intrusion alarm'}
        className={cn(
          'rounded-lg p-2 transition-colors',
          soundEnabled ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
        )}
      >
        {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>

      {/* ── alerts ─────────────────────────────────────────────────────── */}
      <Link
        to="/alerts"
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
        aria-label={`Alerts, ${newAlerts} new`}
      >
        <BellRing className="h-4 w-4" />
        {newAlerts > 0 ? (
          <span className="tnum absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
            {newAlerts > 99 ? '99+' : newAlerts}
          </span>
        ) : null}
      </Link>

      {/* ── clock ──────────────────────────────────────────────────────── */}
      <div className="hidden shrink-0 border-l border-slate-200 pl-3 text-right sm:block">
        <p className="tnum text-[13px] font-semibold leading-tight text-slate-800">
          {formatTime(clock.toISOString())}
        </p>
        <p className="text-[10px] leading-tight text-slate-500">
          {clock.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
          {' · '}
          <span
            className={cn(
              'font-semibold',
              connection === 'connected' ? 'text-emerald-600' : 'text-amber-600',
            )}
          >
            {connection === 'connected' ? 'live' : connection}
          </span>
        </p>
      </div>
    </header>
  );
}

export function MobileNavSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hasRole } = useAuth();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div className="relative h-full w-64 animate-slide-up bg-brand-950">
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <span className="text-sm font-bold text-white">CIDRTM</span>
          <Button size="xs" variant="ghost" className="text-slate-300" onClick={onClose}>
            Close
          </Button>
        </div>
        <nav className="panel-scroll h-[calc(100%-3.5rem)] px-2 py-3">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => !item.roles || hasRole(...item.roles));
            if (!items.length) return null;
            return (
              <div key={section.title} className="mb-3">
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {section.title}
                </p>
                {items.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className="nav-link"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

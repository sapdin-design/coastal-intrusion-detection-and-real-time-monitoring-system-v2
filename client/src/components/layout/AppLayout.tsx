import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { AlertOctagon, ArrowRight, Siren, X } from 'lucide-react';
import { cn, timeAgo } from '@/lib/format';
import { useRealtime } from '@/store/realtime';
import { Sidebar } from './Sidebar';
import { MobileNavSheet, Topbar } from './Topbar';

const COLLAPSE_KEY = 'cidrtm.sidebar.collapsed';

/**
 * Application shell.
 *
 * Holds the two persistent frames — the navigation rail and the command bar — plus
 * the one global interruption in the product: the intrusion alarm. Everything else
 * renders through `<Outlet />` so a page can never accidentally cover the chrome.
 */
export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  // Any navigation dismisses the mobile sheet.
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        className="hidden lg:flex"
      />
      <MobileNavSheet open={mobileNav} onClose={() => setMobileNav(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileNav(true)} />
        <IntrusionAlarm />
        <main className="panel-scroll flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Global intrusion alarm.
 *
 * Shown when the geofencing engine reports a confirmed unauthorized entry. It is
 * intentionally loud, self-dismissing after 20 seconds and never blocks the page —
 * an operator must be able to keep working while it is on screen.
 */
function IntrusionAlarm() {
  const { latestIntrusion, dismissIntrusion } = useRealtime();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!latestIntrusion) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 20_000);
    return () => clearTimeout(timer);
  }, [latestIntrusion]);

  if (!latestIntrusion || !visible) return null;

  const { vessel, zone, incident, alert, detectedAt } = latestIntrusion;

  return (
    <div className="relative border-b border-rose-300 bg-gradient-to-r from-rose-600 to-rose-500 text-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/20">
          <Siren className="h-4 w-4" />
          <span className="absolute inset-0 animate-pulse-ring rounded-lg bg-white/40" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide">
            <AlertOctagon className="h-3.5 w-3.5" />
            Intrusion detected — {zone.name}
          </p>
          <p className="truncate text-xs text-rose-50">
            <span className="font-mono">{vessel.vesselCode ?? vessel.vesselId}</span> — {vessel.name}{' '}
            entered the zone without authorization · {(vessel.speed / 1.852).toFixed(1)} kn ·{' '}
            {timeAgo(detectedAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden rounded-md bg-white/15 px-2 py-1 font-mono text-[10px] font-semibold sm:inline">
            {alert.alertId}
          </span>
          <Link
            to="/incidents"
            className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
          >
            Open incident {incident.incidentId}
            <ArrowRight className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={() => {
              // Clear the store as well as the local flag: leaving the store set
              // would let the same alarm re-appear on the next remount.
              setVisible(false);
              dismissIntrusion();
            }}
            aria-label="Dismiss alarm"
            className={cn('rounded-lg p-1.5 transition-colors hover:bg-white/20')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

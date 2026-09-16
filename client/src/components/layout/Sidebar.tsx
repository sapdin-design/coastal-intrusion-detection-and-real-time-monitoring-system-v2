import { NavLink } from 'react-router-dom';
import { ChevronLeft, LogOut, ShieldCheck, Waves } from 'lucide-react';
import { NAV_SECTIONS, ROLE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useRealtime } from '@/store/realtime';
import { Icon } from './iconMap';
import { StatusDot } from '@/components/ui/base';

const CONNECTION_META = {
  connected: { label: 'Live', className: 'bg-emerald-400', text: 'text-emerald-300' },
  connecting: { label: 'Connecting', className: 'bg-amber-400', text: 'text-amber-300' },
  reconnecting: { label: 'Reconnecting', className: 'bg-amber-400', text: 'text-amber-300' },
  error: { label: 'Offline', className: 'bg-rose-500', text: 'text-rose-300' },
  idle: { label: 'Idle', className: 'bg-slate-500', text: 'text-slate-400' },
} as const;

/**
 * Primary navigation. On a dark navy rail rather than a white sidebar: it gives the
 * operational content area maximum contrast, which matters on a wall-mounted
 * monitoring display.
 */
export function Sidebar({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { user, logout, hasRole } = useAuth();
  const { alerts, incidents, connection } = useRealtime();

  const activeAlerts = alerts.filter((a) => a.status !== 'RESOLVED').length;
  const openIncidents = incidents.filter((i) => i.status !== 'RESOLVED' && i.status !== 'CLOSED').length;
  const badges = { alerts: activeAlerts, incidents: openIncidents };
  const meta = CONNECTION_META[connection];

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-brand-950 text-slate-300 transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-64',
        className,
      )}
    >
      {/* ── brand ─────────────────────────────────────────────────────── */}
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-brand-600 text-white shadow">
          <Waves className="h-4 w-4" strokeWidth={2.4} />
        </span>
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight text-white">CIDRTM</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-400">
              Coastal Monitoring
            </p>
          </div>
        ) : null}
      </div>

      {/* ── navigation ────────────────────────────────────────────────── */}
      <nav className="panel-scroll flex-1 px-2 py-3">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => !item.roles || hasRole(...item.roles));
          if (!items.length) return null;

          return (
            <div key={section.title} className="mb-4">
              {!collapsed ? (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {section.title}
                </p>
              ) : (
                <div className="mx-3 mb-2 border-t border-white/10" />
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const count = item.badge ? badges[item.badge] : 0;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'nav-link',
                            isActive && 'nav-link-active',
                            collapsed && 'justify-center px-0',
                          )
                        }
                      >
                        <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                        {count > 0 ? (
                          <span
                            className={cn(
                              'tnum rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                              item.badge === 'alerts'
                                ? 'bg-rose-500 text-white'
                                : 'bg-amber-400 text-amber-950',
                              collapsed && 'absolute right-1 top-1 px-1',
                            )}
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── status + user ─────────────────────────────────────────────── */}
      <div className="border-t border-white/10 p-3">
        <div
          className={cn(
            'mb-2 flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2',
            collapsed && 'justify-center px-0',
          )}
        >
          <StatusDot className={meta.className} pulse={connection === 'connected'} />
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-[11px] font-semibold', meta.text)}>{meta.label}</p>
              <p className="truncate text-[10px] text-slate-500">Realtime channel</p>
            </div>
          ) : null}
        </div>

        <div className={cn('flex items-center gap-2', collapsed && 'flex-col')}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-white">
            {user?.name?.slice(0, 1).toUpperCase() ?? '?'}
          </span>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{user?.name}</p>
              <p className="flex items-center gap-1 truncate text-[10px] text-slate-400">
                <ShieldCheck className="h-2.5 w-2.5" />
                {user ? ROLE_LABELS[user.role] : ''}
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden h-9 items-center justify-center gap-1.5 border-t border-white/10 text-[11px] text-slate-400 transition-colors hover:bg-white/5 hover:text-white lg:flex"
      >
        <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
        {!collapsed ? 'Collapse' : null}
      </button>
    </aside>
  );
}

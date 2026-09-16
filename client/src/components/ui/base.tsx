import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/format';

/* ─────────────────────────────── Card ────────────────────────────────── */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card-header', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="text-brand-600">{icon}</span> : null}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle ? <p className="truncate text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ────────────────────────────── Button ───────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'btn-xs',
  sm: 'btn-sm',
  md: '',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(VARIANTS[variant], SIZES[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className,
  variant = 'ghost',
  size = 'sm',
  ...rest
}: Omit<ButtonProps, 'children'> & { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(VARIANTS[variant], SIZES[size], 'px-2', className)}
      {...rest}
    >
      {icon}
    </button>
  );
}

/* ─────────────────────────────── Badge ───────────────────────────────── */

export function Badge({
  children,
  className,
  dot,
}: {
  children: ReactNode;
  className?: string;
  dot?: string;
}) {
  return (
    <span className={cn('chip', className)}>
      {dot ? <span className={cn('legend-dot', dot)} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ className, pulse = false }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse ? (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', className)} />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', className)} />
    </span>
  );
}

/* ─────────────────────────── Loading states ──────────────────────────── */

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-slate-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-slate-200/70', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn('h-6 flex-1', c === 0 && 'max-w-[140px]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────── Empty / error states ─────────────────────── */

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      <div className="grid h-11 w-11 place-items-center rounded-full bg-rose-50 text-rose-600">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800">Something went wrong</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── Progress ─────────────────────────────── */

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
}: {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)}>
      <div
        className={cn('h-full rounded-full bg-brand-600 transition-[width] duration-500', barClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ────────────────────────────── Stat card ────────────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'muted';
  onClick?: () => void;
  className?: string;
}) {
  const tones = {
    default: 'text-brand-600 bg-brand-50',
    positive: 'text-emerald-600 bg-emerald-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
    muted: 'text-slate-500 bg-slate-100',
  } as const;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'card group flex w-full items-start justify-between gap-3 p-4 text-left transition',
        onClick && 'hover:border-brand-300 hover:shadow-raised',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="kpi-value mt-2">{value}</p>
        {hint ? <p className="mt-1.5 truncate text-xs text-slate-500">{hint}</p> : null}
      </div>
      {icon ? (
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tones[tone])}>{icon}</span>
      ) : null}
    </Wrapper>
  );
}

/* ─────────────────────────────── Tabs ────────────────────────────────── */

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              active ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'tnum rounded px-1 text-[10px] font-semibold',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Key/value ─────────────────────────────── */

export function DetailRow({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <dt className="shrink-0 text-xs font-medium text-slate-500">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] text-slate-800', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[11px] font-semibold uppercase tracking-wider text-slate-400', className)}>
      {children}
    </p>
  );
}

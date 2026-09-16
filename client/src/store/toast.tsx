import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/format';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss; 0 keeps the toast until dismissed. */
  duration: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { icon: ReactNode; ring: string; iconColor: string }> = {
  success: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    ring: 'ring-emerald-200',
    iconColor: 'text-emerald-600 bg-emerald-50',
  },
  error: {
    icon: <XCircle className="h-4 w-4" />,
    ring: 'ring-rose-200',
    iconColor: 'text-rose-600 bg-rose-50',
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    ring: 'ring-amber-200',
    iconColor: 'text-amber-600 bg-amber-50',
  },
  info: {
    icon: <Info className="h-4 w-4" />,
    ring: 'ring-brand-200',
    iconColor: 'text-brand-600 bg-brand-50',
  },
};

/**
 * Toast provider.
 *
 * Kept dependency-free and capped at 5 visible toasts: during an alert storm the
 * notification area must stay readable rather than becoming a wall of pop-ups.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    ({ duration = 5000, ...toast }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-4), { ...toast, id, duration }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ variant: 'success', title, description }),
      error: (title, description) => push({ variant: 'error', title, description, duration: 8000 }),
      warning: (title, description) => push({ variant: 'warning', title, description, duration: 7000 }),
      info: (title, description) => push({ variant: 'info', title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => {
          const style = VARIANT_STYLES[toast.variant];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-panel ring-1 animate-slide-up',
                style.ring,
              )}
            >
              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', style.iconColor)}>
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 break-words text-xs text-slate-500">{toast.description}</p>
                ) : null}
                {toast.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {toast.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

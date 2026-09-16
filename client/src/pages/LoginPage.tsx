import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Mail,
  Radar,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { Button, Field, Input } from '@/components/ui';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  remember: z.boolean(),
});

type LoginValues = z.infer<typeof loginSchema>;

/** One-click credential fill for evaluation and demos. */
const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@cidrtm.gov.in', password: 'Admin@123', tone: 'text-brand-700' },
  { role: 'Security Operator', email: 'operator@cidrtm.gov.in', password: 'Operator@123', tone: 'text-teal-700' },
  { role: 'Analyst (read-only)', email: 'analyst@cidrtm.gov.in', password: 'Analyst@123', tone: 'text-violet-700' },
];

const HIGHLIGHTS = [
  { icon: Radar, title: 'Live geofencing', text: 'Polygon-based zone evaluation on every position frame' },
  { icon: ShieldCheck, title: 'Intrusion detection', text: 'Authorized vs unauthorized entry, resolved automatically' },
  { icon: Waves, title: 'Simulated GNSS', text: '20 vessels on real coastal routes, 1× to 10× time compression' },
];

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: true },
  });

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const onSubmit = async (values: LoginValues) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password, values.remember);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`, 'Realtime monitoring channel connected.');
      navigate(redirectTo, { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Unable to sign in right now. Check that the API server is running.';
      setFormError(message);
    }
  };

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setValue('email', account.email, { shouldValidate: true });
    setValue('password', account.password, { shouldValidate: true });
    setFormError(null);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ── brand panel ────────────────────────────────────────────────── */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 p-10 text-white lg:flex">
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #38bdf8 0, transparent 45%), radial-gradient(circle at 80% 70%, #0d9488 0, transparent 50%)',
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-56 opacity-25"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0 22px, rgba(148,197,255,0.35) 22px 23px)',
            maskImage: 'linear-gradient(to top, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-brand-600 shadow-lg">
              <Waves className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">CIDRTM</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Coastal Intrusion Detection
              </p>
            </div>
          </div>

          <h1 className="mt-14 max-w-lg text-3xl font-bold leading-tight tracking-tight">
            Real-time maritime domain awareness for the coastal sector.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
            Track every contact on a live map, enforce polygon geofences, and escalate
            unauthorized entries from detection to incident closure — without a single page
            refresh.
          </p>

          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-sky-300">
                  <item.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-6 text-[11px] text-slate-400">
          <span>Simulated GNSS · no hardware required</span>
          <span className="h-3 w-px bg-white/20" />
          <span>Socket.IO realtime bus</span>
          <span className="h-3 w-px bg-white/20" />
          <span>v1.0.0</span>
        </div>
      </div>

      {/* ── form panel ─────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center bg-slate-50 px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-900 text-white">
              <Waves className="h-5 w-5" />
            </span>
            <p className="mt-3 text-lg font-bold text-slate-900">CIDRTM</p>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Sign in to the console</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use a demonstration account below, or your issued credentials.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
            {formError ? (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}

            <Field label="Email address" error={errors.email?.message} required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="operator@cidrtm.gov.in"
                  className="pl-9"
                  invalid={Boolean(errors.email)}
                  {...register('email')}
                />
              </div>
            </Field>

            <Field label="Password" error={errors.password?.message} required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                  {...register('remember')}
                />
                Keep me signed in
              </label>
              <span className="text-[13px] text-slate-400">Session expires in 12 h</span>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={isSubmitting}
              icon={isSubmitting ? undefined : <LogIn className="h-4 w-4" />}
            >
              {isSubmitting ? 'Authenticating…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-8">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Demonstration accounts
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <ul className="mt-4 space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => fillDemo(account)}
                    disabled={isSubmitting}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition',
                      'hover:border-brand-300 hover:shadow-card disabled:opacity-60',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn('block text-[13px] font-semibold', account.tone)}>
                        {account.role}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-slate-500">
                        {account.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-400">Use →</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-8 flex items-center gap-1.5 text-[11px] text-slate-400">
            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Protected by JWT authentication and role-based access control.
          </p>
        </div>
      </div>
    </div>
  );
}

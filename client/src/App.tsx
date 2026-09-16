import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2, Waves } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/store/auth';
import { RealtimeProvider } from '@/store/realtime';
import { DashboardPage } from '@/pages/DashboardPage';
import { LiveMapPage } from '@/pages/LiveMapPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { VesselsPage } from '@/pages/VesselsPage';
import { ZonesPage } from '@/pages/ZonesPage';
import { SimulationPage } from '@/pages/SimulationPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import type { UserRole } from '@/types';

/** Full-page splash shown while the stored session is being revalidated. */
function SessionGate() {
  return (
    <div className="grid h-screen place-items-center bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-900 text-white shadow-lg">
          <Waves className="h-6 w-6" />
        </span>
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Restoring monitoring session…
        </p>
      </div>
    </div>
  );
}

/**
 * Authentication gate. Waits for the session bootstrap before deciding, so a
 * returning operator with a valid token never sees a login flash.
 */
function RequireAuth() {
  const { isAuthenticated, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <SessionGate />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <RealtimeProvider>
      <Outlet />
    </RealtimeProvider>
  );
}

/** Route-level role gate — mirrors the server's `requireRole` middleware. */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/map" element={<LiveMapPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/vessels" element={<VesselsPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          {/* Simulator control is restricted to operational roles. */}
          <Route element={<RequireRole roles={['ADMIN', 'OPERATOR']} />}>
            <Route path="/simulation" element={<SimulationPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

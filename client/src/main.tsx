import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';
import { AuthProvider } from '@/store/auth';
import { ToastProvider } from '@/store/toast';

/**
 * React Query defaults tuned for an operations console:
 *  - a short stale window, because most panels are also driven by the realtime bus;
 *  - no refetch on window focus (the socket already keeps everything current);
 *  - a single retry, so a transient blip self-heals without hammering the API.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root is missing from index.html');

/**
 * Note: StrictMode is intentionally omitted. Its double-invoked effects conflict
 * with two third-party lifecycles used here — Leaflet's map initialisation and
 * Socket.IO's connection handshake — and would open duplicate connections in
 * development without changing production behaviour.
 */
createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ToastProvider>
  </QueryClientProvider>,
);

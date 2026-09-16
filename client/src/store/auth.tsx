import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { PublicUser, UserRole } from '@/types';

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<PublicUser>;
  logout: () => Promise<void>;
  /** Role gate used by the sidebar and by page-level guards. */
  hasRole: (...roles: UserRole[]) => boolean;
  isAdmin: boolean;
  canOperate: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session provider.
 *
 * On boot it rehydrates the cached user from storage and revalidates it against
 * `/auth/me` — so a revoked or deactivated account cannot keep a stale session
 * alive in an open tab.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(() => tokenStore.user());
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const stored = tokenStore.get();
      if (!stored) {
        if (!cancelled) {
          setUser(null);
          setToken(null);
          setReady(true);
        }
        return;
      }
      try {
        const me = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        setToken(stored);
        connectSocket(stored);
      } catch {
        if (cancelled) return;
        tokenStore.clear();
        setUser(null);
        setToken(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const result = await api.auth.login(email, password, remember);
    tokenStore.set(result.token, result.user, remember);
    setUser(result.user);
    setToken(result.token);
    connectSocket(result.token);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* the local session is cleared regardless */
    }
    disconnectSocket();
    tokenStore.clear();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      ready,
      isAuthenticated: Boolean(user && token),
      login,
      logout,
      hasRole: (...roles: UserRole[]) => Boolean(user && roles.includes(user.role)),
      isAdmin: user?.role === 'ADMIN',
      canOperate: user?.role === 'ADMIN' || user?.role === 'OPERATOR',
    }),
    [user, token, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

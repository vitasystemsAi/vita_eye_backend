'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SESSION_EXPIRED_EVENT, api } from './api';
import type { CurrentUser, FeatureKey, Permission } from './types';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  /** Whether the platform enabled this feature for the user's organization. */
  hasFeature: (feature: FeatureKey) => boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const toLogin = useCallback(() => {
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [pathname, router]);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<{ user: CurrentUser }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
      toLogin();
    } finally {
      setLoading(false);
    }
  }, [toLogin]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      toLogin();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [toLogin]);

  const logout = useCallback(async () => {
    const impersonated = Boolean(user?.impersonatedBy);
    try {
      await api.post('/auth/logout', {}, { noRefresh: true });
    } finally {
      setUser(null);
      router.replace(impersonated ? '/platform/clients' : '/login');
    }
  }, [router, user?.impersonatedBy]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    const features = new Set(user?.features ?? []);
    return { user, loading, reload, logout, can: (...p) => p.every((x) => perms.has(x)), hasFeature: (f) => features.has(f) };
  }, [user, loading, reload, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

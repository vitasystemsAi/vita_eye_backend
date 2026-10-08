'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PLATFORM_SESSION_EXPIRED_EVENT, api } from './api';
import type { Camera, FeatureKey, OrganizationStatus, RoleName } from './types';

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
}

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  description: string;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string | null;
  status: OrganizationStatus;
  databaseName: string | null;
  dedicatedDatabase: boolean;
  features: FeatureKey[];
  detectionRetentionDays: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  holdReason: string | null;
  heldAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientAdmin {
  userId: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  lockedUntil?: string | null;
}

export interface ClientRow extends PlatformOrganization {
  admin: ClientAdmin | null;
  hasStoredPassword: boolean;
  counts: { users: number; cameras: number; camerasOnline: number; persons: number } | null;
}

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  isPrimaryAdmin: boolean;
  createdAt: string;
}

export interface ClientDetail {
  organization: PlatformOrganization;
  credentials: { userId: string; email: string; updatedBy: string | null; updatedAt: string } | null;
  admin: ClientAdmin | null;
  users: ClientUser[];
  cameras: Camera[];
  stats: {
    users: number;
    cameras: number;
    camerasOnline: number;
    persons: number;
    eventsTotal: number;
    events24h: number;
    unknown24h: number;
    oldestEventAt: string | null;
    newestEventAt: string | null;
  } | null;
  recentActivity: Array<{ id: number; action: string; userEmail: string | null; ipAddress: string | null; metadata: Record<string, unknown> | null; createdAt: string }>;
}

export interface Credentials {
  email: string;
  password: string;
  generated?: boolean;
}

interface PlatformState {
  admin: PlatformAdmin | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const PlatformContext = createContext<PlatformState | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api
      .get<{ admin: PlatformAdmin }>('/platform/auth/me')
      .then(({ data }) => setAdmin(data.admin))
      .catch(() => router.replace('/platform/login'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const onExpired = () => {
      setAdmin(null);
      router.replace('/platform/login');
    };
    window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api.post('/platform/auth/logout', {}, { noRefresh: true });
    } finally {
      setAdmin(null);
      router.replace('/platform/login');
    }
  }, [router]);

  const value = useMemo(() => ({ admin, loading, logout }), [admin, loading, logout]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformState {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used inside PlatformAuthProvider');
  return ctx;
}

/**
 * Opens the client's console in a new tab as one of its users. The tab is opened synchronously (before
 * the request) so popup blockers allow it; the session cookies are set by the impersonate call.
 */
export async function openClientConsole(organizationId: string, opts: { userId?: string; path?: string } = {}) {
  const tab = window.open('about:blank', '_blank');
  try {
    await api.post(`/platform/organizations/${organizationId}/impersonate`, opts.userId ? { userId: opts.userId } : {});
    const target = opts.path ?? '/dashboard';
    if (tab) tab.location.href = target;
    else window.location.href = target;
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export function copyText(text: string) {
  return navigator.clipboard?.writeText(text);
}

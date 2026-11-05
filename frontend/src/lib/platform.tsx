'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PLATFORM_SESSION_EXPIRED_EVENT, api } from './api';
import type { Camera, FeatureKey, OrganizationStatus, OrganizationTypeCode, RoleName } from './types';

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
}

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  description: string;
  category: string;
  supported: boolean;
  legalNote: string | null;
}

export interface PlanInfo {
  code: string;
  label: string;
  description: string;
  cameraLimit: number | null;
  storageLimitBytes: number | null;
  retentionMaxDays: number;
  features: FeatureKey[];
}

export interface PlatformOrganization {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  status: OrganizationStatus;
  databaseName: string | null;
  dedicatedDatabase: boolean;
  features: FeatureKey[];
  detectionRetentionDays: number | null;
  retentionGraceDays: number;
  retentionMode: 'DRY_RUN' | 'ENFORCE';
  timezone: string;
  subscriptionPlan: string | null;
  cameraLimit: number | null;
  storageLimitBytes: number | null;
  organizationType: OrganizationTypeCode;
  organizationTypeLabel: string;
  capacity: number | null;
  capacityUnit: string;
  capacityLabel: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  holdReason: string | null;
  heldAt: string | null;
  provisioningError: string | null;
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
  counts: { users: number; cameras: number; camerasOnline: number; camerasOffline: number; persons: number; events: number } | null;
  storageUsedBytes: number | null;
  approachingLimit: boolean;
  activeHold: boolean;
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
    camerasOffline?: number;
    persons: number;
    eventsTotal: number;
    events24h: number;
    unknown24h: number;
  } | null;
  detections: Array<{ id: string; eventType: string; reviewStatus: string; eventTimestamp: string; legalHold: boolean; eligibleForDeletion: boolean; camera: { id: string; name: string; location: string } | null }>;
  holds: Array<{ id: string; holdType: 'LEGAL' | 'INVESTIGATION'; reason: string; active: boolean; createdAt: string; releasedAt: string | null }>;
  provisioningJobs: Array<{ id: string; status: string; attempt: number; error: string | null; startedAt: string; finishedAt: string | null }>;
  cleanup: { mode: string; cutoffAt: string | null; processed: number; deleted: number; failed: number; remaining: number; skippedHolds: number; error: string | null; finishedAt: string } | null;
  nextCleanupAt: string;
  retentionCutoff: string | null;
  storageUsedBytes: number | null;
  recentActivity: Array<{ id: number; action: string; userEmail: string | null; ipAddress: string | null; metadata: Record<string, unknown> | null; createdAt: string }>;
}

export interface SetupLink {
  email: string;
  emailed: boolean;
  expiresAt: string;
  setupLink: string | null;
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
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const onExpired = () => {
      setAdmin(null);
      router.replace('/login');
    };
    window.addEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(PLATFORM_SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api.post('/platform/auth/logout', {}, { noRefresh: true });
    } finally {
      setAdmin(null);
      router.replace('/login');
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
export async function openClientConsole(organizationId: string, opts: { userId?: string; path?: string; purpose?: 'CONSOLE' | 'LIVE_PREVIEW' } = {}) {
  const tab = window.open('about:blank', '_blank');
  try {
    await api.post(`/platform/organizations/${organizationId}/impersonate`, {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
    });
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

'use client';

import { Activity, Building2, Camera, Database, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { OrgStatusBadge } from '@/components/platform/ClientControls';
import { Card, ErrorBanner, Input, LoadingBlock, PageHeader, StatCard } from '@/components/ui/primitives';
import { fmtBytes, fmtDateTime, fmtRelative, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Dashboard {
  generatedAt: string;
  nextCleanupAt: string;
  range: { from: string; to: string };
  organizations: { total: number; active: number; suspended: number; onHold: number; pending: number; failed: number; deactivated: number; archived: number; registeredInRange: number };
  cameras: { total: number; online: number; offline: number };
  detections: { total: number; inRange: number };
  storage: Array<{ id: string; name: string; usedBytes: number; limitBytes: number | null; cameraCount: number; cameraLimit: number | null; approaching: boolean }>;
  approachingLimits: Dashboard['storage'];
  recentOrganizations: Array<{ id: string; name: string; code: string | null; status: 'ACTIVE' | 'SUSPENDED' | 'ON_HOLD' | 'PROVISIONING' | 'PENDING' | 'FAILED' | 'DEACTIVATED' | 'ARCHIVED'; subscriptionPlan: string | null; createdAt: string }>;
  recentActivity: Array<{ id: number; action: string; createdAt: string; ipAddress: string | null }>;
}

function dayStart(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export default function PlatformDashboardPage() {
  const [from, setFrom] = useState(dayStart(29));
  const [to, setTo] = useState(dayStart(0));
  const { data, loading, error, reload } = useApi<Dashboard>('/platform/dashboard', { from, to });
  const maxStorage = Math.max(1, ...(data?.storage.map((row) => row.usedBytes) ?? [1]));

  return (
    <>
      <PageHeader
        title="Platform dashboard"
        icon={<Activity className="h-5 w-5" />}
        description="Organizations, cameras, detections and storage across the platform."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
          </div>
        }
      />
      {error && <ErrorBanner error={error} onRetry={reload} />}
      {loading && !data ? (
        <LoadingBlock />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Organizations" value={data.organizations.total} sub={`${data.organizations.registeredInRange} in range`} icon={<Building2 className="h-5 w-5" />} />
            <StatCard label="Active" value={data.organizations.active} sub={`${data.organizations.suspended} suspended · ${data.organizations.onHold} on hold · ${data.organizations.pending} pending`} tone="green" icon={<ShieldAlert className="h-5 w-5" />} />
            <StatCard label="Cameras" value={data.cameras.total} sub={`${data.cameras.online} online · ${data.cameras.offline} offline`} icon={<Camera className="h-5 w-5" />} />
            <StatCard label="Detections" value={data.detections.total} sub={`${data.detections.inRange} in range`} tone="amber" icon={<Database className="h-5 w-5" />} />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Storage by organization" description={`Next cleanup ${fmtDateTime(data.nextCleanupAt)}`}>
              <div className="space-y-3 p-5">
                {!data.storage.length && <p className="text-sm text-ink-400">No provisioned organizations yet.</p>}
                {data.storage.slice(0, 8).map((row) => (
                  <div key={row.id}>
                    <div className="mb-1 flex justify-between text-xs text-ink-300">
                      <Link href={`/platform/clients/${row.id}`} className="hover:text-brand-300">{row.name}</Link>
                      <span>{fmtBytes(row.usedBytes)}{row.limitBytes ? ` / ${fmtBytes(row.limitBytes)}` : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-ink-800">
                      <div className={row.approaching ? 'h-2 rounded-full bg-amber-400' : 'h-2 rounded-full bg-brand-500'} style={{ width: `${Math.max(2, Math.round((row.usedBytes / maxStorage) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Approaching limits" description="Storage or cameras at 80% of the organization limit">
              <div className="p-5">
                {!data.approachingLimits.length ? (
                  <p className="text-sm text-ink-400">No organization is near a configured limit.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.approachingLimits.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3">
                        <Link href={`/platform/clients/${row.id}`} className="text-ink-100 hover:text-brand-300">{row.name}</Link>
                        <span className="text-xs text-amber-200">{fmtBytes(row.usedBytes)} · {row.cameraCount}{row.cameraLimit ? `/${row.cameraLimit}` : ''} cameras</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Recent registrations">
              <ul className="divide-y divide-ink-800">
                {data.recentOrganizations.map((org) => (
                  <li key={org.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <Link href={`/platform/clients/${org.id}`} className="font-medium text-ink-100 hover:text-brand-300">{org.name}</Link>
                      <span className="ml-2 font-mono text-xs text-ink-400">{org.code}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-400">
                      <OrgStatusBadge status={org.status} />
                      {fmtRelative(org.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Administrative activity">
              <ul className="divide-y divide-ink-800">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="text-ink-100">{humanize(entry.action)}</span>
                    <span className="text-xs text-ink-400">{fmtRelative(entry.createdAt)}</span>
                  </li>
                ))}
                {!data.recentActivity.length && <li className="px-5 py-4 text-sm text-ink-400">No platform activity in this range.</li>}
              </ul>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

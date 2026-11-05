'use client';

import { Building2 } from 'lucide-react';
import { RequirePermission } from '@/components/RequirePermission';
import { PremisesBoard } from '@/components/premises/PremisesBoard';
import { ErrorBanner, LoadingBlock, PageHeader, StatCard } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { PremisesOverview } from '@/lib/premises';

function titleFor(data: PremisesOverview) {
  if (data.profile.master === 'workforce') return 'Workforce';
  if (data.profile.code === 'HOME') return 'Home layout';
  if (data.profile.code === 'SCHOOL') return 'Campus';
  if (data.profile.master === 'lodging') return 'Floors, rooms and beds';
  return 'Master data';
}

function MasterData() {
  const { can } = useAuth();
  const { data, loading, error, reload, setData } = useApi<PremisesOverview>('/premises');
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner error={error} onRetry={reload} />;
  const remaining = data.usage.remaining;
  return (
    <>
      <PageHeader
        title={titleFor(data)}
        icon={<Building2 className="h-5 w-5" />}
        description={`${data.profile.label} master data. Licensed ${data.profile.capacityLabel.toLowerCase()} is set by the platform when the organization is registered.`}
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={data.profile.capacityLabel} value={data.profile.capacity?.toLocaleString() ?? '—'} sub={data.profile.capacityUnit} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="In use" value={data.usage.used.toLocaleString()} sub={data.usage.unit} icon={<Building2 className="h-5 w-5" />} tone={data.profile.capacity != null && data.usage.used >= data.profile.capacity ? 'amber' : 'blue'} />
        <StatCard label="Remaining" value={remaining == null ? '—' : remaining.toLocaleString()} sub={remaining == null ? 'No limit set' : data.usage.unit} icon={<Building2 className="h-5 w-5" />} tone="green" />
      </div>
      <PremisesBoard data={data} canManage={can('premises:manage')} onUpdated={(next) => setData(() => next)} />
    </>
  );
}

export default function PremisesPage() {
  const { can } = useAuth();
  if (!can('premises:view')) {
    return (
      <RequirePermission permission="premises:view">
        <span />
      </RequirePermission>
    );
  }
  return <MasterData />;
}

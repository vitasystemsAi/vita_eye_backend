'use client';

import { Building2, Camera, ChevronLeft, ChevronRight, Eye, KeyRound, PlusCircle, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountDialog, CopyButton, OrgStatusBadge, ResetPasswordDialog } from '@/components/platform/ClientControls';
import { Button, Card, EmptyState, ErrorBanner, Input, LoadingBlock, PageHeader, Select, StatCard } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { fmtDate, fmtRelative } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { openClientConsole, type ClientRow, type PlatformOrganization } from '@/lib/platform';

const READY = new Set(['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED']);

export default function ClientsPage() {
  const notify = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload, setData } = useApi<ClientRow[]>('/platform/organizations', {
    q: query || undefined,
    status: status || undefined,
    page,
    pageSize: 20,
  });
  const [resetFor, setResetFor] = useState<ClientRow | null>(null);
  const [accountFor, setAccountFor] = useState<ClientRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function view(org: ClientRow, purpose?: 'LIVE_PREVIEW') {
    setOpening(org.id + (purpose ?? ''));
    try {
      await openClientConsole(org.id, purpose ? { purpose, path: '/monitoring' } : undefined);
    } catch (err) {
      notify('error', 'Could not open client console', errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Clients"
        icon={<Building2 className="h-5 w-5" />}
        description="Registered organizations, their databases, plans and account status."
        actions={
          <Link href="/platform/organizations/new">
            <Button icon={<PlusCircle className="h-4 w-4" />}>Register organization</Button>
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="On this page" value={data?.length ?? 0} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Matching" value={meta?.total ?? 0} tone="green" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Approaching limits" value={data?.filter((row) => row.approachingLimit).length ?? 0} tone="amber" icon={<Camera className="h-5 w-5" />} />
        <StatCard label="Legal holds" value={data?.filter((row) => row.activeHold).length ?? 0} icon={<ShieldCheck className="h-5 w-5" />} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700/70 px-4 py-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input className="pl-9" placeholder="Search name, code, email or database" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'PROVISIONING', 'FAILED', 'DEACTIVATED', 'ARCHIVED'].map((item) => (
              <option key={item} value={item}>{item.replace('_', ' ')}</option>
            ))}
          </Select>
        </div>
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        {loading && !data ? (
          <LoadingBlock />
        ) : !data?.length ? (
          <EmptyState icon={<Building2 className="h-6 w-6" />} title="No organizations match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[72rem]">
              <thead className="border-b border-ink-700/70">
                <tr>
                  {['Organization', 'Code', 'Admin email', 'Database', 'Features', 'Cameras', 'Plan', 'Registered', 'Last activity', 'Retention', 'Status', 'Actions'].map((heading) => (
                    <th key={heading} className="table-head">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data.map((org) => {
                  const ready = READY.has(org.status);
                  return (
                    <tr key={org.id} className="align-top hover:bg-ink-800/40">
                      <td className="table-cell">
                        <Link href={`/platform/clients/${org.id}`} className="font-medium text-ink-100 hover:text-brand-300">{org.name}</Link>
                        {org.approachingLimit && <p className="text-xs text-amber-300">Approaching a limit</p>}
                      </td>
                      <td className="table-cell font-mono text-xs">{org.code ?? '—'}</td>
                      <td className="table-cell text-sm">
                        {org.admin ? (
                          <span className="inline-flex items-center gap-1">
                            {org.admin.email}
                            <CopyButton value={org.admin.email} label="Copy admin email" />
                          </span>
                        ) : '—'}
                      </td>
                      <td className="table-cell font-mono text-[11px] text-ink-400">{org.databaseName ?? org.provisioningError ?? 'Not provisioned'}</td>
                      <td className="table-cell text-xs">{org.features.length} enabled</td>
                      <td className="table-cell text-xs">{org.counts ? `${org.counts.cameras} · ${org.counts.camerasOnline} online` : '—'}</td>
                      <td className="table-cell text-xs">{org.subscriptionPlan ?? '—'}</td>
                      <td className="table-cell text-xs">{fmtDate(org.createdAt)}</td>
                      <td className="table-cell text-xs">{fmtRelative(org.admin?.lastLoginAt)}</td>
                      <td className="table-cell text-xs">
                        {org.detectionRetentionDays ? `${org.detectionRetentionDays} days` : '—'}
                        <p className="text-ink-400">{org.retentionMode === 'DRY_RUN' ? 'Dry run' : 'Enforced'}</p>
                      </td>
                      <td className="table-cell">
                        <OrgStatusBadge status={org.status} />
                        {org.activeHold && <p className="mt-1 text-xs text-amber-300">Cleanup paused</p>}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1.5">
                          <Link href={`/platform/clients/${org.id}`}><Button size="sm" variant="secondary">View</Button></Link>
                          <Button size="sm" icon={<Eye className="h-3.5 w-3.5" />} disabled={!ready || !org.admin} loading={opening === org.id} onClick={() => void view(org)}>Open</Button>
                          <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={!ready} onClick={() => setResetFor(org)}>Reset</Button>
                          <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setAccountFor(org)}>Account</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-ink-700/70 px-4 py-3 text-sm text-ink-300">
            <span>Page {meta.page} of {meta.totalPages}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => setPage((current) => current - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= meta.totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
            </span>
          </div>
        )}
      </Card>
      {resetFor && <ResetPasswordDialog open org={resetFor} email={resetFor.admin?.email ?? null} onClose={() => setResetFor(null)} />}
      {accountFor && (
        <AccountDialog
          open
          org={accountFor}
          onClose={() => setAccountFor(null)}
          onDone={(updated: PlatformOrganization) => setData((prev) => prev?.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)) ?? prev)}
        />
      )}
    </>
  );
}

'use client';

import { Building2, Camera, ChevronRight, Eye, KeyRound, Pause, Play, PlusCircle, Search, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CopyButton, HoldDialog, OrgStatusBadge, PasswordReveal, ResetPasswordDialog } from '@/components/platform/ClientControls';
import { Button, Card, EmptyState, ErrorBanner, Input, LoadingBlock, PageHeader, StatCard } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { fmtDate, fmtRelative } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { openClientConsole, type ClientRow, type FeatureInfo } from '@/lib/platform';

export default function ClientsPage() {
  const notify = useToast();
  const { data, loading, error, reload, setData } = useApi<ClientRow[]>('/platform/organizations');
  const { data: catalog } = useApi<FeatureInfo[]>('/platform/features');
  const [search, setSearch] = useState('');
  // Bumped after a reset so revealed (cached) passwords are fetched again.
  const [passwordVersion, setPasswordVersion] = useState(0);
  const [resetFor, setResetFor] = useState<ClientRow | null>(null);
  const [holdFor, setHoldFor] = useState<ClientRow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return data ?? [];
    return data.filter((o) => [o.name, o.slug, o.admin?.email, o.contactEmail, o.databaseName].some((v) => v?.toLowerCase().includes(q)));
  }, [data, search]);

  const totals = useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      active: list.filter((o) => o.status === 'ACTIVE').length,
      held: list.filter((o) => o.status === 'SUSPENDED').length,
      cameras: list.reduce((n, o) => n + (o.counts?.cameras ?? 0), 0),
      online: list.reduce((n, o) => n + (o.counts?.camerasOnline ?? 0), 0),
    };
  }, [data]);

  async function view(org: ClientRow) {
    setOpening(org.id);
    try {
      await openClientConsole(org.id);
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
        description="Every registered organization, its admin login and dedicated database."
        actions={
          <Link href="/platform/organizations/new">
            <Button icon={<PlusCircle className="h-4 w-4" />}>Register organization</Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Organizations" value={totals.total} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Active" value={totals.active} tone="green" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="On hold" value={totals.held} tone={totals.held ? 'amber' : 'neutral'} icon={<Pause className="h-5 w-5" />} />
        <StatCard label="Cameras" value={totals.cameras} sub={`${totals.online} online`} tone="neutral" icon={<Camera className="h-5 w-5" />} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700/70 px-4 py-3">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input className="pl-9" placeholder="Search organization, admin email or database" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        {loading && !data ? (
          <LoadingBlock />
        ) : !rows.length ? (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={data?.length ? 'No organization matches your search' : 'No organizations yet'}
            action={
              !data?.length && (
                <Link href="/platform/organizations/new">
                  <Button icon={<PlusCircle className="h-4 w-4" />}>Register the first organization</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">Organization</th>
                  <th className="table-head">Status</th>
                  <th className="table-head">Admin login ID</th>
                  <th className="table-head">Password</th>
                  <th className="table-head">Plan</th>
                  <th className="table-head">Usage</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {rows.map((o) => {
                  const ready = o.status === 'ACTIVE' || o.status === 'SUSPENDED';
                  return (
                    <tr key={o.id} className="align-top hover:bg-ink-800/40">
                      <td className="table-cell">
                        <Link href={`/platform/clients/${o.id}`} className="font-medium text-ink-100 hover:text-brand-300">
                          {o.name}
                        </Link>
                        <p className="font-mono text-[11px] text-ink-400">{o.databaseName ?? 'primary database'}</p>
                        <p className="text-xs text-ink-400">Since {fmtDate(o.createdAt)}</p>
                      </td>
                      <td className="table-cell">
                        <OrgStatusBadge status={o.status} />
                        {o.holdReason && <p className="mt-1 max-w-[12rem] text-xs text-amber-300/80">{o.holdReason}</p>}
                      </td>
                      <td className="table-cell">
                        {o.admin ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <span className="text-sm">{o.admin.email}</span>
                              <CopyButton value={o.admin.email} label="Copy login ID" />
                            </span>
                            <p className="text-xs text-ink-400">Last sign-in {fmtRelative(o.admin.lastLoginAt)}</p>
                          </>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td className="table-cell">{ready ? <PasswordReveal key={`${o.id}:${passwordVersion}`} organizationId={o.id} available={o.hasStoredPassword} /> : <span className="text-xs text-ink-400">—</span>}</td>
                      <td className="table-cell text-xs text-ink-300">
                        <p>
                          {o.features.length}/{catalog?.length ?? o.features.length} features
                        </p>
                        <p>{o.detectionRetentionDays ? `${o.detectionRetentionDays}-day history` : 'No history limit'}</p>
                      </td>
                      <td className="table-cell text-xs text-ink-300">
                        {o.counts ? (
                          <>
                            <p className="inline-flex items-center gap-1">
                              <Camera className="h-3 w-3" /> {o.counts.cameras} cameras · {o.counts.camerasOnline} online
                            </p>
                            <p className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" /> {o.counts.users} users · {o.counts.persons} persons
                            </p>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" icon={<Eye className="h-3.5 w-3.5" />} disabled={!ready || !o.admin} loading={opening === o.id} onClick={() => void view(o)} title="Open this organization's console as its admin">
                            View
                          </Button>
                          <Button size="sm" variant="secondary" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={!ready} onClick={() => setResetFor(o)}>
                            Reset
                          </Button>
                          <Button
                            size="sm"
                            variant={o.status === 'SUSPENDED' ? 'primary' : 'ghost'}
                            icon={o.status === 'SUSPENDED' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                            disabled={!ready}
                            onClick={() => setHoldFor(o)}
                          >
                            {o.status === 'SUSPENDED' ? 'Reactivate' : 'Hold'}
                          </Button>
                          <Link href={`/platform/clients/${o.id}`} className="inline-flex h-8 items-center rounded-lg px-2 text-ink-300 hover:bg-ink-800 hover:text-ink-100" title="Details">
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resetFor && (
        <ResetPasswordDialog
          open
          org={resetFor}
          email={resetFor.admin?.email ?? null}
          onClose={() => setResetFor(null)}
          onDone={() => {
            setPasswordVersion((v) => v + 1);
            setData((prev) => prev?.map((o) => (o.id === resetFor.id ? { ...o, hasStoredPassword: true } : o)) ?? prev);
          }}
        />
      )}
      {holdFor && (
        <HoldDialog
          open
          org={holdFor}
          onClose={() => setHoldFor(null)}
          onDone={(updated) => setData((prev) => prev?.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)) ?? prev)}
        />
      )}
    </>
  );
}

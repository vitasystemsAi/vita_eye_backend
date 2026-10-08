'use client';

import { ArrowLeft, Camera, Database, Eye, History, KeyRound, MonitorPlay, Pause, Play, Save, ShieldAlert, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CameraStatusBadge } from '@/components/badges';
import { CopyButton, FeatureChecklist, HoldDialog, OrgStatusBadge, PasswordReveal, ResetPasswordDialog, RetentionPicker } from '@/components/platform/ClientControls';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, KeyValue, LoadingBlock, PageHeader, StatCard } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { fmtDateTime, fmtRelative, humanize, ROLE_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { openClientConsole, type ClientDetail, type FeatureInfo, type PlatformOrganization } from '@/lib/platform';
import type { FeatureKey } from '@/lib/types';

function PlanEditor({ org, catalog, onSaved }: { org: PlatformOrganization; catalog: FeatureInfo[]; onSaved: (o: PlatformOrganization) => void }) {
  const notify = useToast();
  const initial = () => ({
    name: org.name,
    contactName: org.contactName ?? '',
    contactEmail: org.contactEmail ?? '',
    contactPhone: org.contactPhone ?? '',
    features: org.features,
    detectionRetentionDays: org.detectionRetentionDays ?? 30,
  });
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const shortened = org.detectionRetentionDays !== null && draft.detectionRetentionDays < org.detectionRetentionDays;

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const { data } = await api.patch<PlatformOrganization>(`/platform/organizations/${org.id}`, draft);
      onSaved(data);
      notify('success', 'Plan updated', 'Changes apply to the organization immediately.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      notify('error', 'Plan not saved', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Plan & features"
      description="Feature access and detection history storage for this organization"
      actions={
        <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={saving} disabled={!dirty} onClick={() => void save()}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-6 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Organization name" error={errors.name}>
              <Input value={draft.name} maxLength={160} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
          </div>
          <Field label="Contact person" error={errors.contactName}>
            <Input value={draft.contactName} maxLength={120} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
          </Field>
          <Field label="Contact email" error={errors.contactEmail}>
            <Input type="email" value={draft.contactEmail} maxLength={255} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact phone" error={errors.contactPhone}>
            <Input value={draft.contactPhone} maxLength={40} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
          </Field>
        </div>
        <div>
          <p className="label">Features</p>
          <FeatureChecklist catalog={catalog} value={draft.features} onChange={(features: FeatureKey[]) => setDraft({ ...draft, features })} />
        </div>
        <div>
          <p className="label">Detection history storage</p>
          <RetentionPicker value={draft.detectionRetentionDays} onChange={(d) => setDraft({ ...draft, detectionRetentionDays: d })} error={errors.detectionRetentionDays} />
          {shortened && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Shortening the limit permanently deletes detections and evidence older than {draft.detectionRetentionDays} days at the next hourly cleanup.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const notify = useToast();
  const { data, loading, error, reload, setData } = useApi<ClientDetail>(`/platform/organizations/${id}`);
  const { data: catalog } = useApi<FeatureInfo[]>('/platform/features');
  const [resetOpen, setResetOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [passwordVersion, setPasswordVersion] = useState(0);

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner error={error} onRetry={reload} />;
  const { organization: org, stats } = data;
  const ready = org.status === 'ACTIVE' || org.status === 'SUSPENDED';

  async function open(key: string, opts: { userId?: string; path?: string } = {}) {
    setOpening(key);
    try {
      await openClientConsole(org.id, opts);
    } catch (err) {
      notify('error', 'Could not open client console', errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  const setOrg = (o: PlatformOrganization) => setData((prev) => (prev ? { ...prev, organization: o } : prev));

  return (
    <>
      <Link href="/platform/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> All clients
      </Link>
      <PageHeader
        title={org.name}
        icon={<Database className="h-5 w-5" />}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OrgStatusBadge status={org.status} />
            <span className="font-mono text-xs text-ink-400">{org.databaseName ?? 'primary database'}</span>
            {org.holdReason && <span className="text-xs text-amber-300">On hold: {org.holdReason}</span>}
          </span>
        }
        actions={
          <>
            <Button icon={<Eye className="h-4 w-4" />} disabled={!ready || !data.admin} loading={opening === 'admin'} onClick={() => void open('admin')}>
              View as admin
            </Button>
            <Button variant="secondary" icon={<MonitorPlay className="h-4 w-4" />} disabled={!ready || !data.admin} loading={opening === 'monitoring'} onClick={() => void open('monitoring', { path: '/monitoring' })}>
              Live monitoring
            </Button>
            <Button variant={org.status === 'SUSPENDED' ? 'primary' : 'danger'} icon={org.status === 'SUSPENDED' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} disabled={!ready} onClick={() => setHoldOpen(true)}>
              {org.status === 'SUSPENDED' ? 'Reactivate' : 'Put on hold'}
            </Button>
          </>
        }
      />

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="Users" value={stats.users} icon={<Users className="h-5 w-5" />} />
          <StatCard label="Cameras" value={stats.cameras} sub={`${stats.camerasOnline} online`} tone="green" icon={<Camera className="h-5 w-5" />} />
          <StatCard label="Registered persons" value={stats.persons} tone="neutral" icon={<UserPlus className="h-5 w-5" />} />
          <StatCard label="Detections (24h)" value={stats.events24h} sub={`${stats.unknown24h} unknown / uncertain`} tone={stats.unknown24h ? 'red' : 'amber'} icon={<ShieldAlert className="h-5 w-5" />} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Cameras" description="Camera access configured by this organization">
            {!data.cameras.length ? (
              <EmptyState icon={<Camera className="h-6 w-6" />} title="No cameras yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-ink-700/70">
                    <tr>
                      <th className="table-head">Camera</th>
                      <th className="table-head">Type</th>
                      <th className="table-head">Status</th>
                      <th className="table-head">Last connected</th>
                      <th className="table-head text-right">Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800">
                    {data.cameras.map((c) => (
                      <tr key={c.id} className="align-top hover:bg-ink-800/40">
                        <td className="table-cell">
                          <p className="font-medium">{c.cameraName}</p>
                          <p className="text-xs text-ink-400">{[c.location, c.site].filter(Boolean).join(' · ')}</p>
                          {c.streamReference && <p className="max-w-[22rem] truncate font-mono text-[11px] text-ink-400" title={c.streamReference}>{c.streamReference}</p>}
                        </td>
                        <td className="table-cell text-xs text-ink-300">
                          {c.cameraType}
                          {c.hasCredentials && <Badge className="ml-1">Credentials stored</Badge>}
                        </td>
                        <td className="table-cell">
                          <CameraStatusBadge status={c.status} monitoring={c.monitoringEnabled} />
                          {c.lastError && <p className="mt-1 max-w-[14rem] text-xs text-red-300/80">{c.lastError}</p>}
                        </td>
                        <td className="table-cell text-xs text-ink-300" title={fmtDateTime(c.lastConnectedAt)}>
                          {fmtRelative(c.lastConnectedAt)}
                        </td>
                        <td className="table-cell text-right">
                          <Button size="sm" variant="secondary" icon={<MonitorPlay className="h-3.5 w-3.5" />} disabled={!ready || !data.admin} loading={opening === c.id} onClick={() => void open(c.id, { path: '/monitoring' })}>
                            Preview
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Users" description="Console accounts in this organization's database">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-ink-700/70">
                  <tr>
                    <th className="table-head">User</th>
                    <th className="table-head">Role</th>
                    <th className="table-head">Status</th>
                    <th className="table-head">Last sign-in</th>
                    <th className="table-head text-right">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {data.users.map((u) => (
                    <tr key={u.id} className="hover:bg-ink-800/40">
                      <td className="table-cell">
                        <p className="font-medium">
                          {u.name} {u.isPrimaryAdmin && <Badge tone="violet">Primary admin</Badge>}
                        </p>
                        <p className="text-xs text-ink-400">{u.email}</p>
                      </td>
                      <td className="table-cell text-xs text-ink-300">{ROLE_LABELS[u.role] ?? u.role}</td>
                      <td className="table-cell">
                        <Badge tone={u.status === 'ACTIVE' ? 'green' : 'neutral'}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                          <Badge tone="amber" className="ml-1">
                            Locked
                          </Badge>
                        )}
                      </td>
                      <td className="table-cell text-xs text-ink-300" title={fmtDateTime(u.lastLoginAt)}>
                        {fmtRelative(u.lastLoginAt)}
                      </td>
                      <td className="table-cell text-right">
                        <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} disabled={!ready || u.status !== 'ACTIVE'} loading={opening === u.id} onClick={() => void open(u.id, { userId: u.id })}>
                          View as
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Recent sign-in activity" description="From the organization's own audit trail">
            {!data.recentActivity.length ? (
              <EmptyState icon={<History className="h-6 w-6" />} title="No sign-in activity yet" />
            ) : (
              <ul className="divide-y divide-ink-800">
                {data.recentActivity.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      <span className="font-medium text-ink-100">{humanize(a.action)}</span>
                      <span className="text-ink-400"> · {a.userEmail ?? 'unknown user'}</span>
                      {typeof a.metadata?.impersonatedBy === 'string' && <Badge tone="violet" className="ml-2">via {a.metadata.impersonatedBy}</Badge>}
                    </span>
                    <span className="text-xs text-ink-400" title={fmtDateTime(a.createdAt)}>
                      {fmtRelative(a.createdAt)} {a.ipAddress && `· ${a.ipAddress}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="Admin login"
            actions={
              <Button size="sm" variant="secondary" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={!ready} onClick={() => setResetOpen(true)}>
                Reset password
              </Button>
            }
          >
            <div className="space-y-3 p-5 text-sm">
              {data.admin ? (
                <>
                  <div>
                    <p className="label">Login ID</p>
                    <span className="inline-flex items-center gap-1">
                      {data.admin.email} <CopyButton value={data.admin.email} label="Copy login ID" />
                    </span>
                  </div>
                  <div>
                    <p className="label">Password</p>
                    <PasswordReveal key={passwordVersion} organizationId={org.id} available={Boolean(data.credentials)} />
                  </div>
                  <p className="text-xs text-ink-400">
                    Last sign-in {fmtRelative(data.admin.lastLoginAt)}
                    {data.credentials && ` · password set by ${data.credentials.updatedBy ?? 'the admin'} ${fmtRelative(data.credentials.updatedAt)}`}
                  </p>
                </>
              ) : (
                <p className="text-ink-400">No admin account found.</p>
              )}
            </div>
          </Card>

          <Card title="Organization">
            <div className="p-5">
              <KeyValue
                items={[
                  ['Database', <span key="db" className="font-mono text-xs">{org.databaseName ?? 'primary (shared)'}</span>],
                  ['Slug', org.slug],
                  ['Contact', org.contactName],
                  ['Contact email', org.contactEmail],
                  ['Contact phone', org.contactPhone],
                  ['Registered', fmtDateTime(org.createdAt)],
                  ['History limit', org.detectionRetentionDays ? `${org.detectionRetentionDays} days` : 'None'],
                  ['Oldest detection', fmtDateTime(stats?.oldestEventAt)],
                ]}
              />
            </div>
          </Card>
        </div>
      </div>

      {catalog && ready && (
        <div className="mt-6">
          <PlanEditor key={org.updatedAt} org={org} catalog={catalog} onSaved={setOrg} />
        </div>
      )}

      <ResetPasswordDialog
        open={resetOpen}
        org={org}
        email={data.admin?.email ?? null}
        onClose={() => setResetOpen(false)}
        onDone={() => {
          setPasswordVersion((v) => v + 1);
          void reload();
        }}
      />
      <HoldDialog
        open={holdOpen}
        org={org}
        onClose={() => setHoldOpen(false)}
        onDone={(o) => {
          setOrg(o);
          void reload();
        }}
      />
    </>
  );
}

'use client';

import { ArrowLeft, Camera, Database, Eye, KeyRound, MonitorPlay, Save } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CameraStatusBadge } from '@/components/badges';
import { AccountDialog, CopyButton, FeatureChecklist, OrgStatusBadge, ResetPasswordDialog, RetentionPicker, planByCode } from '@/components/platform/ClientControls';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, StatCard } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { fmtBytes, fmtDateTime, fmtRelative, humanize, ROLE_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { openClientConsole, type ClientDetail, type FeatureInfo, type PlanInfo, type PlatformOrganization } from '@/lib/platform';
import type { OrganizationTypeCode, OrganizationTypeInfo } from '@/lib/premises';
import type { FeatureKey } from '@/lib/types';

const READY = new Set(['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED']);

function PlanEditor({ org, catalog, plans, types, onSaved }: { org: PlatformOrganization; catalog: FeatureInfo[]; plans: PlanInfo[]; types: OrganizationTypeInfo[]; onSaved: (o: PlatformOrganization) => void }) {
  const notify = useToast();
  const [draft, setDraft] = useState({
    name: org.name,
    code: org.code ?? '',
    contactName: org.contactName ?? '',
    contactEmail: org.contactEmail ?? '',
    contactPhone: org.contactPhone ?? '',
    timezone: org.timezone || 'UTC',
    subscriptionPlan: org.subscriptionPlan ?? 'PROFESSIONAL',
    features: org.features,
    detectionRetentionDays: org.detectionRetentionDays ?? 30,
    retentionGraceDays: org.retentionGraceDays ?? 0,
    retentionMode: org.retentionMode ?? 'ENFORCE',
    cameraLimit: org.cameraLimit ? String(org.cameraLimit) : '',
    storageGb: org.storageLimitBytes ? String(Math.round(org.storageLimitBytes / 1024 ** 3)) : '',
    organizationType: org.organizationType || 'OTHER',
    capacity: org.capacity ? String(org.capacity) : '',
  });
  const [saving, setSaving] = useState(false);
  const allowed = planByCode(plans, draft.subscriptionPlan)?.features;

  const chosenType = types.find((item) => item.code === draft.organizationType);

  function chooseType(code: OrganizationTypeCode) {
    const next = types.find((item) => item.code === code);
    const stillValid = next?.capacities.map(String).includes(draft.capacity);
    setDraft({ ...draft, organizationType: code, capacity: stillValid ? draft.capacity : String(next?.capacities[0] ?? '') });
  }

  async function save() {
    if (draft.capacity && chosenType && !chosenType.capacities.map(String).includes(draft.capacity)) {
      notify('error', 'Not saved', 'Choose a capacity listed for this organization type.');
      return;
    }
    setSaving(true);
    try {
      const { storageGb, capacity: capacityText, cameraLimit, ...rest } = draft;
      const { data } = await api.patch<PlatformOrganization>(`/platform/organizations/${org.id}`, {
        ...rest,
        cameraLimit: cameraLimit ? Number(cameraLimit) : null,
        storageLimitBytes: storageGb ? Math.round(Number(storageGb) * 1024 ** 3) : null,
        ...(capacityText ? { capacity: Number(capacityText) } : {}),
      });
      onSaved(data);
      notify('success', 'Organization updated', 'Feature and retention changes apply immediately.');
    } catch (err) {
      notify('error', 'Not saved', err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Edit organization"
      description="Changes apply without a redeploy. Unsupported features cannot be enabled."
      actions={<Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void save()}>Save changes</Button>}
    >
      <div className="space-y-6 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Code"><Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></Field>
          <Field label="Email"><Input value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} /></Field>
          <Field label="Phone"><Input value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} /></Field>
          <Field label="Contact"><Input value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} /></Field>
          <Field label="Time zone"><Input value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></Field>
          <Field label="Organization type" hint={chosenType?.description}>
            <Select value={draft.organizationType} onChange={(e) => chooseType(e.target.value as OrganizationTypeCode)}>
              {types.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </Select>
          </Field>
          <Field label={chosenType?.capacityLabel ?? 'Capacity'}>
            <Select value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}>
              {!draft.capacity && <option value="">Not set</option>}
              {(chosenType?.capacities ?? []).map((value) => (
                <option key={value} value={value}>{value.toLocaleString()} {chosenType?.capacityUnit}</option>
              ))}
            </Select>
          </Field>
          <Field label="Plan">
            <Select value={draft.subscriptionPlan} onChange={(e) => setDraft({ ...draft, subscriptionPlan: e.target.value })}>
              {plans.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </Select>
          </Field>
          <Field label="Camera limit"><Input value={draft.cameraLimit} onChange={(e) => setDraft({ ...draft, cameraLimit: e.target.value })} /></Field>
          <Field label="Storage limit (GB)"><Input value={draft.storageGb} onChange={(e) => setDraft({ ...draft, storageGb: e.target.value })} /></Field>
          <Field label="Grace days"><Input type="number" value={draft.retentionGraceDays} onChange={(e) => setDraft({ ...draft, retentionGraceDays: Number(e.target.value) })} /></Field>
          <Field label="Cleanup mode">
            <Select value={draft.retentionMode} onChange={(e) => setDraft({ ...draft, retentionMode: e.target.value as 'DRY_RUN' | 'ENFORCE' })}>
              <option value="DRY_RUN">Dry run</option>
              <option value="ENFORCE">Enforce deletion</option>
            </Select>
          </Field>
        </div>
        <FeatureChecklist catalog={catalog} value={draft.features} onChange={(features: FeatureKey[]) => setDraft({ ...draft, features })} allowed={allowed} />
        <RetentionPicker value={draft.detectionRetentionDays} onChange={(days) => setDraft({ ...draft, detectionRetentionDays: days })} max={planByCode(plans, draft.subscriptionPlan)?.retentionMaxDays} />
      </div>
    </Card>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const notify = useToast();
  const { data, loading, error, reload, setData } = useApi<ClientDetail>(`/platform/organizations/${id}`);
  const { data: catalog } = useApi<FeatureInfo[]>('/platform/features');
  const { data: plans } = useApi<PlanInfo[]>('/platform/plans');
  const { data: types } = useApi<OrganizationTypeInfo[]>('/platform/organization-types');
  const [resetOpen, setResetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner error={error} onRetry={reload} />;
  const org = data.organization;
  const ready = READY.has(org.status);

  async function open(key: string, opts: { userId?: string; path?: string; purpose?: 'LIVE_PREVIEW' } = {}) {
    setOpening(key);
    try {
      await openClientConsole(org.id, opts);
    } catch (err) {
      notify('error', 'Could not open client console', errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      await api.post(`/platform/organizations/${org.id}/provision/retry`);
      notify('success', 'Provisioning retried', org.name);
      await reload();
    } catch (err) {
      notify('error', 'Retry failed', errorMessage(err));
    } finally {
      setRetrying(false);
    }
  }

  const setOrg = (next: PlatformOrganization) => setData((prev) => (prev ? { ...prev, organization: next } : prev));

  return (
    <>
      <Link href="/platform/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-100"><ArrowLeft className="h-4 w-4" /> All clients</Link>
      <PageHeader
        title={org.name}
        icon={<Database className="h-5 w-5" />}
        description={<span className="inline-flex flex-wrap items-center gap-2"><OrgStatusBadge status={org.status} /><span className="font-mono text-xs text-ink-400">{org.code}</span>{org.holdReason && <span className="text-xs text-amber-300">{org.holdReason}</span>}</span>}
        actions={
          <>
            <Button icon={<Eye className="h-4 w-4" />} disabled={!ready || !data.admin} loading={opening === 'admin'} onClick={() => void open('admin')}>Open dashboard</Button>
            <Button variant="secondary" icon={<MonitorPlay className="h-4 w-4" />} disabled={!ready || !data.admin} loading={opening === 'live'} onClick={() => void open('live', { purpose: 'LIVE_PREVIEW', path: '/monitoring' })}>Live preview</Button>
            <Button variant="secondary" disabled={!ready} onClick={() => setAccountOpen(true)}>Account</Button>
            {org.status === 'FAILED' && <Button loading={retrying} onClick={() => void retry()}>Retry provisioning</Button>}
          </>
        }
      />

      {org.provisioningError && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{org.provisioningError}</p>}

      {data.stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="Cameras" value={data.stats.cameras} sub={`${data.stats.camerasOnline} online · ${data.stats.camerasOffline ?? 0} offline`} icon={<Camera className="h-5 w-5" />} />
          <StatCard label="Detections" value={data.stats.eventsTotal} sub={`${data.stats.events24h} in 24h`} icon={<Database className="h-5 w-5" />} />
          <StatCard label="Storage" value={fmtBytes(data.storageUsedBytes)} sub={org.storageLimitBytes ? `of ${fmtBytes(org.storageLimitBytes)}` : 'No limit'} icon={<Database className="h-5 w-5" />} />
          <StatCard label="Users" value={data.stats.users} icon={<Eye className="h-5 w-5" />} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Cameras" description="Stream passwords and RTSP credentials stay on the server. Preview opens an audited session that ends when you leave or the session expires.">
            {!data.cameras.length ? <EmptyState icon={<Camera className="h-6 w-6" />} title="No cameras yet" /> : (
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
                {data.cameras.map((camera) => (
                  <div key={camera.id} className="rounded-xl border border-ink-700 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{camera.cameraName}</p>
                        <p className="text-xs text-ink-400">{[camera.location, camera.site].filter(Boolean).join(' · ')}</p>
                        <p className="font-mono text-[11px] text-ink-500">{camera.id}</p>
                      </div>
                      <CameraStatusBadge status={camera.status} monitoring={camera.monitoringEnabled} />
                    </div>
                    <p className="mt-2 text-xs text-ink-400">Last heartbeat {fmtRelative(camera.lastConnectedAt)} · {camera.status === 'ONLINE' ? 'Connected' : camera.status === 'ERROR' ? 'Reconnecting' : 'Unavailable'}</p>
                    {camera.lastError && <p className="mt-1 text-xs text-red-300">{camera.lastError}</p>}
                    <Button className="mt-3" size="sm" variant="secondary" disabled={!ready || !data.admin} loading={opening === camera.id} onClick={() => void open(camera.id, { purpose: 'LIVE_PREVIEW', path: '/monitoring' })}>Authorized preview</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Detection history" description="Rows past the retention cutoff are marked eligible. Legal holds and open investigations are kept.">
            {!data.detections.length ? <EmptyState title="No detections stored" /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-ink-700/70"><tr><th className="table-head">When</th><th className="table-head">Camera</th><th className="table-head">Type</th><th className="table-head">Status</th></tr></thead>
                  <tbody className="divide-y divide-ink-800">
                    {data.detections.map((event) => (
                      <tr key={event.id}>
                        <td className="table-cell text-xs">{fmtDateTime(event.eventTimestamp)}</td>
                        <td className="table-cell text-xs">{event.camera?.name ?? '—'}</td>
                        <td className="table-cell text-xs">{event.eventType}</td>
                        <td className="table-cell text-xs">
                          {event.reviewStatus}
                          {event.legalHold && <Badge tone="amber" className="ml-1">Legal hold</Badge>}
                          {event.eligibleForDeletion && <Badge className="ml-1">Eligible</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Users and access">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-ink-700/70"><tr><th className="table-head">User</th><th className="table-head">Role</th><th className="table-head">Status</th><th className="table-head text-right">Access</th></tr></thead>
                <tbody className="divide-y divide-ink-800">
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <td className="table-cell"><p className="font-medium">{user.name} {user.isPrimaryAdmin && <Badge tone="violet">Primary admin</Badge>}</p><p className="text-xs text-ink-400">{user.email}</p></td>
                      <td className="table-cell text-xs">{ROLE_LABELS[user.role] ?? user.role}</td>
                      <td className="table-cell text-xs">{user.status}</td>
                      <td className="table-cell text-right"><Button size="sm" variant="ghost" disabled={!ready || user.status !== 'ACTIVE'} loading={opening === user.id} onClick={() => void open(user.id, { userId: user.id })}>View as</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Overview">
            <div className="p-5">
              <KeyValue items={[
                ['Type', org.organizationTypeLabel],
                ['Capacity', org.capacity ? `${org.capacity.toLocaleString()} ${org.capacityUnit}` : null],
                ['Plan', org.subscriptionPlan],
                ['Database', org.databaseName],
                ['Time zone', org.timezone],
                ['Registered', fmtDateTime(org.createdAt)],
                ['Contact', org.contactEmail],
                ['Phone', org.contactPhone],
                ['Held', org.heldAt ? fmtDateTime(org.heldAt) : null],
              ]} />
            </div>
          </Card>
          <Card title="Administrator" actions={<Button size="sm" variant="secondary" icon={<KeyRound className="h-3.5 w-3.5" />} disabled={!ready} onClick={() => setResetOpen(true)}>Reset password</Button>}>
            <div className="space-y-2 p-5 text-sm">
              {data.admin ? (
                <>
                  <p className="inline-flex items-center gap-1">{data.admin.email}<CopyButton value={data.admin.email} /></p>
                  <p className="text-xs text-ink-400">Last sign-in {fmtRelative(data.admin.lastLoginAt)}. Passwords are not stored for viewing.</p>
                </>
              ) : <p className="text-ink-400">No administrator yet.</p>}
            </div>
          </Card>
          <Card title="Storage and retention">
            <div className="space-y-2 p-5 text-sm text-ink-300">
              <p>Used {fmtBytes(data.storageUsedBytes)}{org.storageLimitBytes ? ` of ${fmtBytes(org.storageLimitBytes)}` : ''}</p>
              <p>{org.detectionRetentionDays ?? '—'} day retention · {org.retentionGraceDays} day grace · {org.retentionMode === 'DRY_RUN' ? 'dry run' : 'enforced'}</p>
              <p>Next cleanup {fmtDateTime(data.nextCleanupAt)}</p>
              <p>Cutoff {fmtDateTime(data.retentionCutoff)}</p>
              {data.cleanup ? (
                <p className="text-xs text-ink-400">Last run {data.cleanup.mode}: processed {data.cleanup.processed}, deleted {data.cleanup.deleted}, failed {data.cleanup.failed}, remaining {data.cleanup.remaining}, holds skipped {data.cleanup.skippedHolds}.</p>
              ) : <p className="text-xs text-ink-400">No cleanup has run yet.</p>}
              <p className="text-xs text-ink-500">Backup copies follow the backup retention policy and are not erased by this job.</p>
              {data.holds.filter((hold) => hold.active).map((hold) => (
                <p key={hold.id} className="text-xs text-amber-200">{hold.holdType} hold: {hold.reason}</p>
              ))}
            </div>
          </Card>
          <Card title="Features">
            <ul className="max-h-80 space-y-1 overflow-auto p-5 text-sm">
              {(catalog ?? []).map((feature) => {
                const on = org.features.includes(feature.key);
                return <li key={feature.key} className={on ? 'text-ink-100' : 'text-ink-500'}>{on ? 'On' : 'Off'} · {feature.label}{!feature.supported ? ' (unavailable)' : ''}</li>;
              })}
            </ul>
          </Card>
        </div>
      </div>

      {catalog && plans && types && ready && (
        <div className="mt-6" id="plan">
          <PlanEditor key={org.updatedAt} org={org} catalog={catalog} plans={plans} types={types} onSaved={setOrg} />
        </div>
      )}

      <Card title="Audit history" className="mt-6">
        <ul className="divide-y divide-ink-800">
          {data.recentActivity.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span><span className="font-medium text-ink-100">{humanize(entry.action)}</span><span className="text-ink-400"> · {entry.userEmail ?? 'system'}</span></span>
              <span className="text-xs text-ink-400">{fmtRelative(entry.createdAt)} {entry.ipAddress && `· ${entry.ipAddress}`}</span>
            </li>
          ))}
          {!data.recentActivity.length && <li className="px-5 py-4 text-sm text-ink-400">No audit events yet.</li>}
        </ul>
      </Card>

      <ResetPasswordDialog open={resetOpen} org={org} email={data.admin?.email ?? null} onClose={() => setResetOpen(false)} />
      <AccountDialog open={accountOpen} org={org} onClose={() => setAccountOpen(false)} onDone={(next) => { setOrg(next); void reload(); }} />
    </>
  );
}

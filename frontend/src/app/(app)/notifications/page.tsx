'use client';

import { Bell, BellRing, CheckCheck, Send, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DeliveryBadge } from '@/components/badges';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, LoadingBlock, PageHeader, Pagination, Select, Switch, Tabs } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtRelative, ROLE_LABELS } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enablePush, pushUnsupportedReason } from '@/lib/push';
import { useSocketEvent } from '@/lib/socket';
import type { AppNotification, NotificationSettings, RoleName } from '@/lib/types';

type Tab = 'inbox' | 'logs' | 'settings';

function Inbox() {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, meta, raw, loading, error, reload, setData } = useApi<AppNotification[]>('/notifications', { page, pageSize: 20, unread: unreadOnly ? 'true' : undefined });
  useSocketEvent<AppNotification>('notification:new', (n) => page === 1 && setData((prev) => [n, ...(prev ?? [])].slice(0, 20)));

  async function read(n: AppNotification) {
    if (n.readAt) return;
    await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    setData((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700/70 p-4">
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} /> Unread only
          {typeof raw?.unread === 'number' && <Badge tone="blue">{raw.unread as number} unread</Badge>}
        </label>
        <Button size="sm" variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={async () => { await api.post('/notifications/read-all'); void reload(); }}>
          Mark all read
        </Button>
      </div>
      <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
      {loading && !data ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Alerts for unrecognized detections are delivered here in real time." />
      ) : (
        <ul className="divide-y divide-ink-800">
          {data.map((n) => (
            <li key={n.id} className={`flex items-start gap-3 px-5 py-4 ${n.readAt ? '' : 'bg-brand-500/5'}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-400'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-100">{n.title}</p>
                <p className="mt-0.5 text-sm break-words text-ink-300">{n.message}</p>
                <p className="mt-1 text-xs text-ink-400">{fmtDateTime(n.createdAt)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {n.eventId && (
                  <Link href={`/events/${n.eventId}`} onClick={() => void read(n)} className="text-xs text-brand-400 hover:text-brand-300">
                    Open event
                  </Link>
                )}
                {!n.readAt && (
                  <button onClick={() => void read(n)} className="text-xs text-ink-400 hover:text-ink-100">
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

function Logs() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const { data, meta, loading, error, reload } = useApi<AppNotification[]>('/notifications/logs', { page, pageSize: 25, channel, status });
  return (
    <>
      <div className="flex flex-wrap gap-3 border-b border-ink-700/70 p-4">
        <Select className="w-40" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} aria-label="Channel">
          <option value="">All channels</option>
          <option value="IN_APP">In-app</option>
          <option value="EMAIL">Email</option>
          <option value="PUSH">Push</option>
        </Select>
        <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="PENDING">Pending</option>
          <option value="FAILED">Failed</option>
          <option value="SKIPPED">Skipped</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>
      <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
      {loading && !data ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState title="No delivery records" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-ink-700/70">
              <tr>
                <th className="table-head">Created</th>
                <th className="table-head">Recipient</th>
                <th className="table-head">Channel</th>
                <th className="table-head">Status</th>
                <th className="table-head">Attempts</th>
                <th className="table-head">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {data.map((n) => (
                <tr key={n.id}>
                  <td className="table-cell whitespace-nowrap">{fmtDateTime(n.createdAt)}</td>
                  <td className="table-cell">
                    {n.recipient?.name}
                    <p className="text-xs text-ink-400">{n.recipient?.email}</p>
                  </td>
                  <td className="table-cell">
                    <Badge>{n.channel === 'IN_APP' ? 'In-app' : n.channel === 'EMAIL' ? 'Email' : 'Push'}</Badge>
                  </td>
                  <td className="table-cell">
                    <DeliveryBadge status={n.deliveryStatus} />
                  </td>
                  <td className="table-cell tabular-nums">{n.attempts}</td>
                  <td className="table-cell max-w-xs text-xs text-ink-300">
                    {n.lastError ?? (n.sentAt ? `Delivered ${fmtRelative(n.sentAt)}` : '—')}
                    {n.eventId && (
                      <Link href={`/events/${n.eventId}`} className="ml-2 text-brand-400">
                        event
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

const ROLES: RoleName[] = ['SUPER_ADMIN', 'SECURITY_ADMIN', 'SECURITY_OPERATOR', 'AUDITOR'];

function SettingsPanel() {
  const { can } = useAuth();
  const notify = useToast();
  const { data, loading, error, reload, setData } = useApi<NotificationSettings>('/notifications/settings');
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const editable = can('notifications:manage');
  const pushReason = typeof window !== 'undefined' ? pushUnsupportedReason() : null;

  useEffect(() => setDraft(data), [data]);
  if (loading && !draft) return <LoadingBlock />;
  if (!draft) return <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>;
  const d = draft;
  const set = (patch: Partial<NotificationSettings>) => setDraft({ ...d, ...patch });

  async function save() {
    setSaving(true);
    try {
      const { data: saved } = await api.patch<NotificationSettings>('/notifications/settings', {
        unknownAlerts: d.unknownAlerts,
        uncertainAlerts: d.uncertainAlerts,
        channels: d.channels,
        recipientRoles: d.recipientRoles,
        alertCooldownSec: d.alertCooldownSec,
        knownCooldownSec: d.knownCooldownSec,
        unknownCooldownSec: d.unknownCooldownSec,
      });
      setData(() => saved);
      notify('success', 'Notification settings saved');
    } catch (err) {
      notify('error', 'Save failed', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const { data: r } = await api.post<{ created: number; notifications: AppNotification[] }>('/notifications/test');
      const summary = r.notifications.map((n) => `${n.channel}: ${n.deliveryStatus}${n.lastError ? ` (${n.lastError})` : ''}`).join(' · ');
      notify('success', 'Test notification sent', summary || 'Check the delivery log for results.');
    } catch (err) {
      notify('error', 'Test failed', errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function registerPush() {
    setPushBusy(true);
    try {
      await enablePush();
      notify('success', 'Push enabled on this device');
    } catch (err) {
      notify('error', 'Push not enabled', errorMessage(err));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Alert triggers</h3>
        <Switch label="Unrecognized person alerts" description="Notify after a face stays unrecognized across two verification passes, including today's tally" checked={d.unknownAlerts} onChange={(v) => set({ unknownAlerts: v })} disabled={!editable} />
        <Switch label="Uncertain match alerts" description="Notify for low-confidence matches requiring review" checked={d.uncertainAlerts} onChange={(v) => set({ uncertainAlerts: v })} disabled={!editable} />
        <h3 className="pt-4 text-sm font-semibold">Channels</h3>
        <Switch label="In-app" description="Real-time notification center and toasts" checked={d.channels.inApp} onChange={(v) => set({ channels: { ...d.channels, inApp: v } })} disabled={!editable} />
        <Switch
          label="Email"
          description={d.providers.email ? 'SMTP configured' : 'SMTP is not configured — email deliveries are recorded as Skipped'}
          checked={d.channels.email}
          onChange={(v) => set({ channels: { ...d.channels, email: v } })}
          disabled={!editable}
        />
        <Switch
          label="Push (FCM)"
          description={d.providers.push ? 'Firebase configured on the server' : `Unavailable: ${d.providers.pushReason ?? 'not configured'}`}
          checked={d.channels.push}
          onChange={(v) => set({ channels: { ...d.channels, push: v } })}
          disabled={!editable}
        />
      </div>
      <div className="space-y-4">
        <div>
          <p className="label">Recipient roles</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => {
              const on = d.recipientRoles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!editable || (on && d.recipientRoles.length === 1)}
                  onClick={() => set({ recipientRoles: on ? d.recipientRoles.filter((x) => x !== r) : [...d.recipientRoles, r] })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 disabled:opacity-60 ${on ? 'bg-brand-600/20 text-brand-300 ring-brand-500/40' : 'text-ink-300 ring-ink-600'}`}
                >
                  {ROLE_LABELS[r]}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-ink-400">Site-scoped users only receive alerts for cameras at their sites.</p>
        </div>
        <Field label="Alert cooldown per camera (seconds)" hint="Suppresses repeat alerts; events are still recorded">
          <Input type="number" min={0} max={86400} value={d.alertCooldownSec} disabled={!editable} onChange={(e) => set({ alertCooldownSec: Number(e.target.value) })} />
        </Field>
        <Field label="Unknown-person dedup window (seconds)" hint="Same unrecognized face within this window is one event">
          <Input type="number" min={0} max={86400} value={d.unknownCooldownSec} disabled={!editable} onChange={(e) => set({ unknownCooldownSec: Number(e.target.value) })} />
        </Field>
        <Field label="Registered-person event cooldown (seconds)" hint="Per person per camera">
          <Input type="number" min={0} max={86400} value={d.knownCooldownSec} disabled={!editable} onChange={(e) => set({ knownCooldownSec: Number(e.target.value) })} />
        </Field>
        <div className="flex flex-wrap gap-2 pt-2">
          {editable && (
            <>
              <Button onClick={() => void save()} loading={saving}>
                Save settings
              </Button>
              <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => void test()} loading={testing}>
                Send test to me
              </Button>
            </>
          )}
          <Button variant="secondary" icon={<Smartphone className="h-4 w-4" />} onClick={() => void registerPush()} loading={pushBusy} disabled={Boolean(pushReason)} title={pushReason ?? undefined}>
            Enable push on this device
          </Button>
        </div>
        {pushReason && <p className="text-xs text-ink-400">{pushReason}</p>}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('inbox');
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  useEffect(() => setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission), []);
  return (
    <>
      <PageHeader
        title="Notification Center"
        icon={<Bell className="h-5 w-5" />}
        description="Your alerts, delivery history across channels, and alert configuration."
        actions={
          perm === 'default' && (
            <Button variant="secondary" icon={<BellRing className="h-4 w-4" />} onClick={() => void Notification.requestPermission().then(setPerm)}>
              Enable desktop alerts
            </Button>
          )
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'inbox', label: 'My notifications' },
              { value: 'logs', label: 'Delivery log', hidden: !can('notifications:view') },
              { value: 'settings', label: 'Settings', hidden: !can('notifications:view') },
            ]}
          />
        </div>
        {tab === 'inbox' && <Inbox />}
        {tab === 'logs' && <Logs />}
        {tab === 'settings' && <SettingsPanel />}
      </Card>
    </>
  );
}

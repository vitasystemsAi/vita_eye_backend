'use client';

import { Activity, AlertTriangle, Bell, Camera, CircleHelp, LayoutDashboard, RefreshCw, ShieldAlert, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import { CameraStatusBadge, EventTypeBadge, ReviewBadge } from '@/components/badges';
import { Legend, StackedBars } from '@/components/charts';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader, StatCard } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { fmtRelative, fmtTime, humanize, tzOffsetMinutes } from '@/lib/format';
import { useApi, useInterval } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { AuditEntry, DashboardSummary, DashboardTrends, EventSummary } from '@/lib/types';

function DashboardView() {
  const tz = tzOffsetMinutes();
  const { can } = useAuth();
  const summary = useApi<DashboardSummary>('/dashboard/summary', { tzOffset: tz });
  const trends = useApi<DashboardTrends>('/dashboard/trends', { days: 7, tzOffset: tz });
  const activity = useApi<{ events: EventSummary[]; audit: AuditEntry[] }>('/dashboard/activity', { limit: 10 });

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      void summary.reload();
      void trends.reload();
      void activity.reload();
    }, 1500);
  };
  useSocketEvent('event:new', refreshSoon);
  useSocketEvent('event:updated', refreshSoon);
  useSocketEvent('camera:status', refreshSoon);
  useInterval(() => void summary.reload(), 60_000);

  const s = summary.data;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });

  return (
    <>
      <PageHeader
        title="Security Dashboard"
        icon={<LayoutDashboard className="h-5 w-5" />}
        description={s ? `Live figures from the event database · updated ${fmtTime(s.generatedAt)}` : 'Live figures from the event database'}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { void summary.reload(); void trends.reload(); void activity.reload(); }}>
            Refresh
          </Button>
        }
      />
      <ErrorBanner error={summary.error} onRetry={summary.reload} />
      {!s && summary.loading ? (
        <LoadingBlock />
      ) : s ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Registered persons" value={s.registeredPersons} sub={`${s.enrolledPersons} with enrolled face templates`} icon={<Users className="h-5 w-5" />} href="/persons" />
          <StatCard label="Active cameras" value={s.activeCameras} sub={`${s.onlineCameras} online · ${s.offlineCameras} offline · ${s.errorCameras} error`} icon={<Camera className="h-5 w-5" />} tone={s.errorCameras ? 'amber' : 'green'} href="/cameras" />
          <StatCard label="Detections today" value={s.today.total} sub={`${s.today.known} registered · ${s.today.unknown} unrecognized · ${s.today.uncertain} uncertain`} icon={<Activity className="h-5 w-5" />} href="/events" />
          <StatCard label="Unrecognized today" value={s.today.unknown} sub="Faces with no gallery match" icon={<ShieldAlert className="h-5 w-5" />} tone={s.today.unknown ? 'red' : 'neutral'} href="/alerts" />
          <StatCard label="Recognized today" value={s.today.known} sub="Matched registered persons" icon={<UserCheck className="h-5 w-5" />} tone="green" href="/events?type=KNOWN" />
          <StatCard label="Uncertain pending review" value={s.uncertainPendingReview} sub="Below the match threshold" icon={<CircleHelp className="h-5 w-5" />} tone={s.uncertainPendingReview ? 'amber' : 'neutral'} href="/alerts?type=UNCERTAIN" />
          <StatCard label="Unresolved alerts" value={s.unresolvedAlerts} sub="Unrecognized + uncertain, not resolved" icon={<AlertTriangle className="h-5 w-5" />} tone={s.unresolvedAlerts ? 'red' : 'green'} href="/alerts" />
          <StatCard label="Unread notifications" value={s.unreadNotifications} sub={`${s.monitoringCameras} camera(s) monitoring`} icon={<Bell className="h-5 w-5" />} tone={s.unreadNotifications ? 'blue' : 'neutral'} href="/notifications" />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Detections — last 7 days" actions={<Legend />} className="xl:col-span-2">
          <div className="p-5">{trends.data ? <StackedBars data={trends.data.days} label={(d) => weekday.format(new Date(`${d.date}T12:00:00`))} height={220} /> : <LoadingBlock />}</div>
        </Card>
        <Card title="Camera health" description="Status reported by ingestion workers">
          {trends.data && trends.data.cameras.length === 0 && (
            <EmptyState icon={<Camera className="h-5 w-5" />} title="No cameras configured" action={can('cameras:manage') ? <Link href="/cameras" className="text-sm text-brand-400">Add a camera</Link> : undefined} />
          )}
          <ul className="divide-y divide-ink-800">
            {trends.data?.cameras.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-ink-400" title={c.lastError ?? undefined}>
                    {c.location}
                    {c.site ? ` · ${c.site}` : ''} · {c.eventsToday} today{c.lastError && c.status === 'ERROR' ? ` · ${c.lastError}` : ''}
                  </p>
                </div>
                <CameraStatusBadge status={c.isActive ? c.status : 'DISABLED'} monitoring={c.monitoringEnabled} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Today by hour" actions={<Legend />} className="xl:col-span-2">
          <div className="p-5">{trends.data ? <StackedBars data={trends.data.hourly} label={(d) => (d.hour % 3 === 0 ? `${String(d.hour).padStart(2, '0')}h` : '')} height={180} /> : <LoadingBlock />}</div>
        </Card>
        <Card title="Recent detections" actions={<Link href="/events" className="text-xs text-brand-400">View all</Link>}>
          {activity.data?.events.length === 0 && <EmptyState title="No detections yet" description="Events appear here as soon as monitored cameras confirm a face." />}
          <ul className="divide-y divide-ink-800">
            {activity.data?.events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
                  <div className="min-w-0">
                    <EventTypeBadge type={e.eventType} />
                    <p className="mt-1 truncate text-xs text-ink-300">
                      {e.person ? `${e.person.name} · ` : ''}
                      {e.camera?.name ?? '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    {e.eventType !== 'KNOWN' && <ReviewBadge status={e.reviewStatus} />}
                    <p className="mt-1 text-[11px] text-ink-400">{fmtRelative(e.eventTimestamp)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {can('audit:view') && activity.data && activity.data.audit.length > 0 && (
        <Card title="Recent administrative activity" className="mt-6" actions={<Link href="/audit" className="text-xs text-brand-400">Audit log</Link>}>
          <ul className="divide-y divide-ink-800">
            {activity.data.audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="truncate">
                  <span className="font-medium text-ink-100">{humanize(a.action)}</span>
                  <span className="text-ink-400"> · {a.user?.name ?? 'System'}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-400">{fmtRelative(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <RequirePermission permission="dashboard:view">
      <DashboardView />
    </RequirePermission>
  );
}

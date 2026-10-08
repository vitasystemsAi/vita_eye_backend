'use client';

import { MonitorPlay, Play, Radio, Square } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CameraStatusBadge, EventTypeBadge } from '@/components/badges';
import { BrowserMonitor } from '@/components/monitoring/BrowserMonitor';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtRelative, fmtTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { Camera, CameraStatus, EventSummary } from '@/lib/types';

function DetectionRow({ e }: { e: EventSummary }) {
  return (
    <>
      <div className="min-w-0">
        <EventTypeBadge type={e.eventType} />
        <p className="mt-1 truncate text-xs text-ink-300">
          {e.person?.name ? `${e.person.name} · ` : ''}
          {e.camera?.name}
        </p>
      </div>
      <span className="shrink-0 text-xs text-ink-400" title={fmtRelative(e.eventTimestamp)}>
        {fmtTime(e.eventTimestamp)}
      </span>
    </>
  );
}

function MonitoringView() {
  const { can, user } = useAuth();
  const preview = user?.role === 'PREVIEW';
  const notify = useToast();
  const cams = useApi<Camera[]>('/cameras', { pageSize: 200 });
  const recent = useApi<EventSummary[]>(can('events:view') ? '/events' : null, { pageSize: 15 });
  const [busy, setBusy] = useState<string | null>(null);

  const replace = (c: Camera) => cams.setData((prev) => (prev ?? []).map((x) => (x.id === c.id ? c : x)));

  useSocketEvent<{ cameraId: string; status: CameraStatus; error?: string | null; lastConnectedAt?: string }>('camera:status', (s) => {
    cams.setData((prev) => (prev ?? []).map((c) => (c.id === s.cameraId ? { ...c, status: s.status, lastError: s.error ?? null, lastConnectedAt: s.lastConnectedAt ?? c.lastConnectedAt } : c)));
  });
  useSocketEvent<EventSummary>('event:new', (e) => recent.setData((prev) => [e, ...(prev ?? []).filter((x) => x.id !== e.id)].slice(0, 15)));

  async function toggle(c: Camera) {
    setBusy(c.id);
    try {
      const { data } = await api.post<{ camera: Camera; message: string }>(`/cameras/${c.id}/${c.monitoringEnabled ? 'stop' : 'start'}-monitoring`);
      replace(data.camera);
      notify('success', data.message, c.cameraName);
    } catch (err) {
      notify('error', 'Action failed', errorMessage(err));
      void cams.reload();
    } finally {
      setBusy(null);
    }
  }

  const network = (cams.data ?? []).filter((c) => c.cameraType !== 'BROWSER');

  return (
    <>
      <PageHeader title="Live Monitoring" icon={<MonitorPlay className="h-5 w-5" />} description="Real-time recognition from this device's webcam and status of server-side camera streams." />
      <ErrorBanner error={cams.error} onRetry={cams.reload} />
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        <Card title="Browser camera" description="Streams from this computer to the recognition service" className="2xl:col-span-2">
          {cams.loading && !cams.data ? <LoadingBlock /> : <BrowserMonitor cameras={cams.data ?? []} onCameraChange={replace} />}
        </Card>
        <div className="space-y-6">
          <Card
            title="Live detections"
            description="Confirmed events across your sites"
            actions={preview ? undefined : <Link href="/events" className="text-xs text-brand-400">History</Link>}
          >
            {!can('events:view') ? (
              <p className="px-5 py-5 text-sm text-ink-400">Your role cannot view events.</p>
            ) : recent.data?.length === 0 ? (
              <EmptyState icon={<Radio className="h-5 w-5" />} title="Waiting for detections" />
            ) : (
              <ul className="max-h-[480px] divide-y divide-ink-800 overflow-y-auto">
                {recent.data?.map((e) => (
                  <li key={e.id}>
                    {preview ? (
                      <div className="flex items-center justify-between gap-3 px-5 py-3">
                        <DetectionRow e={e} />
                      </div>
                    ) : (
                      <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
                        <DetectionRow e={e} />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!preview && (
            <Card title="Network cameras" description="RTSP / ONVIF / MJPEG ingested by the AI service">
              {network.length === 0 ? (
                <p className="px-5 py-5 text-sm text-ink-400">No network cameras configured.</p>
              ) : (
                <ul className="divide-y divide-ink-800">
                  {network.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.cameraName}</p>
                        <p className="truncate text-xs text-ink-400" title={c.lastError ?? undefined}>
                          {c.status === 'ERROR' && c.lastError ? c.lastError : `${c.location} · seen ${fmtRelative(c.lastConnectedAt)}`}
                        </p>
                        <div className="mt-1">
                          <CameraStatusBadge status={c.isActive ? c.status : 'DISABLED'} monitoring={c.monitoringEnabled} />
                        </div>
                      </div>
                      {can('cameras:monitor') && c.isActive && (
                        <Button size="sm" variant={c.monitoringEnabled ? 'secondary' : 'primary'} loading={busy === c.id} icon={c.monitoringEnabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => void toggle(c)}>
                          {c.monitoringEnabled ? 'Stop' : 'Start'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export default function MonitoringPage() {
  return (
    <RequirePermission permission="cameras:view">
      <MonitoringView />
    </RequirePermission>
  );
}

'use client';

import { MonitorPlay, Radio } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EventTypeBadge } from '@/components/badges';
import { EvidenceLightbox, EvidenceThumb, useEvidenceImages } from '@/components/events/EvidenceThumbnails';
import { CameraWall } from '@/components/monitoring/CameraWall';
import { RequirePermission } from '@/components/RequirePermission';
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader } from '@/components/ui/primitives';
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
  const images = useEvidenceImages(recent.data ?? [], can('evidence:view'));
  const [viewing, setViewing] = useState<EventSummary | null>(null);
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

  const detections = !can('events:view') ? (
    <p className="px-4 py-4 text-sm text-ink-400">Your role cannot view events.</p>
  ) : recent.data?.length === 0 ? (
    <EmptyState icon={<Radio className="h-5 w-5" />} title="Waiting for detections" />
  ) : (
    <ul className="divide-y divide-ink-800/80">
      {recent.data?.map((e) => (
        <li key={e.id}>
          {preview ? (
            <div className="flex items-center gap-3 px-4 py-2.5">
              <EvidenceThumb event={e} image={e.evidenceId ? images[e.evidenceId] : undefined} onOpen={() => setViewing(e)} />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <DetectionRow e={e} />
              </div>
            </div>
          ) : (
            <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
              <DetectionRow e={e} />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );

  if (preview) {
    return (
      <>
      <div className="absolute inset-0 bg-black">
        {cams.error && (
          <div className="absolute top-4 left-4 z-20 max-w-md">
            <ErrorBanner error={cams.error} onRetry={cams.reload} />
          </div>
        )}
        {cams.loading && !cams.data ? (
          <div className="flex h-full items-center justify-center">
            <LoadingBlock />
          </div>
        ) : (
          <CameraWall
            className="h-full rounded-none border-0"
            cameras={cams.data ?? []}
            busyId={busy}
            canMonitor={can('cameras:monitor')}
            onToggle={(camera) => void toggle(camera)}
            onCameraChange={replace}
          />
        )}
        {recent.data && recent.data.length > 0 && (
          <aside className="absolute top-16 right-4 bottom-20 z-20 w-96 overflow-y-auto rounded-xl bg-ink-950/80 ring-1 ring-white/10 backdrop-blur">
            <p className="sticky top-0 border-b border-white/10 bg-ink-950/90 px-4 py-3 text-sm font-semibold text-ink-100">Live detections</p>
            {detections}
          </aside>
        )}
      </div>
      <EvidenceLightbox event={viewing} image={viewing?.evidenceId ? images[viewing.evidenceId] : undefined} onClose={() => setViewing(null)} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Live Monitoring" icon={<MonitorPlay className="h-5 w-5" />} description="One window for every camera. Watch them together, pick a set, or open a single camera fullscreen." />
      <ErrorBanner error={cams.error} onRetry={cams.reload} />
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        {cams.loading && !cams.data ? (
          <LoadingBlock />
        ) : (
          <CameraWall
            className="w-full min-w-0 xl:flex-1"
            cameras={cams.data ?? []}
            busyId={busy}
            canMonitor={can('cameras:monitor')}
            onToggle={(camera) => void toggle(camera)}
            onCameraChange={replace}
          />
        )}
        <Card
          className="flex max-h-[calc(100vh-11rem)] w-full shrink-0 flex-col overflow-hidden xl:sticky xl:top-4 xl:w-80"
          title="Live detections"
          description="Confirmed events across your sites"
          actions={<Link href="/events" className="text-xs text-brand-400">History</Link>}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">{detections}</div>
        </Card>
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

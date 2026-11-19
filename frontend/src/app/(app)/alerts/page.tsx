'use client';

import { BellRing, ShieldAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EMPTY_FILTERS, EventFilters, filtersToQuery, type EventFilterState } from '@/components/events/EventFilters';
import { EventsTable } from '@/components/events/EventsTable';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, ErrorBanner, PageHeader, Pagination, Tabs } from '@/components/ui/primitives';
import { useApi, useDebounced } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { EventSummary } from '@/lib/types';

type Tab = 'UNKNOWN,UNCERTAIN' | 'UNKNOWN' | 'UNCERTAIN';

function AlertsView() {
  const params = useSearchParams();
  const initialTab = (params.get('type') as Tab | null) ?? 'UNKNOWN,UNCERTAIN';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filters, setFilters] = useState<EventFilterState>({ ...EMPTY_FILTERS, reviewStatus: 'NEW,ACKNOWLEDGED,INVESTIGATING' });
  const [page, setPage] = useState(1);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const debounced = useDebounced(filters);
  const { data, meta, loading, error, reload, setData } = useApi<EventSummary[]>('/events', { ...filtersToQuery(debounced), type: tab, page, pageSize: 25 });
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  useSocketEvent<EventSummary>('event:new', (e) => {
    if (e.eventType === 'KNOWN' || !tab.split(',').includes(e.eventType) || page !== 1) return;
    if (filters.cameraId && e.camera?.id !== filters.cameraId) return;
    setData((prev) => [e, ...(prev ?? []).filter((x) => x.id !== e.id)].slice(0, 25));
    setHighlight((h) => new Set(h).add(e.id));
  });
  useSocketEvent<{ id: string; reviewStatus: EventSummary['reviewStatus'] }>('event:updated', (u) => {
    setData((prev) => (prev ?? []).map((x) => (x.id === u.id ? { ...x, reviewStatus: u.reviewStatus } : x)));
  });

  return (
    <>
      <PageHeader
        title="Unknown Alerts"
        icon={<ShieldAlert className="h-5 w-5" />}
        description="Unrecognized faces are listed as soon as a clear look is confirmed. Someone who walks through the frame is still recorded. Uncertain matches still need a person to review them."
        actions={
          notifPerm === 'default' && (
            <Button variant="secondary" icon={<BellRing className="h-4 w-4" />} onClick={() => void Notification.requestPermission().then(setNotifPerm)}>
              Enable desktop alerts
            </Button>
          )
        }
      />
      <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100/90">
        An &quot;unrecognized&quot; result only means the face is not in the enrolled gallery or image quality was insufficient. It is not evidence of wrongdoing. VITA EYE never triggers doors or physical responses automatically.
      </div>
      <Card>
        <div className="px-4 pt-2">
          <Tabs
            value={tab}
            onChange={(t) => { setTab(t); setPage(1); }}
            tabs={[
              { value: 'UNKNOWN,UNCERTAIN', label: 'All alerts' },
              { value: 'UNKNOWN', label: 'Unrecognized' },
              { value: 'UNCERTAIN', label: 'Uncertain matches' },
            ]}
          />
        </div>
        <EventFilters value={filters} onChange={(f) => { setFilters(f); setPage(1); }} lockType />
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        <EventsTable events={data ?? []} loading={loading} highlight={highlight} emptyText="No open alerts. New unrecognized detections appear here in real time." />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export default function AlertsPage() {
  return (
    <RequirePermission permission="events:view">
      <Suspense>
        <AlertsView />
      </Suspense>
    </RequirePermission>
  );
}

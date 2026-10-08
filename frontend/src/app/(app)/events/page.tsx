'use client';

import { Download, History } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EMPTY_FILTERS, EventFilters, filtersToQuery, type EventFilterState } from '@/components/events/EventFilters';
import { EventsTable } from '@/components/events/EventsTable';
import { ExportDialog } from '@/components/events/ExportDialog';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, ErrorBanner, PageHeader, Pagination, Select } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { EventSummary } from '@/lib/types';

function EventsView() {
  const params = useSearchParams();
  const { can } = useAuth();
  const [filters, setFilters] = useState<EventFilterState>({ ...EMPTY_FILTERS, type: params.get('type') ?? '', cameraId: params.get('cameraId') ?? '' });
  const personId = params.get('personId') ?? '';
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('eventTimestamp:desc');
  const [exportOpen, setExportOpen] = useState(false);
  const [fresh, setFresh] = useState(0);
  const debounced = useDebounced(filters);
  const [sortField, order] = sort.split(':');
  const query = { ...filtersToQuery(debounced), personId, page, pageSize: 25, sort: sortField, order };
  const { data, meta, loading, error, reload } = useApi<EventSummary[]>('/events', query);

  useSocketEvent<EventSummary>('event:new', () => setFresh((n) => n + 1));

  return (
    <>
      <PageHeader
        title="Detection History"
        icon={<History className="h-5 w-5" />}
        description="Every confirmed recognition event, with filters and audited PDF, Excel and CSV export."
        actions={
          <>
            <Select className="w-52" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="eventTimestamp:desc">Newest first</option>
              <option value="eventTimestamp:asc">Oldest first</option>
              <option value="confidenceScore:desc">Highest similarity</option>
              <option value="confidenceScore:asc">Lowest similarity</option>
              <option value="eventType:asc">Classification</option>
              <option value="reviewStatus:asc">Review status</option>
            </Select>
            {can('events:export') && (
              <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => setExportOpen(true)}>
                Export
              </Button>
            )}
          </>
        }
      />
      <Card>
        <EventFilters value={filters} onChange={(f) => { setFilters(f); setPage(1); }} />
        {fresh > 0 && (
          <button onClick={() => { setFresh(0); setPage(1); void reload(); }} className="w-full border-b border-ink-700/70 bg-brand-500/10 px-4 py-2 text-sm text-brand-300 hover:bg-brand-500/15">
            {fresh} new event(s) — click to refresh
          </button>
        )}
        {personId && <p className="border-b border-ink-700/70 px-4 py-2 text-xs text-ink-300">Filtered to one registered person.</p>}
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        <EventsTable events={data ?? []} loading={loading} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} query={{ ...filtersToQuery(filters), personId, sort: sortField, order }} />
    </>
  );
}

export default function EventsPage() {
  return (
    <RequirePermission permission="events:view">
      <Suspense>
        <EventsView />
      </Suspense>
    </RequirePermission>
  );
}

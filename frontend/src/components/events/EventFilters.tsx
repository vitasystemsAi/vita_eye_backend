'use client';

import { Search, X } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui/primitives';
import { useApi } from '@/lib/hooks';
import type { Camera } from '@/lib/types';

export interface EventFilterState {
  type: string;
  reviewStatus: string;
  cameraId: string;
  site: string;
  from: string;
  to: string;
  search: string;
}

export const EMPTY_FILTERS: EventFilterState = { type: '', reviewStatus: '', cameraId: '', site: '', from: '', to: '', search: '' };

/** Converts local datetime-input values to ISO timestamps for the API. */
export function filtersToQuery(f: EventFilterState) {
  return {
    type: f.type,
    reviewStatus: f.reviewStatus,
    cameraId: f.cameraId,
    site: f.site,
    search: f.search,
    from: f.from ? new Date(f.from).toISOString() : '',
    to: f.to ? new Date(f.to).toISOString() : '',
  };
}

export function EventFilters({ value, onChange, lockType }: { value: EventFilterState; onChange: (v: EventFilterState) => void; lockType?: boolean }) {
  const cams = useApi<Camera[]>('/cameras', { pageSize: 200 });
  const sites = (cams.raw?.sites as string[] | undefined) ?? [];
  const set = (k: keyof EventFilterState, v: string) => onChange({ ...value, [k]: v });
  const active = Object.entries(value).some(([k, v]) => v && !(lockType && k === 'type'));

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-ink-700/70 p-4">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
        <Input placeholder="Event ID, person, camera or location" className="pl-9" value={value.search} onChange={(e) => set('search', e.target.value)} />
      </div>
      {!lockType && (
        <Select className="w-44" value={value.type} onChange={(e) => set('type', e.target.value)} aria-label="Classification">
          <option value="">All classifications</option>
          <option value="KNOWN">Registered</option>
          <option value="UNKNOWN">Unrecognized</option>
          <option value="UNCERTAIN">Uncertain</option>
          <option value="UNKNOWN,UNCERTAIN">Unrecognized + uncertain</option>
        </Select>
      )}
      <Select className="w-44" value={value.reviewStatus} onChange={(e) => set('reviewStatus', e.target.value)} aria-label="Review status">
        <option value="">All review states</option>
        <option value="NEW,ACKNOWLEDGED,INVESTIGATING">Open (not resolved)</option>
        <option value="NEW">New</option>
        <option value="ACKNOWLEDGED">Acknowledged</option>
        <option value="INVESTIGATING">Investigating</option>
        <option value="RESOLVED">Resolved</option>
      </Select>
      <Select className="w-44" value={value.cameraId} onChange={(e) => set('cameraId', e.target.value)} aria-label="Camera">
        <option value="">All cameras</option>
        {cams.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.cameraName}
          </option>
        ))}
      </Select>
      {sites.length > 0 && (
        <Select className="w-36" value={value.site} onChange={(e) => set('site', e.target.value)} aria-label="Site">
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      )}
      <div>
        <label className="label">From</label>
        <Input type="datetime-local" className="w-52" value={value.from} onChange={(e) => set('from', e.target.value)} />
      </div>
      <div>
        <label className="label">To</label>
        <Input type="datetime-local" className="w-52" value={value.to} onChange={(e) => set('to', e.target.value)} />
      </div>
      {active && (
        <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => onChange({ ...EMPTY_FILTERS, type: lockType ? value.type : '' })}>
          Clear
        </Button>
      )}
    </div>
  );
}

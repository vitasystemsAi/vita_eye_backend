'use client';

import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Card, EmptyState, ErrorBanner, Input, LoadingBlock, PageHeader, Pagination, Select } from '@/components/ui/primitives';
import { fmtDateTime, humanize } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { AuditEntry } from '@/lib/types';

const CATEGORIES: Array<[string, string]> = [
  ['', 'All categories'],
  ['auth', 'Authentication'],
  ['biometric', 'Biometric data'],
  ['evidence', 'Evidence & exports'],
  ['events', 'Event review'],
  ['cameras', 'Cameras'],
  ['admin', 'Administration'],
];

function tone(action: string): 'red' | 'amber' | 'green' | 'blue' | 'neutral' | 'violet' {
  if (/FAILED|LOCKED|REUSE|BLOCKED/.test(action)) return 'red';
  if (/DELETED|PURGE/.test(action)) return 'amber';
  if (/EVIDENCE|EXPORT/.test(action)) return 'violet';
  if (/LOGIN_SUCCESS|ENROLLED|RESOLVED/.test(action)) return 'green';
  if (/CREATED|UPDATED|STARTED|STOPPED/.test(action)) return 'blue';
  return 'neutral';
}

function AuditView() {
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const a = useDebounced(action.trim().toUpperCase());
  const { data, meta, loading, error, reload } = useApi<AuditEntry[]>('/audit-logs', {
    category,
    action: a,
    entityType,
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to).toISOString() : '',
    page,
    pageSize: 50,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Audit Logs" icon={<ScrollText className="h-5 w-5" />} description="Immutable record of sign-ins, biometric operations, evidence access, configuration and review actions." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-700/70 p-4">
          <Select className="w-48" value={category} onChange={(e) => { setCategory(e.target.value); reset(); }} aria-label="Category">
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input className="w-56 font-mono" placeholder="Exact action, e.g. LOGIN_FAILED" value={action} onChange={(e) => { setAction(e.target.value); reset(); }} />
          <Select className="w-48" value={entityType} onChange={(e) => { setEntityType(e.target.value); reset(); }} aria-label="Entity">
            <option value="">All entities</option>
            <option value="user">Users</option>
            <option value="registered_person">Registered persons</option>
            <option value="camera">Cameras</option>
            <option value="detection_event">Detection events</option>
            <option value="evidence">Evidence</option>
            <option value="settings">Settings</option>
            <option value="notification">Notifications</option>
          </Select>
          <div>
            <label className="label">From</label>
            <Input type="datetime-local" className="w-52" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          </div>
          <div>
            <label className="label">To</label>
            <Input type="datetime-local" className="w-52" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
          </div>
        </div>
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        {loading && !data ? (
          <LoadingBlock />
        ) : !data?.length ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No audit entries match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head w-8" />
                  <th className="table-head">Time</th>
                  <th className="table-head">Action</th>
                  <th className="table-head">Actor</th>
                  <th className="table-head">Entity</th>
                  <th className="table-head">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer hover:bg-ink-800/40" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="table-cell text-ink-400">{e.metadata ? open === e.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : null}</td>
                      <td className="table-cell whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                      <td className="table-cell">
                        <Badge tone={tone(e.action)}>{humanize(e.action)}</Badge>
                      </td>
                      <td className="table-cell">
                        {e.user?.name ?? <span className="text-ink-400">System / anonymous</span>}
                        {e.user?.email && <p className="text-xs text-ink-400">{e.user.email}</p>}
                      </td>
                      <td className="table-cell text-xs">
                        {e.entityType ? humanize(e.entityType) : '—'}
                        {e.entityId && <p className="font-mono text-[11px] text-ink-400">{e.entityId}</p>}
                      </td>
                      <td className="table-cell font-mono text-xs text-ink-300">{e.ipAddress ?? '—'}</td>
                    </tr>
                    {open === e.id && e.metadata && (
                      <tr>
                        <td />
                        <td colSpan={5} className="px-4 pb-4">
                          <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-xs text-ink-200">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission permission="audit:view">
      <AuditView />
    </RequirePermission>
  );
}

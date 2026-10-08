'use client';

import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader, Select } from '@/components/ui/primitives';
import { fmtDateTime, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { ClientRow } from '@/lib/platform';

interface PlatformAuditEntry {
  id: number;
  platformAdminId: string | null;
  organizationId: string | null;
  action: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function PlatformAuditPage() {
  const [organizationId, setOrganizationId] = useState('');
  const { data, loading, error, reload } = useApi<PlatformAuditEntry[]>('/platform/audit-logs', { organizationId, limit: 300 });
  const { data: orgs } = useApi<ClientRow[]>('/platform/organizations');
  const names = useMemo(() => new Map((orgs ?? []).map((o) => [o.id, o.name])), [orgs]);

  return (
    <>
      <PageHeader title="Platform audit" icon={<ScrollText className="h-5 w-5" />} description="Every platform sign-in, registration, plan change, password view or reset, hold and client view." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-700/70 px-4 py-3">
          <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="max-w-xs">
            <option value="">All organizations</option>
            {(orgs ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        {loading && !data ? (
          <LoadingBlock />
        ) : !data?.length ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No platform activity yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">When</th>
                  <th className="table-head">Action</th>
                  <th className="table-head">Organization</th>
                  <th className="table-head">Details</th>
                  <th className="table-head">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-ink-800/40">
                    <td className="table-cell text-xs whitespace-nowrap text-ink-300">{fmtDateTime(e.createdAt)}</td>
                    <td className="table-cell font-medium">{humanize(e.action)}</td>
                    <td className="table-cell text-sm">
                      {e.organizationId ? (
                        <Link href={`/platform/clients/${e.organizationId}`} className="text-brand-400 hover:text-brand-300">
                          {names.get(e.organizationId) ?? e.organizationId.slice(0, 8)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="table-cell max-w-md font-mono text-[11px] break-words text-ink-400">{e.metadata ? JSON.stringify(e.metadata) : '—'}</td>
                    <td className="table-cell text-xs text-ink-400">{e.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

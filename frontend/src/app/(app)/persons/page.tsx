'use client';

import { Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EnrollmentBadge } from '@/components/badges';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, LoadingBlock, PageHeader, Pagination, Select } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Person } from '@/lib/types';

function PersonsView() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [enrollment, setEnrollment] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, meta, loading, error, reload } = useApi<Person[]>('/persons', { search: q, status, enrollmentStatus: enrollment, page, pageSize: 20 });

  return (
    <>
      <PageHeader
        title="Face Registration"
        icon={<Users className="h-5 w-5" />}
        description="Registered persons and their enrollment status. Biometric templates are encrypted and never displayed."
        actions={
          can('persons:manage') && (
            <Link href="/persons/new">
              <Button icon={<UserPlus className="h-4 w-4" />}>Register person</Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-ink-700/70 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input placeholder="Search name, reference ID or department" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Select className="w-48" value={enrollment} onChange={(e) => { setEnrollment(e.target.value); setPage(1); }} aria-label="Enrollment">
            <option value="">All enrollment states</option>
            <option value="ENROLLED">Enrolled</option>
            <option value="PENDING">Not enrolled</option>
            <option value="FAILED">Failed</option>
            <option value="REVOKED">Revoked</option>
          </Select>
        </div>
        <div className="p-4 pb-0">
          <ErrorBanner error={error} onRetry={reload} />
        </div>
        {loading && !data ? (
          <LoadingBlock />
        ) : data?.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No registered persons" description="Register people who should be recognized by the system. Enrollment requires a documented legal basis." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">Name</th>
                  <th className="table-head">Reference ID</th>
                  <th className="table-head">Department</th>
                  <th className="table-head">Status</th>
                  <th className="table-head">Enrollment</th>
                  <th className="table-head">Templates</th>
                  <th className="table-head">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data?.map((p) => (
                  <tr key={p.id} className="hover:bg-ink-800/40">
                    <td className="table-cell">
                      <Link href={`/persons/${p.id}`} className="font-medium text-brand-300 hover:text-brand-200">
                        {p.personName}
                      </Link>
                    </td>
                    <td className="table-cell font-mono text-xs">{p.referenceId}</td>
                    <td className="table-cell text-ink-300">{p.department ?? '—'}</td>
                    <td className="table-cell">
                      <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="table-cell">
                      <EnrollmentBadge status={p.enrollmentStatus} />
                    </td>
                    <td className="table-cell tabular-nums">{p.templateCount}</td>
                    <td className="table-cell text-ink-300">{fmtDate(p.createdAt)}</td>
                  </tr>
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

export default function PersonsPage() {
  return (
    <RequirePermission permission="persons:view">
      <PersonsView />
    </RequirePermission>
  );
}

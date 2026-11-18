'use client';

import { ArrowLeftRight, Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EnrollmentBadge, PersonStatusBadge } from '@/components/badges';
import { PersonForm } from '@/components/persons/PersonForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Input, LoadingBlock, Modal, PageHeader, Pagination, Select, Tabs } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Person, PersonStatus } from '@/lib/types';

type Tab = PersonStatus;

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const TAB_NOTE: Record<Tab, string> = {
  ACTIVE: 'Enrolled people are included in recognition. Not enrolled registrations can be edited or deleted immediately, because no face is stored. Suspend pauses an enrolled person, or mark them inactive when they should leave.',
  SUSPENDED: 'Suspended people are out of recognition. Make active restores them. Delete is available 7 days after the suspension.',
  INACTIVE: 'Inactive people are out of recognition. Retrieve sends them back to active. Delete is available 7 days after they were marked inactive.',
};

const EMPTY: Record<Tab, { title: string; description: string }> = {
  ACTIVE: { title: 'No active registrations', description: 'Register people who should be recognized. Suspended and inactive people are on the other tabs.' },
  SUSPENDED: { title: 'No suspended people', description: 'Suspending someone removes them from recognition until you make them active again.' },
  INACTIVE: { title: 'No inactive people', description: 'Inactive people stay out of recognition until you retrieve them, and can be deleted after 7 days.' },
};

function unfinished(p: Person) {
  return p.canDiscard ?? (p.templateCount === 0 && (p.enrollmentStatus === 'PENDING' || p.enrollmentStatus === 'FAILED'));
}

function statusAction(from: PersonStatus, to: PersonStatus) {
  if (to === 'SUSPENDED') return { label: 'Suspend', title: 'Suspend registration', confirm: 'Suspend', tone: 'warning' as const, detail: 'They leave recognition immediately. Face templates are kept. You can make them active again from the Suspended tab.' };
  if (to === 'INACTIVE') return { label: 'Make inactive', title: 'Mark inactive', confirm: 'Make inactive', tone: 'warning' as const, detail: 'They leave recognition immediately. Retrieve them from the Inactive tab at any time. Permanent deletion is offered after 7 days.' };
  if (from === 'INACTIVE') return { label: 'Retrieve', title: 'Retrieve to active', confirm: 'Retrieve', tone: 'primary' as const, detail: 'They return to recognition with the face templates already enrolled.' };
  return { label: 'Make active', title: 'Make active', confirm: 'Make active', tone: 'primary' as const, detail: 'They return to recognition with the face templates already enrolled.' };
}

function PersonsView() {
  const { can, user } = useAuth();
  const tenant = user?.organization?.organizationType === 'HOSTEL';
  const notify = useToast();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search')?.trim() ?? '');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [enrollment, setEnrollment] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ person: Person; status: PersonStatus } | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [discarding, setDiscarding] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const q = useDebounced(search);
  const { data, meta, loading, error, reload } = useApi<Person[]>('/persons', { search: q, status: tab, enrollmentStatus: enrollment, page, pageSize: 20 });
  const manage = can('persons:manage');
  const remove = can('persons:delete');

  async function applyStatus() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.post(`/persons/${pending.person.id}/status`, { status: pending.status });
      const action = statusAction(pending.person.status, pending.status);
      notify('success', action.title, `${pending.person.personName} updated.`);
      setPending(null);
      reload();
    } catch (err) {
      notify('error', 'Update failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDiscard() {
    if (!discarding) return;
    setBusy(true);
    try {
      await api.post(`/persons/${discarding.id}/cancel`);
      notify('success', 'Registration deleted', `${discarding.personName} was removed. No face was stored.`);
      setDiscarding(null);
      reload();
    } catch (err) {
      notify('error', 'Delete failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || deleteText !== deleting.referenceId) return;
    setBusy(true);
    try {
      await api.delete(`/persons/${deleting.id}`);
      notify('success', 'Registration deleted', 'Biometric templates were permanently erased and the deletion was verified.');
      setDeleting(null);
      setDeleteText('');
      reload();
    } catch (err) {
      notify('error', 'Delete failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const pendingAction = pending ? statusAction(pending.person.status, pending.status) : null;

  return (
    <>
      <PageHeader
        title="Face Registration"
        icon={<Users className="h-5 w-5" />}
        description={tenant ? 'Tenant face enrollment. Open a registration to see the photos that were added.' : 'Registered persons and their enrollment status. Open a registration to see the photos that were added.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('data:export') && (
              <Link href="/data">
                <Button variant="secondary" icon={<ArrowLeftRight className="h-4 w-4" />}>Data exchange</Button>
              </Link>
            )}
            {manage && (
              <Link href="/persons/new">
                <Button icon={<UserPlus className="h-4 w-4" />}>{tenant ? 'Register tenant' : 'Register person'}</Button>
              </Link>
            )}
          </div>
        }
      />
      <Card>
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
          }}
          tabs={TABS}
        />
        <p className="border-b border-ink-700/70 px-4 py-3 text-sm text-ink-300">{TAB_NOTE[tab]}</p>
        <div className="flex flex-wrap gap-3 border-b border-ink-700/70 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input placeholder={tenant ? 'Search name, mobile number or room' : 'Search name, reference ID or department'} className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
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
          <EmptyState icon={<Users className="h-6 w-6" />} title={EMPTY[tab].title} description={EMPTY[tab].description} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">Name</th>
                  <th className="table-head">{tenant ? 'Mobile number' : 'Reference ID'}</th>
                  <th className="table-head">{tenant ? 'Room number' : 'Department'}</th>
                  <th className="table-head">Status</th>
                  <th className="table-head">Enrollment</th>
                  <th className="table-head">Templates</th>
                  <th className="table-head">Registered</th>
                  {(manage || remove) && <th className="table-head">Actions</th>}
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
                      <PersonStatusBadge status={p.status} />
                    </td>
                    <td className="table-cell">
                      <EnrollmentBadge status={p.enrollmentStatus} />
                    </td>
                    <td className="table-cell tabular-nums">{p.templateCount}</td>
                    <td className="table-cell text-ink-300">{fmtDate(p.createdAt)}</td>
                    {(manage || remove) && (
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1.5">
                          {manage && (
                            <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>
                          )}
                          {manage && unfinished(p) && (
                            <Button size="sm" variant="danger" onClick={() => setDiscarding(p)}>Delete</Button>
                          )}
                          {manage && !unfinished(p) && tab === 'ACTIVE' && (
                            <>
                              <Button size="sm" variant="warning" onClick={() => setPending({ person: p, status: 'SUSPENDED' })}>Suspend</Button>
                              <Button size="sm" variant="secondary" onClick={() => setPending({ person: p, status: 'INACTIVE' })}>Inactive</Button>
                            </>
                          )}
                          {manage && tab === 'SUSPENDED' && (
                            <Button size="sm" variant="secondary" onClick={() => setPending({ person: p, status: 'ACTIVE' })}>Make active</Button>
                          )}
                          {manage && tab === 'INACTIVE' && (
                            <Button size="sm" variant="secondary" onClick={() => setPending({ person: p, status: 'ACTIVE' })}>Retrieve</Button>
                          )}
                          {remove && !unfinished(p) && tab !== 'ACTIVE' && (
                            p.canDelete ? (
                              <Button size="sm" variant="danger" onClick={() => { setDeleting(p); setDeleteText(''); }}>Delete</Button>
                            ) : (
                              <span className="self-center text-xs text-ink-400">Delete {fmtDate(p.deleteAvailableAt)}</span>
                            )
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.personName}` : 'Edit registration'}>
        {editing && (
          <PersonForm
            key={editing.id}
            variant={tenant ? 'tenant' : 'person'}
            initial={{ personName: editing.personName, referenceId: editing.referenceId, department: editing.department ?? '', status: editing.status }}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              await api.patch(`/persons/${editing.id}`, { ...v, department: v.department || null });
              notify('success', 'Registration updated', `${v.personName} saved.`);
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!discarding}
        onClose={() => {
          if (!busy) setDiscarding(null);
        }}
        title="Delete registration"
        confirmLabel="Delete"
        dismissLabel="Keep"
        loading={busy}
        onConfirm={() => void confirmDiscard()}
        message={
          discarding ? (
            <p>
              <strong>{discarding.personName}</strong> ({discarding.referenceId}) has no face enrolled. Deleting removes the registration now. The reference ID can be used again.
            </p>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!pending && !!pendingAction}
        onClose={() => setPending(null)}
        title={pendingAction?.title ?? ''}
        confirmLabel={pendingAction?.confirm}
        tone={pendingAction?.tone === 'warning' ? 'warning' : 'primary'}
        loading={busy}
        onConfirm={() => void applyStatus()}
        message={pending && pendingAction ? <p><strong>{pending.person.personName}</strong> — {pendingAction.detail}</p> : null}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => { setDeleting(null); setDeleteText(''); }}
        title="Delete registration"
        confirmLabel="Delete permanently"
        loading={busy}
        onConfirm={() => void confirmDelete()}
        message={
          deleting ? (
            <>
              <p>
                This permanently erases all {deleting.templateCount} biometric template(s) for <strong>{deleting.personName}</strong>. The deletion is verified and recorded in the audit log.
              </p>
              <div className="mt-4">
                <label className="label">
                  Type <span className="font-mono normal-case">{deleting.referenceId}</span> to confirm
                </label>
                <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="font-mono" />
              </div>
            </>
          ) : null
        }
      />
    </>
  );
}

export default function PersonsPage() {
  return (
    <RequirePermission permission="persons:view">
      <Suspense fallback={<LoadingBlock />}>
        <PersonsView />
      </Suspense>
    </RequirePermission>
  );
}

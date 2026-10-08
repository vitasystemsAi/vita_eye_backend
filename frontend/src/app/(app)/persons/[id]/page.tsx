'use client';

import { ArrowLeft, Pencil, Power, ScanFace, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EnrollmentBadge } from '@/components/badges';
import { EventsTable } from '@/components/events/EventsTable';
import { EnrollmentPanel } from '@/components/persons/EnrollmentPanel';
import { PersonForm } from '@/components/persons/PersonForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, ConfirmDialog, ErrorBanner, Input, KeyValue, LoadingBlock, Modal, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtPercent, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { EventSummary, PersonDetail } from '@/lib/types';

function PersonDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const notify = useToast();
  const { can } = useAuth();
  const { data: p, error, loading, reload, setData } = useApi<PersonDetail>(`/persons/${id}`);
  const events = useApi<EventSummary[]>(can('events:view') ? '/events' : null, { personId: id, pageSize: 10 });
  const [editing, setEditing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading && !p) return <LoadingBlock />;
  if (!p) return <ErrorBanner error={error ?? { message: 'Not found' }} onRetry={reload} />;

  async function toggleActive() {
    if (!p) return;
    setBusy(true);
    try {
      const { data } = await api.post<PersonDetail>(`/persons/${p.id}/${p.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
      setData(() => data);
      notify('success', data.status === 'ACTIVE' ? 'Person activated' : 'Person deactivated', data.status === 'ACTIVE' ? 'Included in recognition again.' : 'Removed from the active recognition gallery.');
    } catch (err) {
      notify('error', 'Update failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!p) return;
    setBusy(true);
    try {
      await api.delete(`/persons/${p.id}`);
      notify('success', 'Registration deleted', 'Biometric templates were permanently erased and the deletion was verified.');
      router.replace('/persons');
    } catch (err) {
      notify('error', 'Delete failed', errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={p.personName}
        icon={<UserRound className="h-5 w-5" />}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.referenceId}</span>
            <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
            <EnrollmentBadge status={p.enrollmentStatus} />
          </span>
        }
        actions={
          <>
            <Link href="/persons">
              <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                Back
              </Button>
            </Link>
            {can('persons:manage') && (
              <>
                <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="secondary" icon={<Power className="h-4 w-4" />} loading={busy} onClick={() => void toggleActive()}>
                  {p.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
              </>
            )}
            {can('persons:enroll') && (
              <Button icon={<ScanFace className="h-4 w-4" />} onClick={() => setEnrolling(true)} disabled={p.status !== 'ACTIVE'}>
                {p.templateCount ? 'Add / replace face' : 'Enroll face'}
              </Button>
            )}
            {can('persons:delete') && (
              <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Registration" className="xl:col-span-2">
          <div className="p-5">
            <KeyValue
              items={[
                ['Department', p.department ?? '—'],
                ['Registered', fmtDateTime(p.createdAt)],
                ['Legal basis', p.legalBasis ? humanize(p.legalBasis) : 'Not recorded'],
                ['Consent reference', p.consentReference ?? '—'],
                ['Consent recorded', fmtDateTime(p.consentRecordedAt)],
                ['Enrolled by', p.enrolledBy?.name ?? '—'],
              ]}
            />
          </div>
        </Card>
        <Card title="Face templates" description="Encrypted at rest (AES-256-GCM); never exposed through the API">
          {p.templates.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-400">No templates enrolled.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {p.templates.map((t, i) => (
                <li key={t.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">Template {i + 1}</p>
                    <p className="text-xs text-ink-400">
                      {t.modelVersion} · {fmtDateTime(t.createdAt)}
                    </p>
                  </div>
                  <Badge tone={(t.qualityScore ?? 0) >= 0.6 ? 'green' : 'amber'}>Q {fmtPercent(t.qualityScore)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {can('events:view') && (
        <Card title="Recent detections" className="mt-6" actions={<Link href={`/events?personId=${p.id}`} className="text-xs text-brand-400">All detections</Link>}>
          <EventsTable events={events.data ?? []} loading={events.loading} compact />
        </Card>
      )}

      <Card title="Enrollment & change history" description="From the audit log" className="mt-6">
        {p.history.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-400">No history.</p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {p.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{humanize(h.action)}</span>
                  <span className="text-ink-400"> · {h.user?.name ?? 'System'}</span>
                  {h.metadata && 'templatesAdded' in h.metadata && <span className="text-ink-400"> · {String(h.metadata.templatesAdded)} template(s)</span>}
                </span>
                <span className="text-xs text-ink-400">{fmtDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit registration">
        <PersonForm
          initial={{ personName: p.personName, referenceId: p.referenceId, department: p.department ?? '', status: p.status }}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            const { data } = await api.patch<PersonDetail>(`/persons/${p.id}`, { ...v, department: v.department || null });
            setData(() => data);
            setEditing(false);
            notify('success', 'Registration updated');
          }}
        />
      </Modal>

      <Modal open={enrolling} onClose={() => setEnrolling(false)} title={`Enroll face — ${p.personName}`} size="xl">
        <EnrollmentPanel
          person={p}
          onEnrolled={(np) => {
            setData(() => np);
            setEnrolling(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => { setConfirmDelete(false); setDeleteText(''); }}
        title="Delete registration"
        confirmLabel="Delete permanently"
        loading={busy}
        onConfirm={() => deleteText === p.referenceId && void remove()}
        message={
          <>
            <p>
              This permanently erases all {p.templateCount} biometric template(s) for <strong>{p.personName}</strong> and removes the person from recognition. The deletion is verified and recorded in the audit log.
            </p>
            <p className="text-ink-400">Historical detection events are retained (per the retention policy) but will show the person as deleted.</p>
          </>
        }
      >
        <div className="mt-4">
          <label className="label">
            Type <span className="font-mono normal-case">{p.referenceId}</span> to confirm
          </label>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} className="font-mono" />
        </div>
      </ConfirmDialog>
    </>
  );
}

export default function PersonDetailPage() {
  return (
    <RequirePermission permission="persons:view">
      <PersonDetailView />
    </RequirePermission>
  );
}

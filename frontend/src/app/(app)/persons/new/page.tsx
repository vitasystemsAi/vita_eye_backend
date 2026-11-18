'use client';

import { ArrowLeft, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EnrolledFaces } from '@/components/persons/EnrolledFaces';
import { EnrollmentPanel } from '@/components/persons/EnrollmentPanel';
import { PersonForm } from '@/components/persons/PersonForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, ConfirmDialog, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Person, PersonDetail } from '@/lib/types';

function Steps({ step, tenant }: { step: 1 | 2 | 3; tenant: boolean }) {
  const items = tenant ? ['Tenant details', 'Face capture & consent', 'Done'] : ['Person details', 'Face capture & consent', 'Done'];
  return (
    <ol className="mb-6 flex flex-wrap gap-2">
      {items.map((label, i) => (
        <li key={label} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${i + 1 === step ? 'bg-brand-600/15 text-brand-300 ring-brand-500/40' : i + 1 < step ? 'text-emerald-300 ring-emerald-500/30' : 'text-ink-400 ring-ink-600'}`}>
          <span className="tabular-nums">{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}

function NewPersonView() {
  const router = useRouter();
  const notify = useToast();
  const { can, user } = useAuth();
  const tenant = user?.organization?.organizationType === 'HOSTEL';
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [done, setDone] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function cancelRegistration() {
    if (!person) return;
    setCancelling(true);
    try {
      await api.post(`/persons/${person.id}/cancel`);
      notify('success', 'Registration cancelled', `${person.personName} was removed.`);
      router.push('/persons');
    } catch (err) {
      notify('error', 'Could not cancel registration', errorMessage(err));
      setCancelling(false);
    }
  }

  return (
    <>
      <PageHeader
        title={tenant ? 'Register a tenant' : 'Register a person'}
        icon={<UserPlus className="h-5 w-5" />}
        description={
          tenant
            ? 'Save the tenant’s name, mobile number and room number, then capture a clear, aligned face. Monitoring uses that enrollment and will not show this name on a different person.'
            : 'Create the registration record, then capture a clear, aligned face. Monitoring uses that enrollment and will not show this name on a different person.'
        }
        actions={
          <>
            {person && !done && (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                Cancel registration
              </Button>
            )}
            <Link href="/persons">
              <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                Back to list
              </Button>
            </Link>
          </>
        }
      />
      <Steps step={done ? 3 : person ? 2 : 1} tenant={tenant} />
      {!person && (
        <Card title={tenant ? 'Tenant details' : 'Person details'}>
          <div className="p-5">
            <PersonForm
              variant={tenant ? 'tenant' : 'person'}
              submitLabel="Save and continue"
              onSubmit={async (v) => {
                const { data } = await api.post<Person>('/persons', { ...v, department: v.department || null });
                notify('success', 'Person registered', `${data.personName} (${data.referenceId})`);
                const full = await api.get<PersonDetail>(`/persons/${data.id}`);
                if (!can('persons:enroll')) {
                  router.push(`/persons/${data.id}`);
                  return;
                }
                setPerson(full.data);
              }}
            />
          </div>
        </Card>
      )}
      {person && !done && (
        <Card
          title={`Enroll face — ${person.personName}`}
          description={tenant ? `Mobile ${person.referenceId} · room ${person.department ?? '—'}` : `Reference ${person.referenceId}`}
          actions={
            <>
              <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel registration
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.push(`/persons/${person.id}`)}>
                Skip for now
              </Button>
            </>
          }
        >
          <div className="p-3 sm:p-5">
            <EnrollmentPanel
              person={person}
              onEnrolled={(p) => {
                setPerson(p);
                setDone(true);
              }}
            />
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => {
          if (!cancelling) setConfirmCancel(false);
        }}
        title="Cancel registration"
        message={
          person
            ? `${person.personName} (${person.referenceId}) will be removed. No face is stored, and monitoring will not use this name.`
            : 'This registration will be removed.'
        }
        confirmLabel="Cancel registration"
        dismissLabel="Keep registration"
        loading={cancelling}
        onConfirm={() => void cancelRegistration()}
      />
      {person && done && (
        <Card>
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-lg font-semibold text-emerald-300">{person.personName} is enrolled</p>
            <p className="max-w-lg text-sm text-ink-300">{person.templateCount} face(s) were added to the recognition gallery. Running cameras pick up the change automatically.</p>
            <div className="w-full max-w-lg text-left">
              <EnrolledFaces personId={person.id} templates={person.templates} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/persons/${person.id}`)}>View registration</Button>
              <Button variant="secondary" onClick={() => { setPerson(null); setDone(false); }}>
                Register another
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

export default function NewPersonPage() {
  return (
    <RequirePermission permission="persons:manage">
      <NewPersonView />
    </RequirePermission>
  );
}

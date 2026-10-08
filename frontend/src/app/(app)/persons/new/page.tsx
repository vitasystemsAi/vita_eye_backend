'use client';

import { ArrowLeft, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EnrollmentPanel } from '@/components/persons/EnrollmentPanel';
import { PersonForm } from '@/components/persons/PersonForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Person, PersonDetail } from '@/lib/types';

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const items = ['Person details', 'Face capture & consent', 'Done'];
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
  const { can } = useAuth();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [done, setDone] = useState(false);

  return (
    <>
      <PageHeader
        title="Register a person"
        icon={<UserPlus className="h-5 w-5" />}
        description="Create the registration record, then capture face images with a documented legal basis."
        actions={
          <Link href="/persons">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
              Back to list
            </Button>
          </Link>
        }
      />
      <Steps step={done ? 3 : person ? 2 : 1} />
      {!person && (
        <Card title="Person details">
          <div className="p-5">
            <PersonForm
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
        <Card title={`Enroll face — ${person.personName}`} description={`Reference ${person.referenceId}`} actions={<Button variant="ghost" size="sm" onClick={() => router.push(`/persons/${person.id}`)}>Skip for now</Button>}>
          <div className="p-5">
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
      {person && done && (
        <Card>
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <p className="text-lg font-semibold text-emerald-300">{person.personName} is enrolled</p>
            <p className="max-w-lg text-sm text-ink-300">{person.templateCount} encrypted template(s) were added to the recognition gallery. Running cameras pick up the change automatically.</p>
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

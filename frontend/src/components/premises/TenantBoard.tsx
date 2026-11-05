'use client';

import { ScanFace, Users } from 'lucide-react';
import { useState } from 'react';
import { EnrollmentBadge } from '@/components/badges';
import { EnrollmentPanel } from '@/components/persons/EnrollmentPanel';
import { PersonForm, type PersonFormValues } from '@/components/persons/PersonForm';
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, Modal, Pagination } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { PremisesOverview } from '@/lib/premises';
import type { Person, PersonDetail } from '@/lib/types';

export function TenantBoard({ remaining, onUpdated }: { remaining: number | null; onUpdated: (next: PremisesOverview) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [formKey, setFormKey] = useState(0);
  const [enrolling, setEnrolling] = useState<PersonDetail | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const { data, meta, loading, error, reload } = useApi<Person[]>('/persons', { page, pageSize: 20, sort: 'personName' });
  const manage = can('persons:manage');
  const enroll = can('persons:enroll');
  const full = remaining === 0;

  async function refreshPremises() {
    const overview = await api.get<PremisesOverview>('/premises');
    onUpdated(overview.data);
  }

  async function openFace(person: Person) {
    try {
      const detail = await api.get<PersonDetail>(`/persons/${person.id}`);
      setEnrolling(detail.data);
    } catch (err) {
      notify('error', 'Could not open face registration', errorMessage(err));
    }
  }

  async function addTenant(values: PersonFormValues) {
    const { data: created } = await api.post<Person>('/persons', {
      personName: values.personName,
      referenceId: values.referenceId,
      department: values.department,
      status: 'ACTIVE',
    });
    notify('success', 'Tenant added', `${created.personName} · room ${created.department ?? ''}`);
    setFormKey((key) => key + 1);
    reload();
    await refreshPremises();
    if (enroll) await openFace(created);
  }

  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Add tenant" description="Name, mobile number and room number. Face registration opens as soon as the tenant is saved.">
          <div className="p-5">
            {full ? (
              <p className="text-sm text-amber-200">Tenant capacity is full. Raise the licensed capacity before adding another tenant.</p>
            ) : (
              <PersonForm key={formKey} variant="tenant" submitLabel={enroll ? 'Save and register face' : 'Save tenant'} onSubmit={addTenant} />
            )}
          </div>
        </Card>
      )}

      <Card title="Tenants">
        <div className="p-4 pb-0">
          <ErrorBanner error={error} onRetry={reload} />
        </div>
        {loading && !data ? (
          <LoadingBlock />
        ) : data?.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No tenants yet" description="Add a tenant with a name, mobile number and room number, then register their face." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">Name</th>
                  <th className="table-head">Mobile number</th>
                  <th className="table-head">Room number</th>
                  <th className="table-head">Face</th>
                  {(manage || enroll) && <th className="table-head">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data?.map((person) => (
                  <tr key={person.id} className="hover:bg-ink-800/40">
                    <td className="table-cell font-medium">{person.personName}</td>
                    <td className="table-cell font-mono text-xs">{person.referenceId}</td>
                    <td className="table-cell">{person.department ?? '—'}</td>
                    <td className="table-cell">
                      <EnrollmentBadge status={person.enrollmentStatus} />
                    </td>
                    {(manage || enroll) && (
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1.5">
                          {manage && (
                            <Button size="sm" variant="secondary" onClick={() => setEditing(person)}>
                              Edit
                            </Button>
                          )}
                          {enroll && person.status === 'ACTIVE' && (
                            <Button size="sm" icon={<ScanFace className="h-3.5 w-3.5" />} onClick={() => void openFace(person)}>
                              {person.templateCount ? 'Update face' : 'Register face'}
                            </Button>
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

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.personName}` : 'Edit tenant'}>
        {editing && (
          <PersonForm
            key={editing.id}
            variant="tenant"
            initial={{ personName: editing.personName, referenceId: editing.referenceId, department: editing.department ?? '', status: editing.status }}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              await api.patch(`/persons/${editing.id}`, { personName: values.personName, referenceId: values.referenceId, department: values.department, status: editing.status });
              notify('success', 'Tenant updated', `${values.personName} saved.`);
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>

      <Modal open={!!enrolling} onClose={() => setEnrolling(null)} title={enrolling ? `Face registration — ${enrolling.personName}` : 'Face registration'} size="xl">
        {enrolling && (
          <EnrollmentPanel
            person={enrolling}
            onEnrolled={() => {
              setEnrolling(null);
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

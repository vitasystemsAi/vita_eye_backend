'use client';

import { Building2, Database, Eye, EyeOff, PlusCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CredentialsSummary, FeatureChecklist, RetentionPicker } from '@/components/platform/ClientControls';
import { Button, Card, ErrorBanner, Field, Input, LoadingBlock, Modal, PageHeader } from '@/components/ui/primitives';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { FeatureInfo, PlatformOrganization } from '@/lib/platform';
import type { FeatureKey } from '@/lib/types';

interface RegisterResult {
  organization: PlatformOrganization;
  admin: { id: string; name: string; email: string; password: string; generated: boolean };
}

const EMPTY = { name: '', contactName: '', contactEmail: '', contactPhone: '', adminName: '', adminEmail: '', adminPassword: '' };
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;

export default function RegisterOrganizationPage() {
  const router = useRouter();
  const { data: catalog, loading, error, reload } = useApi<FeatureInfo[]>('/platform/features');
  const [form, setForm] = useState(EMPTY);
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [retention, setRetention] = useState(30);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);

  useEffect(() => {
    if (catalog) setFeatures(catalog.map((f) => f.key));
  }, [catalog]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Organization name is required';
    if (form.contactEmail && !/^\S+@\S+\.\S+$/.test(form.contactEmail)) e.contactEmail = 'Enter a valid email';
    if (form.adminName.trim().length < 2) e['admin.name'] = 'Admin name is required';
    if (!/^\S+@\S+\.\S+$/.test(form.adminEmail)) e['admin.email'] = 'Enter a valid email';
    if (form.adminPassword && !PASSWORD_RE.test(form.adminPassword)) e['admin.password'] = '12+ characters with upper-case, lower-case and a digit';
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650) e.detectionRetentionDays = 'Between 1 and 3650 days';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post<RegisterResult>('/platform/organizations', {
        name: form.name,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        features,
        detectionRetentionDays: retention,
        admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword },
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !catalog) return <LoadingBlock />;
  if (!catalog) return <ErrorBanner error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="Register organization"
        icon={<PlusCircle className="h-5 w-5" />}
        description="Creates the organization, its dedicated database and its first super admin account."
      />
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-3" noValidate>
        <div className="space-y-6 xl:col-span-2">
          <Card title="Organization" description="Company details and primary contact">
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Organization name" error={errors.name}>
                  <Input value={form.name} onChange={set('name')} placeholder="Acme Security Pvt Ltd" maxLength={160} />
                </Field>
              </div>
              <Field label="Contact person" error={errors.contactName}>
                <Input value={form.contactName} onChange={set('contactName')} maxLength={120} />
              </Field>
              <Field label="Contact email" error={errors.contactEmail}>
                <Input type="email" value={form.contactEmail} onChange={set('contactEmail')} maxLength={255} />
              </Field>
              <Field label="Contact phone" error={errors.contactPhone}>
                <Input value={form.contactPhone} onChange={set('contactPhone')} maxLength={40} />
              </Field>
            </div>
          </Card>

          <Card title="Features" description="Only checked features are available to this organization. Disabled features are blocked by the API, not just hidden.">
            <div className="p-5">
              <FeatureChecklist catalog={catalog} value={features} onChange={setFeatures} />
            </div>
          </Card>

          <Card title="Detection history storage" description="How long detection events and evidence are kept before automatic deletion.">
            <div className="p-5">
              <RetentionPicker value={retention} onChange={setRetention} error={errors.detectionRetentionDays} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Admin account" description="The organization's first Super Admin. This is the login shown in the Clients tab.">
            <div className="space-y-4 p-5">
              <Field label="Full name" error={errors['admin.name']}>
                <Input value={form.adminName} onChange={set('adminName')} maxLength={120} />
              </Field>
              <Field label="Login email (ID)" error={errors['admin.email']}>
                <Input type="email" autoComplete="off" value={form.adminEmail} onChange={set('adminEmail')} maxLength={255} />
              </Field>
              <Field label="Password" error={errors['admin.password']} hint="Leave blank to generate a strong password">
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.adminPassword} onChange={set('adminPassword')} className="pr-10" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute top-2 right-2 rounded p-1 text-ink-400 hover:text-ink-100" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="space-y-4 p-5 text-sm text-ink-300">
              <p className="flex items-start gap-2">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                A new MySQL database is created for this organization and its schema is migrated. Its cameras, faces, events and users never share tables with other clients.
              </p>
              {submitError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{submitError}</p>}
              <Button type="submit" className="w-full" loading={submitting} icon={<Sparkles className="h-4 w-4" />}>
                {submitting ? 'Creating database…' : 'Register & provision'}
              </Button>
            </div>
          </Card>
        </div>
      </form>

      <Modal
        open={Boolean(result)}
        onClose={() => router.push(`/platform/clients/${result?.organization.id}`)}
        title="Organization registered"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setForm(EMPTY);
                setFeatures(catalog.map((f) => f.key));
                setRetention(30);
              }}
            >
              Register another
            </Button>
            <Link href={`/platform/clients/${result?.organization.id}`}>
              <Button icon={<Building2 className="h-4 w-4" />}>Open client</Button>
            </Link>
          </>
        }
      >
        {result && (
          <div className="space-y-3 text-sm text-ink-300">
            <p>
              <strong className="text-ink-100">{result.organization.name}</strong> is active. Share these credentials with the client securely; you can view or reset them later in the Clients tab.
            </p>
            <CredentialsSummary email={result.admin.email} password={result.admin.password} extra={[['Database', result.organization.databaseName ?? '—']]} />
          </div>
        )}
      </Modal>
    </>
  );
}

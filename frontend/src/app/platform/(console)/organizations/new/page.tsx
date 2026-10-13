'use client';

import { Building2, Database, PlusCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FeatureChecklist, RetentionPicker, SetupSummary, planByCode } from '@/components/platform/ClientControls';
import { Button, Card, ErrorBanner, Field, Input, LoadingBlock, Modal, PageHeader, Select } from '@/components/ui/primitives';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { FeatureInfo, PlanInfo, PlatformOrganization, SetupLink } from '@/lib/platform';
import type { FeatureKey } from '@/lib/types';

interface RegisterResult {
  organization: PlatformOrganization;
  admin: { id: string; name: string; email: string };
  setup: SetupLink;
}

const ZONES = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];

export default function RegisterOrganizationPage() {
  const router = useRouter();
  const featuresQuery = useApi<FeatureInfo[]>('/platform/features');
  const plansQuery = useApi<PlanInfo[]>('/platform/plans');
  const catalog = featuresQuery.data;
  const plans = plansQuery.data;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [plan, setPlan] = useState('PROFESSIONAL');
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [retention, setRetention] = useState(30);
  const [grace, setGrace] = useState(0);
  const [mode, setMode] = useState<'DRY_RUN' | 'ENFORCE'>('DRY_RUN');
  const [cameraLimit, setCameraLimit] = useState('');
  const [storageGb, setStorageGb] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);

  const selected = useMemo(() => planByCode(plans, plan), [plans, plan]);
  const allowed = selected?.features;

  useEffect(() => {
    if (allowed) setFeatures(allowed);
    if (selected) {
      setRetention(Math.min(30, selected.retentionMaxDays));
      setCameraLimit(selected.cameraLimit ? String(selected.cameraLimit) : '');
      setStorageGb(selected.storageLimitBytes ? String(Math.round(selected.storageLimitBytes / 1024 ** 3)) : '');
    }
  }, [allowed, selected]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<RegisterResult>('/platform/organizations', {
        name,
        code,
        contactName,
        contactEmail,
        contactPhone,
        timezone,
        subscriptionPlan: plan,
        features,
        detectionRetentionDays: retention,
        retentionGraceDays: grace,
        retentionMode: mode,
        cameraLimit: cameraLimit ? Number(cameraLimit) : null,
        storageLimitBytes: storageGb ? Math.round(Number(storageGb) * 1024 ** 3) : null,
        admin: { name: adminName, email: adminEmail },
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if ((featuresQuery.loading && !catalog) || (plansQuery.loading && !plans)) return <LoadingBlock />;
  if (!catalog || !plans) return <ErrorBanner error={featuresQuery.error ?? plansQuery.error} onRetry={() => { void featuresQuery.reload(); void plansQuery.reload(); }} />;

  return (
    <>
      <PageHeader title="Register organization" icon={<PlusCircle className="h-5 w-5" />} description="Creates the organization record, provisions its database, and emails a one-time administrator setup link." />
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 xl:grid-cols-3" noValidate>
        <div className="space-y-6 xl:col-span-2">
          <Card title="Organization">
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <Field label="Organization name" error={errors.name}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></Field>
              <Field label="Organization code" error={errors.code} hint="Unique, used in reports. Example: acme"><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={32} /></Field>
              <Field label="Organization email" error={errors.contactEmail}><Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></Field>
              <Field label="Contact number" error={errors.contactPhone}><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></Field>
              <Field label="Contact name" error={errors.contactName}><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
              <Field label="Time zone" error={errors.timezone}>
                <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </Select>
              </Field>
            </div>
          </Card>
          <Card title="Subscription">
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <Field label="Plan" error={errors.subscriptionPlan}>
                <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {plans.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </Select>
              </Field>
              <Field label="Camera limit" hint="Leave blank to use the plan limit"><Input type="number" min={1} value={cameraLimit} onChange={(e) => setCameraLimit(e.target.value)} /></Field>
              <Field label="Storage limit (GB)" hint="Evidence files. Leave blank for the plan limit"><Input type="number" min={1} value={storageGb} onChange={(e) => setStorageGb(e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Features" description="Disabled features are blocked by the API. Features this deployment does not support stay off.">
            <div className="p-5">
              <FeatureChecklist catalog={catalog} value={features} onChange={setFeatures} allowed={allowed} />
            </div>
          </Card>
          <Card title="Data retention" description="The current local day stays available. Eligible records are removed by the hourly cleanup, unless a legal hold pauses it.">
            <div className="space-y-4 p-5">
              <RetentionPicker value={retention} onChange={setRetention} max={selected?.retentionMaxDays} error={errors.detectionRetentionDays} />
              <Field label="Grace period (days)" hint="Extra days after the retention window before permanent deletion">
                <Input type="number" min={0} max={365} value={grace} onChange={(e) => setGrace(Number(e.target.value))} className="max-w-[10rem]" />
              </Field>
              <Field label="Cleanup mode">
                <Select value={mode} onChange={(e) => setMode(e.target.value as 'DRY_RUN' | 'ENFORCE')}>
                  <option value="DRY_RUN">Dry run — report what would be deleted</option>
                  <option value="ENFORCE">Enforce — permanently delete eligible records</option>
                </Select>
              </Field>
              <p className="text-xs text-ink-400">Backups expire on their own schedule. This cleanup does not promise that backup copies disappear immediately.</p>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Administrator" description="The first Super Admin. They set their own password from a one-time link.">
            <div className="space-y-4 p-5">
              <Field label="Administrator name" error={errors['admin.name']}><Input value={adminName} onChange={(e) => setAdminName(e.target.value)} /></Field>
              <Field label="Administrator email" error={errors['admin.email']}><Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></Field>
            </div>
          </Card>
          <Card>
            <div className="space-y-4 p-5 text-sm text-ink-300">
              <p className="flex items-start gap-2"><Database className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />A dedicated MySQL database is created and migrated. The organization stays inactive until that succeeds. A failure can be retried without creating a second organization.</p>
              {submitError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{submitError}</p>}
              <Button type="submit" className="w-full" loading={submitting} icon={<Sparkles className="h-4 w-4" />}>{submitting ? 'Creating database…' : 'Register and provision'}</Button>
            </div>
          </Card>
        </div>
      </form>
      <Modal
        open={Boolean(result)}
        onClose={() => router.push(`/platform/clients/${result?.organization.id}`)}
        title="Organization registered"
        footer={
          <Link href={`/platform/clients/${result?.organization.id}`}><Button icon={<Building2 className="h-4 w-4" />}>Open client</Button></Link>
        }
      >
        {result && <SetupSummary setup={result.setup} />}
      </Modal>
    </>
  );
}

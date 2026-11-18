'use client';

import { Check, Copy, KeyRound, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Badge, Button, Field, Input, Modal, PasswordInput, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { copyText, type FeatureInfo, type PlanInfo, type PlatformOrganization, type SetupLink } from '@/lib/platform';
import type { FeatureKey, OrganizationStatus } from '@/lib/types';

const STATUS_LABEL: Record<OrganizationStatus, ['green' | 'amber' | 'red' | 'blue' | 'neutral', string]> = {
  ACTIVE: ['green', 'Active'],
  SUSPENDED: ['amber', 'Suspended'],
  ON_HOLD: ['amber', 'On hold'],
  PROVISIONING: ['blue', 'Provisioning'],
  PENDING: ['blue', 'Pending'],
  FAILED: ['red', 'Failed'],
  DEACTIVATED: ['red', 'Deactivated'],
  ARCHIVED: ['neutral', 'Archived'],
};

export function OrgStatusBadge({ status }: { status: OrganizationStatus }) {
  const [tone, label] = STATUS_LABEL[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
      title={label}
      aria-label={label}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function SetupSummary({ setup }: { setup: SetupLink }) {
  return (
    <div className="space-y-3 text-sm text-ink-300">
      <p>
        {setup.emailed
          ? `A one-time setup link was emailed to ${setup.email}. It expires ${new Date(setup.expiresAt).toLocaleString()}.`
          : `Email is not configured, so share this one-time link with ${setup.email} through an approved channel. It expires ${new Date(setup.expiresAt).toLocaleString()} and will not be shown again.`}
      </p>
      {setup.setupLink && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
          <code className="min-w-0 flex-1 break-all text-xs text-ink-100">{setup.setupLink}</code>
          <CopyButton value={setup.setupLink} label="Copy setup link" />
        </div>
      )}
      <p className="text-xs text-ink-400">The existing password is not stored and cannot be viewed. The administrator sets a new one from the link.</p>
    </div>
  );
}

export function ResetPasswordDialog({ org, email, open, onClose }: { org: { id: string; name: string }; email: string | null; open: boolean; onClose: () => void }) {
  const notify = useToast();
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupLink | null>(null);

  function close() {
    setResult(null);
    setConfirmPassword('');
    setError(null);
    onClose();
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<SetupLink>(`/platform/organizations/${org.id}/credentials/reset`, { confirmPassword });
      setResult(data);
      notify('success', 'Reset link issued', data.emailed ? `Emailed to ${data.email}` : 'Share the one-time link securely');
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors())[0] ?? err.message) : errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Reset admin password — ${org.name}`}
      size="sm"
      footer={result ? <Button onClick={close}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={close} disabled={loading}>Cancel</Button>
          <Button variant="warning" icon={<KeyRound className="h-4 w-4" />} loading={loading} disabled={!confirmPassword} onClick={() => void submit()}>
            Send reset link
          </Button>
        </>
      )}
    >
      {result ? (
        <SetupSummary setup={result} />
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-ink-300">
            Sends a single-use link to <strong className="text-ink-100">{email ?? 'the primary admin'}</strong>. The current password is not revealed. Existing sessions end when the new password is set.
          </p>
          <Field label="Your platform password" hint="Required to confirm this reset">
            <PasswordInput autoComplete="current-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

const ACTIONS = [
  ['SUSPEND', 'Suspend account'],
  ['HOLD', 'Place on hold'],
  ['REACTIVATE', 'Reactivate'],
  ['ACTIVATE', 'Activate'],
  ['DEACTIVATE', 'Deactivate'],
  ['ARCHIVE', 'Archive'],
] as const;

export function AccountDialog({ org, open, onClose, onDone }: { org: Pick<PlatformOrganization, 'id' | 'name' | 'status'>; open: boolean; onClose: () => void; onDone?: (o: PlatformOrganization) => void }) {
  const notify = useToast();
  const [action, setAction] = useState<(typeof ACTIONS)[number][0]>(org.status === 'ACTIVE' ? 'SUSPEND' : 'REACTIVATE');
  const [holdType, setHoldType] = useState<'ACCOUNT' | 'LEGAL' | 'INVESTIGATION'>('ACCOUNT');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const blocking = action !== 'ACTIVATE' && action !== 'REACTIVATE';

  async function submit() {
    setLoading(true);
    try {
      const { data } = await api.post<PlatformOrganization>(`/platform/organizations/${org.id}/account`, {
        action,
        reason: blocking ? reason : null,
        holdType: action === 'HOLD' ? holdType : null,
      });
      notify('success', 'Account updated', `${org.name} is now ${data.status.toLowerCase().replace('_', ' ')}`);
      setReason('');
      onDone?.(data);
      onClose();
    } catch (err) {
      notify('error', 'Action failed', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Account controls — ${org.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={blocking ? 'danger' : 'primary'} icon={blocking ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} loading={loading} disabled={blocking && !reason.trim()} onClick={() => void submit()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink-300">
        <p>Suspending or holding an account blocks sign-in and stops camera streams. It does not delete detection history. A legal or investigation hold also pauses automatic deletion.</p>
        <Field label="Action">
          <Select value={action} onChange={(e) => setAction(e.target.value as (typeof ACTIONS)[number][0])}>
            {ACTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        {action === 'HOLD' && (
          <Field label="Hold policy">
            <Select value={holdType} onChange={(e) => setHoldType(e.target.value as typeof holdType)}>
              <option value="ACCOUNT">Account hold — cleanup continues</option>
              <option value="LEGAL">Legal hold — pause deletion</option>
              <option value="INVESTIGATION">Investigation hold — pause deletion</option>
            </Select>
          </Field>
        )}
        {blocking && (
          <Field label="Reason">
            <Textarea value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="Shown in the audit trail" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function FeatureChecklist({
  catalog,
  value,
  onChange,
  allowed,
  disabled,
}: {
  catalog: FeatureInfo[];
  value: FeatureKey[];
  onChange: (v: FeatureKey[]) => void;
  allowed?: FeatureKey[];
  disabled?: boolean;
}) {
  const selected = new Set(value);
  const selectable = catalog.filter((feature) => feature.supported && (!allowed || allowed.includes(feature.key)));
  const categories = [...new Set(catalog.map((feature) => feature.category))];
  const toggle = (key: FeatureKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(catalog.map((feature) => feature.key).filter((key) => next.has(key)));
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-400">
        <span>{selected.size} enabled</span>
        {!disabled && (
          <span className="flex gap-3">
            <button type="button" className="text-brand-400 hover:text-brand-300" onClick={() => onChange(selectable.map((feature) => feature.key))}>
              Select all
            </button>
            <button type="button" className="text-brand-400 hover:text-brand-300" onClick={() => onChange([])}>
              Deselect all
            </button>
          </span>
        )}
      </div>
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-400 uppercase">{category}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {catalog
              .filter((feature) => feature.category === category)
              .map((feature) => {
                const locked = !feature.supported || (allowed ? !allowed.includes(feature.key) : false);
                const on = selected.has(feature.key);
                return (
                  <label
                    key={feature.key}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border px-3 py-2.5',
                      locked ? 'cursor-not-allowed border-ink-800 bg-ink-900/40 opacity-70' : 'cursor-pointer',
                      !locked && on ? 'border-brand-500/40 bg-brand-500/5' : !locked && 'border-ink-700 hover:border-ink-600',
                    )}
                  >
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={on && !locked} disabled={disabled || locked} onChange={() => toggle(feature.key)} />
                    <span>
                      <span className="block text-sm font-medium text-ink-100">
                        {feature.label}
                        {locked && <span className="ml-2 text-[10px] font-normal tracking-wide text-ink-400 uppercase">{feature.supported ? 'Not in plan' : 'Not in this deployment'}</span>}
                      </span>
                      <span className="block text-xs text-ink-400">{feature.description}</span>
                      {feature.legalNote && <span className="mt-1 block text-xs text-amber-200/90">{feature.legalNote}</span>}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

const RETENTION_PRESETS = [1, 3, 7, 15, 30, 60, 90];

export function RetentionPicker({ value, onChange, error, max }: { value: number; onChange: (v: number) => void; error?: string; max?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RETENTION_PRESETS.filter((days) => !max || days <= max).map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange(days)}
            className={cn('rounded-lg border px-3 py-1.5 text-sm transition', value === days ? 'border-brand-500 bg-brand-500/15 text-brand-200' : 'border-ink-700 text-ink-300 hover:border-ink-600')}
          >
            {days} days
          </button>
        ))}
      </div>
      <Field label="Custom (days)" error={error} hint={`Records older than the ${value || '…'}-day cutoff, after any grace period, are eligible at the next hourly cleanup.`}>
        <Input type="number" min={1} max={max ?? 3650} value={value || ''} onChange={(e) => onChange(Number(e.target.value))} className="max-w-[10rem]" />
      </Field>
    </div>
  );
}

export function planByCode(plans: PlanInfo[] | null | undefined, code: string) {
  return plans?.find((plan) => plan.code === code) ?? null;
}

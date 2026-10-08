'use client';

import { Check, Copy, Eye, EyeOff, KeyRound, Pause, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Badge, Button, Field, Input, Modal, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, errorMessage } from '@/lib/api';
import { copyText, type Credentials, type FeatureInfo, type PlatformOrganization } from '@/lib/platform';
import type { FeatureKey, OrganizationStatus } from '@/lib/types';

export function OrgStatusBadge({ status }: { status: OrganizationStatus }) {
  const map: Record<OrganizationStatus, ['green' | 'amber' | 'red' | 'blue', string]> = {
    ACTIVE: ['green', 'Active'],
    SUSPENDED: ['amber', 'On hold'],
    PROVISIONING: ['blue', 'Provisioning'],
    FAILED: ['red', 'Failed'],
  };
  const [tone, label] = map[status];
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

/** Masked admin password with an audited "view" toggle backed by the encrypted credential vault. */
export function PasswordReveal({ organizationId, available, className }: { organizationId: string; available: boolean; className?: string }) {
  const notify = useToast();
  const [password, setPassword] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (visible) return setVisible(false);
    if (password) return setVisible(true);
    setLoading(true);
    try {
      const { data } = await api.post<Credentials>(`/platform/organizations/${organizationId}/credentials/reveal`);
      setPassword(data.password);
      setVisible(true);
    } catch (err) {
      notify('error', 'Password not available', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!available) return <span className={cn('text-xs text-ink-400', className)}>Not stored — reset to set one</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <code className="rounded bg-ink-800 px-2 py-0.5 font-mono text-xs text-ink-100">{visible && password ? password : '••••••••••••'}</code>
      <button type="button" onClick={() => void toggle()} disabled={loading} className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100" title={visible ? 'Hide password' : 'View password'} aria-label={visible ? 'Hide password' : 'View password'}>
        {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      {visible && password && <CopyButton value={password} label="Copy password" />}
    </span>
  );
}

export function CredentialsSummary({ email, password, extra }: { email: string; password: string; extra?: Array<[string, string]> }) {
  return (
    <dl className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm">
      {[['Login ID', email], ['Password', password], ...(extra ?? [])].map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <dt className="text-xs tracking-wide text-ink-400 uppercase">{k}</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <code className="truncate font-mono text-ink-100">{v}</code>
            <CopyButton value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ResetPasswordDialog({ org, email, open, onClose, onDone }: { org: { id: string; name: string }; email: string | null; open: boolean; onClose: () => void; onDone?: () => void }) {
  const notify = useToast();
  const [mode, setMode] = useState<'generate' | 'custom'>('generate');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Credentials | null>(null);

  function close() {
    setResult(null);
    setCustom('');
    setError(null);
    setMode('generate');
    onClose();
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<Credentials>(`/platform/organizations/${org.id}/credentials/reset`, mode === 'custom' ? { password: custom } : {});
      setResult(data);
      notify('success', 'Password reset', `${data.email} was signed out of every session.`);
      onDone?.();
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
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={loading}>
              Cancel
            </Button>
            <Button variant="warning" icon={<KeyRound className="h-4 w-4" />} loading={loading} disabled={mode === 'custom' && !custom} onClick={() => void submit()}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-300">Share the new credentials with the client securely. The account was unlocked and all its sessions were revoked.</p>
          <CredentialsSummary email={result.email} password={result.password} />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-ink-300">
            Resets the password of <strong className="text-ink-100">{email ?? 'the primary admin'}</strong>, unlocks the account and signs it out everywhere.
          </p>
          <div className="space-y-2">
            {(['generate', 'custom'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-ink-200">
                <input type="radio" name="reset-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-brand-500" />
                {m === 'generate' ? 'Generate a strong password' : 'Set a specific password'}
              </label>
            ))}
          </div>
          {mode === 'custom' && (
            <Field label="New password" hint="12+ characters with upper-case, lower-case and a digit">
              <Input type="text" autoComplete="new-password" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </Field>
          )}
          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

export function HoldDialog({ org, open, onClose, onDone }: { org: Pick<PlatformOrganization, 'id' | 'name' | 'status'>; open: boolean; onClose: () => void; onDone?: (o: PlatformOrganization) => void }) {
  const notify = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const holding = org.status !== 'SUSPENDED';

  async function submit() {
    setLoading(true);
    try {
      const { data } = await api.post<PlatformOrganization>(`/platform/organizations/${org.id}/hold`, { onHold: holding, reason: holding ? reason : null });
      notify('success', holding ? 'Organization put on hold' : 'Organization reactivated', org.name);
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
      title={holding ? `Put ${org.name} on hold` : `Reactivate ${org.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={holding ? 'danger' : 'primary'} icon={holding ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} loading={loading} onClick={() => void submit()}>
            {holding ? 'Put on hold' : 'Reactivate'}
          </Button>
        </>
      }
    >
      {holding ? (
        <div className="space-y-3 text-sm text-ink-300">
          <p>While on hold, the organization&apos;s users cannot sign in, active sessions are ended and network camera streams stop. All data is kept and retention keeps running. You can still open the console with &quot;View&quot;.</p>
          <Field label="Reason (shown in the audit trail)">
            <Textarea value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Subscription payment overdue" />
          </Field>
        </div>
      ) : (
        <p className="text-sm text-ink-300">Users can sign in again and monitored network cameras restart automatically within a minute.</p>
      )}
    </Modal>
  );
}

export function FeatureChecklist({ catalog, value, onChange, disabled }: { catalog: FeatureInfo[]; value: FeatureKey[]; onChange: (v: FeatureKey[]) => void; disabled?: boolean }) {
  const selected = new Set(value);
  const toggle = (key: FeatureKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(catalog.map((f) => f.key).filter((k) => next.has(k)));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-400">
        <span>
          {selected.size} of {catalog.length} features enabled
        </span>
        {!disabled && (
          <span className="flex gap-3">
            <button type="button" className="text-brand-400 hover:text-brand-300" onClick={() => onChange(catalog.map((f) => f.key))}>
              Select all
            </button>
            <button type="button" className="text-brand-400 hover:text-brand-300" onClick={() => onChange([])}>
              Clear
            </button>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {catalog.map((f) => (
          <label
            key={f.key}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition',
              selected.has(f.key) ? 'border-brand-500/40 bg-brand-500/5' : 'border-ink-700 hover:border-ink-600',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={selected.has(f.key)} disabled={disabled} onChange={() => toggle(f.key)} />
            <span>
              <span className="block text-sm font-medium text-ink-100">{f.label}</span>
              <span className="block text-xs text-ink-400">{f.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const RETENTION_PRESETS = [7, 15, 30, 60, 90, 180, 365];

export function RetentionPicker({ value, onChange, error }: { value: number; onChange: (v: number) => void; error?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RETENTION_PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            className={cn('rounded-lg border px-3 py-1.5 text-sm transition', value === d ? 'border-brand-500 bg-brand-500/15 text-brand-200' : 'border-ink-700 text-ink-300 hover:border-ink-600')}
          >
            {d} days
          </button>
        ))}
      </div>
      <Field label="Custom (days)" error={error} hint={`Detections and evidence older than ${value || '…'} days are deleted automatically every hour.`}>
        <Input type="number" min={1} max={3650} value={value || ''} onChange={(e) => onChange(Number(e.target.value))} className="max-w-[10rem]" />
      </Field>
    </div>
  );
}

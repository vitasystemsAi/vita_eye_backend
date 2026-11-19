'use client';

import { Activity, Cpu, Database, RotateCcw, Save, Server, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, ErrorBanner, Field, Input, LoadingBlock, PageHeader, Switch, Tabs } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { AppSettings, RecognitionSettings } from '@/lib/types';

interface SettingsResponse {
  settings: AppSettings;
  defaults: AppSettings;
  model: { status: string; version?: string; models?: Record<string, unknown>; error?: string } | null;
}

interface HealthCheck<T = unknown> {
  ok: boolean;
  latencyMs: number;
  detail?: T;
  error?: string;
}
interface HealthDetails {
  startedAt: string;
  uptimeSec: number;
  nodeVersion: string;
  environment: string;
  database: HealthCheck<{ version: string }>;
  redis: HealthCheck;
  aiService: HealthCheck<{ status: string; modelVersion?: string; streams?: number; [k: string]: unknown }>;
  queues: HealthCheck<Record<string, Record<string, number>>>;
  notifications: { email: boolean; push: boolean };
}

type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

const RECOGNITION_FIELDS: Array<{ key: NumKey<RecognitionSettings>; label: string; step: number; min: number; max: number; hint: string }> = [
  { key: 'knownThreshold', label: 'Known match threshold', step: 0.01, min: 0, max: 1, hint: 'Cosine similarity required to label a face as a registered person' },
  { key: 'unknownThreshold', label: 'Unknown threshold', step: 0.01, min: 0, max: 1, hint: 'Below this the face is unrecognized; between the two it is uncertain' },
  { key: 'matchMargin', label: 'Match margin', step: 0.01, min: 0, max: 0.5, hint: 'Lead the best person must have over the next one. This widens on its own as more people are enrolled, so a lookalike is left as Uncertain instead of labelled with the wrong name.' },
  { key: 'minFaceSize', label: 'Minimum face size (px)', step: 1, min: 20, max: 1000, hint: 'Enrollment stays strict. A live camera still tries to match a face down to half this size.' },
  { key: 'minQuality', label: 'Minimum quality score', step: 0.05, min: 0, max: 1, hint: 'Used when judging a frame. Dim or distant faces are still compared with the gallery.' },
  { key: 'minDetectionScore', label: 'Minimum detector confidence', step: 0.01, min: 0.3, max: 1, hint: 'YuNet score. Live matching caps this so a distant face is not discarded.' },
  { key: 'temporalMinFrames', label: 'Frames required to confirm', step: 1, min: 1, max: 30, hint: 'Agreeing frames before a face is counted. One frame confirms a clear look, so someone walking through a door is recorded immediately. A person who leaves sooner is still recorded from the frames already seen.' },
  { key: 'temporalWindowSec', label: 'Verification window (s)', step: 1, min: 1, max: 120, hint: 'Observations older than this are ignored' },
  { key: 'temporalAgreement', label: 'Required agreement', step: 0.05, min: 0.5, max: 1, hint: 'Share of frames that must agree on the label' },
];

const RETENTION_FIELDS: Array<{ key: keyof AppSettings['retention']; label: string; min: number; hint: string }> = [
  { key: 'evidenceDays', label: 'Evidence images (days)', min: 1, hint: 'Encrypted evidence files are deleted after this period' },
  { key: 'eventDays', label: 'Detection events (days)', min: 1, hint: 'Event records and notes' },
  { key: 'notificationDays', label: 'Notifications (days)', min: 1, hint: 'Delivery history' },
  { key: 'auditDays', label: 'Audit logs (days)', min: 30, hint: 'Minimum 30 days' },
  { key: 'deletedPersonPurgeDays', label: 'Deleted-person record purge (days)', min: 0, hint: 'Templates are erased immediately; the soft-deleted record is purged after this' },
];

function Health() {
  const { data, error, loading, reload } = useApi<HealthDetails>('/health/details');
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <div className="p-5"><ErrorBanner error={error} onRetry={reload} /></div>;
  const rows: Array<[string, React.ReactNode, HealthCheck | null, string]> = [
    ['MySQL', <Database key="d" className="h-4 w-4" />, data.database, data.database.detail?.version ?? ''],
    ['Redis', <Server key="r" className="h-4 w-4" />, data.redis, ''],
    ['AI service', <Cpu key="a" className="h-4 w-4" />, data.aiService, data.aiService.detail?.modelVersion ? `model ${data.aiService.detail.modelVersion}` : ''],
    ['Job queues', <Activity key="q" className="h-4 w-4" />, data.queues, data.queues.detail ? Object.entries(data.queues.detail).map(([q, c]) => `${q}: ${c.waiting ?? 0} waiting, ${c.failed ?? 0} failed`).join(' · ') : ''],
  ];
  return (
    <div className="p-5">
      <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700">
        {rows.map(([name, icon, check, detail]) => (
          <li key={name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              {icon} {name}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
              {detail && <span>{detail}</span>}
              {check?.error && <span className="text-red-300">{check.error}</span>}
              <span className="tabular-nums">{check?.latencyMs} ms</span>
              <Badge tone={check?.ok ? 'green' : 'red'} dot>
                {check?.ok ? 'Healthy' : 'Unavailable'}
              </Badge>
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between px-4 py-3 text-sm">
          <span className="font-medium">Notification providers</span>
          <span className="flex gap-2">
            <Badge tone={data.notifications.email ? 'green' : 'neutral'}>Email {data.notifications.email ? 'configured' : 'not configured'}</Badge>
            <Badge tone={data.notifications.push ? 'green' : 'neutral'}>Push {data.notifications.push ? 'configured' : 'not configured'}</Badge>
          </span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-400">
        Backend {data.environment} · Node {data.nodeVersion} · up {Math.round(data.uptimeSec / 60)} min
      </p>
    </div>
  );
}

const CAPPED_RETENTION = new Set<keyof AppSettings['retention']>(['eventDays', 'evidenceDays']);

function SettingsView() {
  const { can, user, hasFeature } = useAuth();
  const notify = useToast();
  const editable = can('settings:manage');
  const historyCap = user?.organization?.detectionRetentionDays ?? null;
  const { data, loading, error, reload, setData } = useApi<SettingsResponse>('/settings');
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<'recognition' | 'events' | 'retention' | 'health'>('recognition');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) setDraft(structuredClone(data.settings));
  }, [data]);

  if (loading && !data) return <LoadingBlock />;
  if (!data || !draft) return <ErrorBanner error={error} onRetry={reload} />;
  const d = draft;

  async function save(section: 'recognition' | 'events' | 'retention') {
    setSaving(true);
    setFieldErrors({});
    try {
      const { data: r } = await api.patch<{ settings: AppSettings }>('/settings', { [section]: d[section] });
      setData((prev) => (prev ? { ...prev, settings: r.settings } : prev));
      notify('success', 'Settings saved', section === 'recognition' ? 'Running cameras received the new policy.' : undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
        notify('error', 'Settings not saved', err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const setRec = (k: keyof RecognitionSettings, v: number) => setDraft({ ...d, recognition: { ...d.recognition, [k]: v } });
  const withinPlan = <K extends keyof AppSettings>(section: K, value: AppSettings[K]): AppSettings[K] => {
    if (section !== 'retention' || !historyCap) return value;
    const r = value as AppSettings['retention'];
    return { ...r, eventDays: Math.min(r.eventDays, historyCap), evidenceDays: Math.min(r.evidenceDays, historyCap) } as AppSettings[K];
  };
  const dirty = (section: keyof AppSettings) => JSON.stringify(d[section]) !== JSON.stringify(data.settings[section]);

  const actions = (section: 'recognition' | 'events' | 'retention') =>
    editable && (
      <div className="flex flex-wrap justify-end gap-2 border-t border-ink-700/70 px-5 py-4">
        <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDraft({ ...d, [section]: withinPlan(section, structuredClone(data.defaults[section])) })}>
          Restore defaults
        </Button>
        <Button variant="secondary" disabled={!dirty(section)} onClick={() => setDraft({ ...d, [section]: structuredClone(data.settings[section]) })}>
          Discard
        </Button>
        <Button icon={<Save className="h-4 w-4" />} loading={saving} disabled={!dirty(section)} onClick={() => void save(section)}>
          Save
        </Button>
      </div>
    );

  return (
    <>
      <PageHeader
        title="Settings"
        icon={<SettingsIcon className="h-5 w-5" />}
        description="Recognition policy, event handling, data retention and system health."
        actions={
          data.model && (
            <Badge tone={data.model.status === 'ok' ? 'green' : 'red'} dot>
              {data.model.version ? `Model ${data.model.version}` : `AI service ${data.model.status}`}
            </Badge>
          )
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'recognition', label: 'Recognition' },
              { value: 'events', label: 'Events & evidence' },
              { value: 'retention', label: 'Data retention' },
              { value: 'health', label: 'System health' },
            ]}
          />
        </div>
        {tab === 'recognition' && (
          <>
            <div className="space-y-4 p-5">
              <p className="rounded-lg border border-brand-500/25 bg-brand-500/5 px-4 py-3 text-sm text-ink-200">
                Thresholds must be calibrated for your cameras and population before production use (see docs/AI_CALIBRATION.md). Raising the known threshold reduces false matches but increases unrecognized results.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {RECOGNITION_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.hint} error={fieldErrors[`recognition.${f.key}`]}>
                    <Input type="number" step={f.step} min={f.min} max={f.max} value={d.recognition[f.key]} disabled={!editable} onChange={(e) => setRec(f.key, Number(e.target.value))} />
                  </Field>
                ))}
              </div>
            </div>
            {actions('recognition')}
          </>
        )}
        {tab === 'events' && (
          <>
            <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2">
              <div>
                <Switch label="Capture evidence images" description="Store an encrypted face close-up and full photo for unrecognized and uncertain events. Registered persons are not photographed." checked={d.events.captureEvidence} disabled={!editable || !hasFeature('evidenceCapture')} onChange={(v) => setDraft({ ...d, events: { ...d.events, captureEvidence: v } })} />
                <Switch label="Record registered-person events" description="Keep a history of recognized people (auto-resolved)" checked={d.events.recordKnownEvents} disabled={!editable} onChange={(v) => setDraft({ ...d, events: { ...d.events, recordKnownEvents: v } })} />
              </div>
              <div className="space-y-4">
                <Field label="Registered-person cooldown (s)" hint="Minimum gap between events for the same person on the same camera" error={fieldErrors['events.knownCooldownSec']}>
                  <Input type="number" min={0} max={86400} value={d.events.knownCooldownSec} disabled={!editable} onChange={(e) => setDraft({ ...d, events: { ...d.events, knownCooldownSec: Number(e.target.value) } })} />
                </Field>
                <Field label="Unrecognized dedup window (s)" hint="The same unknown face within this window counts as one event" error={fieldErrors['events.unknownCooldownSec']}>
                  <Input type="number" min={0} max={86400} value={d.events.unknownCooldownSec} disabled={!editable} onChange={(e) => setDraft({ ...d, events: { ...d.events, unknownCooldownSec: Number(e.target.value) } })} />
                </Field>
              </div>
            </div>
            {actions('events')}
          </>
        )}
        {tab === 'retention' && (
          <>
            <div className="space-y-4 p-5">
              <p className="text-sm text-ink-300">An hourly job deletes data older than these periods. Biometric templates of deleted persons are erased immediately and the erasure is verified.</p>
              {historyCap && (
                <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
                  Your plan keeps detection history and evidence for at most {historyCap} days. Older detections are deleted automatically.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {RETENTION_FIELDS.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.hint} error={fieldErrors[`retention.${f.key}`]}>
                    <Input type="number" min={f.min} max={historyCap && CAPPED_RETENTION.has(f.key) ? historyCap : 3650} value={d.retention[f.key]} disabled={!editable} onChange={(e) => setDraft({ ...d, retention: { ...d.retention, [f.key]: Number(e.target.value) } })} />
                  </Field>
                ))}
              </div>
            </div>
            {actions('retention')}
          </>
        )}
        {tab === 'health' && <Health />}
      </Card>
    </>
  );
}

export default function SettingsPage() {
  return (
    <RequirePermission permission="settings:view">
      <SettingsView />
    </RequirePermission>
  );
}

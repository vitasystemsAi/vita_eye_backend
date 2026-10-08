import { AppSetting } from '../models';
import { DEFAULT_SETTINGS, settingsSchema, type AppSettings } from '../config/defaultSettings';
import { AppError } from '../utils/errors';
import { audit } from './audit.service';
import { resolveTenant, type TenantInfo } from './tenancy.service';

const cache = new Map<string, { value: AppSettings; at: number }>();
const TTL_MS = 15_000;
const listeners: Array<(orgId: string, s: AppSettings) => void> = [];

/** Deep-merge stored settings over defaults so newly introduced keys always have a value. */
function merge<T>(base: T, override: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return (override ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (override && typeof override === 'object') {
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = k in out ? merge(out[k], v) : v;
    }
  }
  return out as T;
}

/**
 * Platform policy always wins over organization settings: disabled features switch their behaviour
 * off and detection history can never be kept longer than the platform retention limit.
 */
function applyPlatformPolicy(settings: AppSettings, tenant: TenantInfo | null): AppSettings {
  if (!tenant) return settings;
  const s = structuredClone(settings);
  const f = tenant.features;
  if (!f.has('evidenceCapture')) s.events.captureEvidence = false;
  if (!f.has('unknownAlerts')) {
    s.notifications.unknownAlerts = false;
    s.notifications.uncertainAlerts = false;
  }
  if (!f.has('notifications')) s.notifications.channels.inApp = false;
  if (!f.has('emailAlerts')) s.notifications.channels.email = false;
  if (!f.has('pushAlerts')) s.notifications.channels.push = false;
  const cap = tenant.detectionRetentionDays;
  if (cap) {
    s.retention.eventDays = Math.min(s.retention.eventDays, cap);
    s.retention.evidenceDays = Math.min(s.retention.evidenceDays, cap);
  }
  return s;
}

export function onSettingsChanged(fn: (orgId: string, s: AppSettings) => void) {
  listeners.push(fn);
}

export function invalidateSettings(organizationId: string) {
  cache.delete(organizationId);
}

/** Recomputes effective settings after a platform policy change and notifies listeners (streams). Call inside the tenant context. */
export async function reloadSettings(organizationId: string) {
  cache.delete(organizationId);
  const effective = await getSettings(organizationId);
  for (const fn of listeners) fn(organizationId, effective);
  return effective;
}

export async function getSettings(organizationId: string): Promise<AppSettings> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await AppSetting.findByPk(organizationId);
  const value = applyPlatformPolicy(merge(DEFAULT_SETTINGS, row?.settings ?? {}), await resolveTenant(organizationId));
  cache.set(organizationId, { value, at: Date.now() });
  return value;
}

export async function updateSettings(
  organizationId: string,
  patch: unknown,
  actor: { userId: string; ip: string | null },
  action = 'SETTINGS_UPDATED',
): Promise<AppSettings> {
  const current = await getSettings(organizationId);
  const next = settingsSchema.safeParse(merge(current, patch));
  if (!next.success) {
    throw AppError.validation(next.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const tenant = await resolveTenant(organizationId);
  const cap = tenant?.detectionRetentionDays;
  if (cap) {
    const over = (['eventDays', 'evidenceDays'] as const).filter((k) => next.data.retention[k] > cap);
    if (over.length) {
      throw AppError.validation(over.map((k) => ({ path: `retention.${k}`, message: `Your plan keeps detection history for at most ${cap} days` })));
    }
  }
  await AppSetting.upsert({ organizationId, settings: next.data, updatedBy: actor.userId });
  const effective = applyPlatformPolicy(next.data, tenant);
  cache.set(organizationId, { value: effective, at: Date.now() });
  await audit({
    organizationId,
    userId: actor.userId,
    action,
    entityType: 'settings',
    entityId: organizationId,
    ipAddress: actor.ip,
    metadata: { changed: patch as Record<string, unknown> },
  });
  for (const fn of listeners) fn(organizationId, effective);
  return effective;
}

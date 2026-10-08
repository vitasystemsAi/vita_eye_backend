import { Op, type Transaction } from 'sequelize';
import { logger } from '../config/logger';
import { enabledFeatures, type FeatureKey } from '../config/features';
import { Organization, TenantUserDirectory, User } from '../models';
import type { OrganizationStatus } from '../models/Organization';
import { currentTenant, runInPrimaryDatabase, runWithTenant } from '../db/tenantContext';

export interface TenantInfo {
  organizationId: string;
  name: string;
  database: string | null;
  status: OrganizationStatus;
  features: Set<FeatureKey>;
  detectionRetentionDays: number | null;
}

const cache = new Map<string, { value: TenantInfo | null; at: number }>();
const TTL_MS = 30_000;

function toInfo(org: Organization): TenantInfo {
  return {
    organizationId: org.id,
    name: org.name,
    database: org.databaseName ?? null,
    status: org.status,
    features: enabledFeatures(org.features),
    detectionRetentionDays: org.detectionRetentionDays ?? null,
  };
}

/** Control-plane lookup of where an organization's data lives (cached briefly). */
export async function resolveTenant(organizationId: string): Promise<TenantInfo | null> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const org = await Organization.findByPk(organizationId);
  const value = org ? toInfo(org) : null;
  cache.set(organizationId, { value, at: Date.now() });
  return value;
}

export function invalidateTenant(organizationId: string) {
  cache.delete(organizationId);
}

/**
 * Runs `fn` with tenant-scoped models bound to the organization's database. `null` (or an unknown
 * organization) runs against the primary database.
 */
export async function runInTenant<T>(organizationId: string | null, fn: () => Promise<T>, opts: { impersonatedBy?: string | null } = {}): Promise<T> {
  const tenant = organizationId ? await resolveTenant(organizationId) : null;
  return runWithTenant(
    { organizationId, database: tenant?.database ?? null, impersonatedBy: opts.impersonatedBy ?? currentTenant()?.impersonatedBy ?? null },
    fn,
  );
}

/** Executes `fn` once per organization inside its tenant context; failures are isolated per tenant. */
export async function forEachTenant(
  fn: (tenant: TenantInfo) => Promise<void>,
  opts: { statuses?: OrganizationStatus[] } = {},
) {
  const orgs = await Organization.findAll({
    where: opts.statuses ? { status: { [Op.in]: opts.statuses } } : {},
    order: [['createdAt', 'ASC']],
  });
  for (const org of orgs) {
    const info = toInfo(org);
    cache.set(org.id, { value: info, at: Date.now() });
    try {
      await runWithTenant({ organizationId: org.id, database: info.database }, () => fn(info));
    } catch (err) {
      logger.error({ err, organizationId: org.id }, 'Tenant task failed');
    }
  }
}

/** Organization that owns a login email: tenant directory first, then the primary database. */
export async function organizationForEmail(email: string): Promise<string | null> {
  const entry = await TenantUserDirectory.findByPk(email);
  return entry?.organizationId ?? null;
}

/** Emails are unique across the whole platform (login has no organization selector). */
export async function isEmailTaken(email: string): Promise<boolean> {
  if (await TenantUserDirectory.findByPk(email)) return true;
  return runInPrimaryDatabase(async () => (await User.count({ where: { email } })) > 0);
}

/** Registers a tenant-database user in the global directory (no-op for primary-database orgs). */
export async function registerDirectoryEntry(organizationId: string, userId: string, email: string, transaction?: Transaction) {
  const tenant = await resolveTenant(organizationId);
  if (!tenant?.database) return;
  await TenantUserDirectory.create({ email, organizationId, userId }, { transaction });
}

export async function tenantFeatures(organizationId: string): Promise<Set<FeatureKey>> {
  return (await resolveTenant(organizationId))?.features ?? enabledFeatures(null);
}

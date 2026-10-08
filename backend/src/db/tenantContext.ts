import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request/job scoped tenant routing. Every organization registered through the platform console owns
 * a dedicated MySQL database; tenant-scoped models read `database` from this store and qualify their
 * table names with it (`tenant_db`.`cameras`). `database: null` means the primary database, which
 * also holds the control plane (organizations, platform admins, user directory).
 */
export interface TenantStore {
  organizationId: string | null;
  database: string | null;
  /** Platform admin acting on behalf of this tenant ("view as"); recorded on every audit entry. */
  impersonatedBy?: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function currentTenant(): TenantStore | undefined {
  return storage.getStore();
}

export function currentTenantDatabase(): string | undefined {
  return storage.getStore()?.database ?? undefined;
}

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** Forces queries back onto the primary database (control-plane checks spanning all tenants). */
export function runInPrimaryDatabase<T>(fn: () => T): T {
  return storage.run({ organizationId: null, database: null }, fn);
}

const DB_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export function assertDatabaseName(name: string): string {
  if (!DB_NAME_RE.test(name)) throw new Error(`Invalid tenant database name "${name}"`);
  return name;
}

/** Table reference for hand-written SQL that must follow the current tenant. */
export function tenantTable(table: string): string {
  const db = currentTenantDatabase();
  return db ? `\`${assertDatabaseName(db)}\`.\`${table}\`` : `\`${table}\``;
}

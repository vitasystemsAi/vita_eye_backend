import { QueryTypes, type Sequelize } from 'sequelize';
import { env } from '../config/env';
import { buildSequelize } from '../config/database';
import { assertDatabaseName } from './tenantContext';
import { createMigrator } from './runner';

/** Privileged connection (no default schema) used for CREATE / DROP DATABASE and GRANT. */
function adminConnection() {
  return buildSequelize(null, env.DB_ADMIN_USER || env.DB_USER, env.DB_ADMIN_PASSWORD || env.DB_PASSWORD);
}

const quoted = (name: string) => `\`${assertDatabaseName(name)}\``;

export async function createTenantDatabase(name: string) {
  const admin = adminConnection();
  try {
    // No IF NOT EXISTS: names are generated per organization, so a collision must fail loudly.
    await admin.query(`CREATE DATABASE ${quoted(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    if (env.DB_ADMIN_USER && env.DB_ADMIN_USER !== env.DB_USER) {
      await admin.query(`GRANT ALL PRIVILEGES ON ${quoted(name)}.* TO ?@?`, { replacements: [env.DB_USER, env.DB_APP_USER_HOST] });
    }
  } finally {
    await admin.close();
  }
}

export async function dropTenantDatabase(name: string) {
  const admin = adminConnection();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoted(name)}`);
  } finally {
    await admin.close();
  }
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

/** Applies every pending organization-schema migration to one tenant database. */
export async function migrateTenantDatabase(name: string, logger: Parameters<typeof createMigrator>[1] = silent) {
  const tenant = buildSequelize(assertDatabaseName(name));
  try {
    return await createMigrator(tenant, logger).up();
  } finally {
    await tenant.close();
  }
}

/**
 * Copies the shared reference rows that tenant foreign keys point at: the RBAC catalogue (same ids
 * as the primary database, so cached role ids stay valid) and the organization row itself.
 */
export async function syncTenantReferenceData(primary: Sequelize, name: string, org: { id: string; name: string }) {
  const db = quoted(name);
  await primary.transaction(async (transaction) => {
    await primary.query(
      `INSERT INTO ${db}.permissions (id, name, description) SELECT id, name, description FROM permissions
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      { transaction },
    );
    await primary.query(
      `INSERT INTO ${db}.roles (id, name, description, created_at, updated_at) SELECT id, name, description, created_at, updated_at FROM roles
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), updated_at = VALUES(updated_at)`,
      { transaction },
    );
    await primary.query(`DELETE FROM ${db}.role_permissions`, { transaction });
    await primary.query(`INSERT INTO ${db}.role_permissions (role_id, permission_id) SELECT role_id, permission_id FROM role_permissions`, { transaction });
    await primary.query(
      `INSERT INTO ${db}.organizations (id, name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      { replacements: [org.id, org.name], transaction },
    );
  });
}

export async function listTenantDatabases(primary: Sequelize) {
  return primary.query<{ id: string; name: string; database_name: string }>(
    'SELECT id, name, database_name FROM organizations WHERE database_name IS NOT NULL ORDER BY created_at',
    { type: QueryTypes.SELECT },
  );
}

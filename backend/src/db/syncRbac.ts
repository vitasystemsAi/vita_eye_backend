import { PERMISSIONS, ROLES, type RoleName } from '../config/rbac';
import { logger } from '../config/logger';
import { sequelize } from '../config/database';
import { listTenantDatabases, syncTenantReferenceData } from './tenantDatabases';

/**
 * Copies the role catalogue from code into the primary database, then into each tenant database.
 * New permissions would otherwise stay invisible until someone re-runs the seeder.
 */
export async function syncRbacCatalogue() {
  await sequelize.transaction(async (transaction) => {
    for (const [name, description] of Object.entries(PERMISSIONS)) {
      await sequelize.query(
        'INSERT INTO permissions (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)',
        { replacements: [name, description], transaction },
      );
    }
    for (const [name, role] of Object.entries(ROLES) as Array<[RoleName, (typeof ROLES)[RoleName]]>) {
      await sequelize.query(
        'INSERT INTO roles (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description), updated_at = CURRENT_TIMESTAMP(3)',
        { replacements: [name, role.description], transaction },
      );
      const [rows] = (await sequelize.query('SELECT id FROM roles WHERE name = ?', { replacements: [name], transaction })) as [Array<{ id: number }>, unknown];
      const roleId = rows[0]?.id;
      if (!roleId) throw new Error(`Role ${name} was not saved`);
      await sequelize.query('DELETE FROM role_permissions WHERE role_id = ?', { replacements: [roleId], transaction });
      if (role.permissions.length) {
        await sequelize.query(
          'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)',
          { replacements: [roleId, role.permissions], transaction },
        );
      }
    }
  });

  let tenants: Awaited<ReturnType<typeof listTenantDatabases>> = [];
  try {
    tenants = await listTenantDatabases(sequelize);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Role catalogue was updated on the primary database; tenant databases were not listed');
    return;
  }
  for (const tenant of tenants) {
    try {
      await syncTenantReferenceData(sequelize, tenant.database_name, tenant);
    } catch (err) {
      logger.warn({ err: (err as Error).message, tenant: tenant.name }, 'Could not copy the role catalogue into a tenant database');
    }
  }
  logger.info({ tenants: tenants.length }, 'Role catalogue is current');
}

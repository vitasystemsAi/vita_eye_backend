'use strict';

/**
 * Idempotent: synchronises roles, permissions and role_permissions with backend/src/config/rbac.ts.
 * Context is provided by backend/src/db/runner.ts.
 */
async function up({ context: { queryInterface, rbac } }) {
  const sequelize = queryInterface.sequelize;
  await sequelize.transaction(async (transaction) => {
    for (const [name, description] of Object.entries(rbac.PERMISSIONS)) {
      await sequelize.query(
        'INSERT INTO permissions (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)',
        { replacements: [name, description], transaction },
      );
    }
    for (const [name, role] of Object.entries(rbac.ROLES)) {
      await sequelize.query(
        'INSERT INTO roles (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description), updated_at = CURRENT_TIMESTAMP(3)',
        { replacements: [name, role.description], transaction },
      );
      const [[roleRow]] = await sequelize.query('SELECT id FROM roles WHERE name = ?', { replacements: [name], transaction });
      await sequelize.query('DELETE FROM role_permissions WHERE role_id = ?', { replacements: [roleRow.id], transaction });
      if (role.permissions.length) {
        await sequelize.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT ?, id FROM permissions WHERE name IN (?)`,
          { replacements: [roleRow.id, role.permissions], transaction },
        );
      }
    }
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.bulkDelete('role_permissions', {});
}

module.exports = { up, down };

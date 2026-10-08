'use strict';

// Sessions opened by a platform admin through "view as" carry the admin's identity so that the
// impersonation survives token refresh and is visible in audit logs.
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('refresh_tokens', 'impersonated_by', { type: DataTypes.STRING(255), allowNull: true });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('refresh_tokens', 'impersonated_by');
}

module.exports = { up, down };

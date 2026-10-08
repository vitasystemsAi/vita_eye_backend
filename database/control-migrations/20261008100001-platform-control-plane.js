'use strict';

/**
 * Control plane (primary database only): platform admins, organization registry metadata, the
 * global user directory for tenant databases, the client credential vault and platform audit log.
 * Files in database/migrations run on the primary AND every tenant database; files here never do.
 */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.changeColumn('organizations', 'status', {
    type: DataTypes.ENUM('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
  });
  await queryInterface.addColumn('organizations', 'slug', { type: DataTypes.STRING(64), allowNull: true });
  await queryInterface.addColumn('organizations', 'database_name', { type: DataTypes.STRING(64), allowNull: true });
  await queryInterface.addColumn('organizations', 'features', { type: DataTypes.JSON, allowNull: true });
  await queryInterface.addColumn('organizations', 'detection_retention_days', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });
  await queryInterface.addColumn('organizations', 'contact_name', { type: DataTypes.STRING(120), allowNull: true });
  await queryInterface.addColumn('organizations', 'contact_email', { type: DataTypes.STRING(255), allowNull: true });
  await queryInterface.addColumn('organizations', 'contact_phone', { type: DataTypes.STRING(40), allowNull: true });
  await queryInterface.addColumn('organizations', 'hold_reason', { type: DataTypes.STRING(255), allowNull: true });
  await queryInterface.addColumn('organizations', 'held_at', { type: DataTypes.DATE(3), allowNull: true });
  await queryInterface.addColumn('organizations', 'created_by_platform_admin', { type: DataTypes.UUID, allowNull: true });
  await queryInterface.addIndex('organizations', ['slug'], { name: 'uq_organizations_slug', unique: true });
  await queryInterface.addIndex('organizations', ['database_name'], { name: 'uq_organizations_database', unique: true });

  await queryInterface.createTable('platform_admins', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
    failed_login_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    locked_until: { type: DataTypes.DATE(3), allowNull: true },
    last_login_at: { type: DataTypes.DATE(3), allowNull: true },
    token_version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });

  await queryInterface.createTable('tenant_user_directory', {
    email: { type: DataTypes.STRING(255), primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user_id: { type: DataTypes.UUID, allowNull: false },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('tenant_user_directory', ['organization_id'], { name: 'idx_directory_org' });

  await queryInterface.createTable('client_credentials', {
    organization_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user_id: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    encrypted_password: { type: DataTypes.TEXT, allowNull: false },
    updated_by: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });

  await queryInterface.createTable('platform_audit_logs', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    platform_admin_id: { type: DataTypes.UUID, allowNull: true },
    organization_id: { type: DataTypes.UUID, allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('platform_audit_logs', ['organization_id', 'created_at'], { name: 'idx_platform_audit_org_ts' });
  await queryInterface.addIndex('platform_audit_logs', ['created_at'], { name: 'idx_platform_audit_ts' });
}

async function down({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.dropTable('platform_audit_logs');
  await queryInterface.dropTable('client_credentials');
  await queryInterface.dropTable('tenant_user_directory');
  await queryInterface.dropTable('platform_admins');
  await queryInterface.removeIndex('organizations', 'uq_organizations_database');
  await queryInterface.removeIndex('organizations', 'uq_organizations_slug');
  for (const col of ['created_by_platform_admin', 'held_at', 'hold_reason', 'contact_phone', 'contact_email', 'contact_name', 'detection_retention_days', 'features', 'database_name', 'slug']) {
    await queryInterface.removeColumn('organizations', col);
  }
  await queryInterface.changeColumn('organizations', 'status', { type: DataTypes.ENUM('ACTIVE', 'SUSPENDED'), allowNull: false, defaultValue: 'ACTIVE' });
}

module.exports = { up, down };

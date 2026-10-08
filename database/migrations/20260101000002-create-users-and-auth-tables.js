'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.createTable('users', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    role_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      references: { model: 'roles', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    status: { type: DataTypes.ENUM('ACTIVE', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
    site_scope: { type: DataTypes.JSON, allowNull: true },
    failed_login_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    locked_until: { type: DataTypes.DATE(3), allowNull: true },
    last_login_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('users', ['organization_id'], { name: 'idx_users_org' });

  await queryInterface.createTable('refresh_tokens', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    revoked_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('refresh_tokens', ['user_id'], { name: 'idx_refresh_user' });

  await queryInterface.createTable('password_reset_tokens', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    used_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('password_reset_tokens');
  await queryInterface.dropTable('refresh_tokens');
  await queryInterface.dropTable('users');
}

module.exports = { up, down };

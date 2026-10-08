'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.createTable('audit_logs', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    action: { type: DataTypes.STRING(64), allowNull: false },
    entity_type: { type: DataTypes.STRING(64), allowNull: true },
    entity_id: { type: DataTypes.STRING(64), allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('audit_logs', ['organization_id', 'created_at'], { name: 'idx_audit_org_created' });
  await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], { name: 'idx_audit_entity' });
  await queryInterface.addIndex('audit_logs', ['action'], { name: 'idx_audit_action' });

  await queryInterface.createTable('app_settings', {
    organization_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    settings: { type: DataTypes.JSON, allowNull: false },
    updated_by: { type: DataTypes.UUID, allowNull: true },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('app_settings');
  await queryInterface.dropTable('audit_logs');
}

module.exports = { up, down };

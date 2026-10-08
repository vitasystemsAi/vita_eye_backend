'use strict';

/** @param {{ context: { queryInterface: import('sequelize').QueryInterface, Sequelize: typeof import('sequelize') } }} p */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const ts = {
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)') },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)') },
  };

  await queryInterface.createTable('organizations', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'SUSPENDED'), allowNull: false, defaultValue: 'ACTIVE' },
    ...ts,
  });

  await queryInterface.createTable('roles', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(255), allowNull: true },
    ...ts,
  });

  await queryInterface.createTable('permissions', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(255), allowNull: true },
  });

  await queryInterface.createTable('role_permissions', {
    role_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: 'roles', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    permission_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: 'permissions', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('role_permissions');
  await queryInterface.dropTable('permissions');
  await queryInterface.dropTable('roles');
  await queryInterface.dropTable('organizations');
}

module.exports = { up, down };

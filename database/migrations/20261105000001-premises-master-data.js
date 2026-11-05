'use strict';

/** Floors, rooms, beds, employee types and departments for an organization database. */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');
  const org = {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'organizations', key: 'id' },
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  };

  await queryInterface.createTable('floors', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: org,
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('floors', ['organization_id', 'sort_order'], { name: 'idx_floors_org_sort' });
  await queryInterface.addConstraint('floors', { type: 'unique', fields: ['organization_id', 'name'], name: 'uq_floors_org_name' });
  await queryInterface.addConstraint('floors', { type: 'unique', fields: ['organization_id', 'code'], name: 'uq_floors_org_code' });

  await queryInterface.createTable('rooms', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: org,
    floor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'floors', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    name: { type: DataTypes.STRING(80), allowNull: false },
    room_type: { type: DataTypes.STRING(32), allowNull: false },
    capacity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('rooms', ['organization_id', 'floor_id'], { name: 'idx_rooms_org_floor' });
  await queryInterface.addConstraint('rooms', { type: 'unique', fields: ['floor_id', 'name'], name: 'uq_rooms_floor_name' });

  await queryInterface.createTable('beds', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: org,
    room_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'rooms', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    label: { type: DataTypes.STRING(40), allowNull: false },
    status: {
      type: DataTypes.ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'),
      allowNull: false,
      defaultValue: 'AVAILABLE',
    },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('beds', ['organization_id', 'status'], { name: 'idx_beds_org_status' });
  await queryInterface.addConstraint('beds', { type: 'unique', fields: ['room_id', 'label'], name: 'uq_beds_room_label' });

  await queryInterface.createTable('employee_types', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: org,
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addConstraint('employee_types', { type: 'unique', fields: ['organization_id', 'name'], name: 'uq_employee_types_org_name' });
  await queryInterface.addConstraint('employee_types', { type: 'unique', fields: ['organization_id', 'code'], name: 'uq_employee_types_org_code' });

  await queryInterface.createTable('departments', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: org,
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    seat_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addConstraint('departments', { type: 'unique', fields: ['organization_id', 'name'], name: 'uq_departments_org_name' });
  await queryInterface.addConstraint('departments', { type: 'unique', fields: ['organization_id', 'code'], name: 'uq_departments_org_code' });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('beds');
  await queryInterface.dropTable('rooms');
  await queryInterface.dropTable('floors');
  await queryInterface.dropTable('employee_types');
  await queryInterface.dropTable('departments');
}

module.exports = { up, down };

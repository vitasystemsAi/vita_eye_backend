'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.createTable('registered_persons', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    person_name: { type: DataTypes.STRING(160), allowNull: false },
    reference_id: { type: DataTypes.STRING(64), allowNull: false },
    department: { type: DataTypes.STRING(120), allowNull: true },
    status: { type: DataTypes.ENUM('ACTIVE', 'INACTIVE'), allowNull: false, defaultValue: 'ACTIVE' },
    enrollment_status: {
      type: DataTypes.ENUM('PENDING', 'ENROLLED', 'FAILED', 'REVOKED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    legal_basis: { type: DataTypes.STRING(120), allowNull: true },
    consent_reference: { type: DataTypes.STRING(255), allowNull: true },
    consent_recorded_at: { type: DataTypes.DATE(3), allowNull: true },
    enrolled_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  });
  await queryInterface.addConstraint('registered_persons', {
    type: 'unique',
    fields: ['organization_id', 'reference_id'],
    name: 'uq_persons_org_reference',
  });
  await queryInterface.addIndex('registered_persons', ['organization_id', 'enrollment_status'], {
    name: 'idx_persons_org_enrollment',
  });
  await queryInterface.addIndex('registered_persons', ['organization_id', 'person_name'], { name: 'idx_persons_org_name' });

  await queryInterface.createTable('face_templates', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    registered_person_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'registered_persons', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    encrypted_embedding: { type: DataTypes.TEXT, allowNull: false },
    model_name: { type: DataTypes.STRING(64), allowNull: false },
    model_version: { type: DataTypes.STRING(64), allowNull: false },
    quality_score: { type: DataTypes.FLOAT, allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('face_templates', ['registered_person_id'], { name: 'idx_templates_person' });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('face_templates');
  await queryInterface.dropTable('registered_persons');
}

module.exports = { up, down };

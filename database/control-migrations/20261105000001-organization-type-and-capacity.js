'use strict';

/**
 * Organization type and licensed capacity live on the control-plane organization row.
 * Tenant databases keep their own master-data tables (floors, rooms, beds, workforce).
 */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('organizations', 'organization_type', {
    type: DataTypes.ENUM('OFFICE', 'HOSTEL', 'HOME', 'SCHOOL', 'HOSPITAL', 'OTHER'),
    allowNull: false,
    defaultValue: 'OTHER',
  });
  await queryInterface.addColumn('organizations', 'capacity', {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('organizations', 'capacity');
  await queryInterface.removeColumn('organizations', 'organization_type');
}

module.exports = { up, down };

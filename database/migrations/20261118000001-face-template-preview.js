'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('face_templates', 'preview_reference', {
    type: DataTypes.STRING(512),
    allowNull: true,
  });
  await queryInterface.addColumn('face_templates', 'preview_mime', {
    type: DataTypes.STRING(32),
    allowNull: true,
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('face_templates', 'preview_mime');
  await queryInterface.removeColumn('face_templates', 'preview_reference');
}

module.exports = { up, down };

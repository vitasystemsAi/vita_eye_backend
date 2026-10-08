'use strict';

// SNAPSHOT = full scene with the face outlined; FACE = zoomed close-up of the face.
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.changeColumn('event_evidence', 'evidence_type', {
    type: DataTypes.ENUM('SNAPSHOT', 'FACE', 'CLIP'),
    allowNull: false,
    defaultValue: 'SNAPSHOT',
  });
}

async function down({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.bulkDelete('event_evidence', { evidence_type: 'FACE' });
  await queryInterface.changeColumn('event_evidence', 'evidence_type', {
    type: DataTypes.ENUM('SNAPSHOT', 'CLIP'),
    allowNull: false,
    defaultValue: 'SNAPSHOT',
  });
}

module.exports = { up, down };

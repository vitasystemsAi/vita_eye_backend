'use strict';

/** Lets a camera leave the live list while detection events still point at the row. */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('cameras', 'deleted_at', {
    type: DataTypes.DATE(3),
    allowNull: true,
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('cameras', 'deleted_at');
}

module.exports = { up, down };

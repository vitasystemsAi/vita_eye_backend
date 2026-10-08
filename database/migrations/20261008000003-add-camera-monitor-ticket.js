'use strict';

// Id of the device ticket issued when browser monitoring starts. Clearing it (Stop) revokes the
// ticket, so a monitoring device keeps streaming independently of any user login session.
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('cameras', 'monitor_ticket_id', { type: DataTypes.CHAR(36), allowNull: true });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('cameras', 'monitor_ticket_id');
}

module.exports = { up, down };

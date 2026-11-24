'use strict';

/** One site-connector secret per organization. The plaintext key is shown once; only the hash is stored. */
async function up({ context: { queryInterface, Sequelize } }) {
  await queryInterface.addColumn('organizations', 'connector_key_hash', {
    type: Sequelize.DataTypes.CHAR(64),
    allowNull: true,
    unique: true,
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.removeColumn('organizations', 'connector_key_hash');
}

module.exports = { up, down };

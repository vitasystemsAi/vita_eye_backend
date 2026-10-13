'use strict';

/** Suspended is a reversible hold. Inactive and suspended registrations can be deleted after 7 days. */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.sequelize.query(
    "ALTER TABLE `registered_persons` MODIFY `status` ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE'",
  );
  await queryInterface.addColumn('registered_persons', 'status_changed_at', {
    type: DataTypes.DATE(3),
    allowNull: true,
  });
  await queryInterface.sequelize.query(
    'UPDATE `registered_persons` SET `status_changed_at` = `updated_at` WHERE `status_changed_at` IS NULL',
  );
  await queryInterface.changeColumn('registered_persons', 'status_changed_at', {
    type: DataTypes.DATE(3),
    allowNull: false,
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.sequelize.query("UPDATE `registered_persons` SET `status` = 'INACTIVE' WHERE `status` = 'SUSPENDED'");
  await queryInterface.sequelize.query(
    "ALTER TABLE `registered_persons` MODIFY `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE'",
  );
  await queryInterface.removeColumn('registered_persons', 'status_changed_at');
}

module.exports = { up, down };

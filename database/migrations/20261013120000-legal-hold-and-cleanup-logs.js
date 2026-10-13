'use strict';

/** Per-event legal hold, and the organization copy of retention cleanup reports. */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  await queryInterface.addColumn('detection_events', 'legal_hold', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.createTable('retention_cleanup_logs', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: { type: DataTypes.UUID, allowNull: false },
    mode: { type: DataTypes.ENUM('DRY_RUN', 'ENFORCE', 'SKIPPED'), allowNull: false },
    cutoff_at: { type: DataTypes.DATE(3), allowNull: true },
    processed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    deleted: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    failed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    remaining: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    skipped_holds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    error: { type: DataTypes.STRING(500), allowNull: true },
    started_at: { type: DataTypes.DATE(3), allowNull: false },
    finished_at: { type: DataTypes.DATE(3), allowNull: false },
  });
  await queryInterface.addIndex('retention_cleanup_logs', ['organization_id', 'finished_at'], { name: 'idx_retention_log_org' });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('retention_cleanup_logs');
  await queryInterface.removeColumn('detection_events', 'legal_hold');
}

module.exports = { up, down };

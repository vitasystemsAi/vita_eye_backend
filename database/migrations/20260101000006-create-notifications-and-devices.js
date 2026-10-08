'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.createTable('notifications', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    event_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'detection_events', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    channel: { type: DataTypes.ENUM('IN_APP', 'EMAIL', 'PUSH'), allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    delivery_status: {
      type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.STRING(512), allowNull: true },
    sent_at: { type: DataTypes.DATE(3), allowNull: true },
    read_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  // Duplicate-alert guard: one notification per event, recipient and channel.
  // (MySQL treats NULL event_id as distinct, so test notifications are unaffected.)
  await queryInterface.addConstraint('notifications', {
    type: 'unique',
    fields: ['event_id', 'user_id', 'channel'],
    name: 'uq_notifications_event_user_channel',
  });
  await queryInterface.addIndex('notifications', ['user_id', 'created_at'], { name: 'idx_notifications_user_created' });
  await queryInterface.addIndex('notifications', ['delivery_status', 'created_at'], { name: 'idx_notifications_status' });

  await queryInterface.createTable('user_devices', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    fcm_token: { type: DataTypes.STRING(512), allowNull: false },
    user_agent: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('user_devices', ['user_id'], { name: 'idx_devices_user' });
  await queryInterface.addIndex('user_devices', ['fcm_token'], { name: 'uq_devices_token', unique: true });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('user_devices');
  await queryInterface.dropTable('notifications');
}

module.exports = { up, down };

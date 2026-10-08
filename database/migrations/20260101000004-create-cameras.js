'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await queryInterface.createTable('cameras', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    camera_name: { type: DataTypes.STRING(120), allowNull: false },
    camera_type: { type: DataTypes.ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG'), allowNull: false },
    location: { type: DataTypes.STRING(160), allowNull: false },
    site: { type: DataTypes.STRING(120), allowNull: true },
    stream_reference: { type: DataTypes.STRING(512), allowNull: true },
    encrypted_credentials: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM('ONLINE', 'OFFLINE', 'ERROR', 'DISABLED'),
      allowNull: false,
      defaultValue: 'OFFLINE',
    },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    monitoring_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    schedule: { type: DataTypes.JSON, allowNull: true },
    sampling_fps: { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: 1.0 },
    last_error: { type: DataTypes.STRING(512), allowNull: true },
    last_connected_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('cameras', ['organization_id', 'status'], { name: 'idx_cameras_org_status' });
  await queryInterface.addIndex('cameras', ['organization_id', 'site'], { name: 'idx_cameras_org_site' });
  await queryInterface.addConstraint('cameras', {
    type: 'unique',
    fields: ['organization_id', 'camera_name'],
    name: 'uq_cameras_org_name',
  });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('cameras');
}

module.exports = { up, down };

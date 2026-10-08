'use strict';

async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');
  const userRef = {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  };

  await queryInterface.createTable('detection_events', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    camera_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'cameras', key: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    registered_person_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'registered_persons', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    event_type: { type: DataTypes.ENUM('KNOWN', 'UNKNOWN', 'UNCERTAIN'), allowNull: false },
    confidence_score: { type: DataTypes.DECIMAL(6, 4), allowNull: true },
    quality_score: { type: DataTypes.DECIMAL(6, 4), allowNull: true },
    model_version: { type: DataTypes.STRING(128), allowNull: false },
    track_id: { type: DataTypes.STRING(64), allowNull: true },
    frames_observed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    event_timestamp: { type: DataTypes.DATE(3), allowNull: false },
    review_status: {
      type: DataTypes.ENUM('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'),
      allowNull: false,
      defaultValue: 'NEW',
    },
    acknowledged_by: userRef,
    acknowledged_at: { type: DataTypes.DATE(3), allowNull: true },
    resolved_by: userRef,
    resolved_at: { type: DataTypes.DATE(3), allowNull: true },
    resolution: { type: DataTypes.STRING(64), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('detection_events', ['organization_id', 'event_timestamp'], { name: 'idx_events_org_ts' });
  await queryInterface.addIndex('detection_events', ['camera_id', 'event_timestamp'], { name: 'idx_events_camera_ts' });
  await queryInterface.addIndex('detection_events', ['organization_id', 'event_type', 'event_timestamp'], {
    name: 'idx_events_org_type_ts',
  });
  await queryInterface.addIndex('detection_events', ['organization_id', 'review_status'], { name: 'idx_events_org_review' });
  await queryInterface.addIndex('detection_events', ['registered_person_id', 'camera_id', 'event_timestamp'], {
    name: 'idx_events_person_camera_ts',
  });

  await queryInterface.createTable('event_evidence', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    event_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'detection_events', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    storage_reference: { type: DataTypes.STRING(512), allowNull: false },
    evidence_type: { type: DataTypes.ENUM('SNAPSHOT', 'CLIP'), allowNull: false, defaultValue: 'SNAPSHOT' },
    content_hash: { type: DataTypes.CHAR(64), allowNull: false },
    mime_type: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'image/jpeg' },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    expires_at: { type: DataTypes.DATE(3), allowNull: true },
  });
  await queryInterface.addIndex('event_evidence', ['event_id'], { name: 'idx_evidence_event' });
  await queryInterface.addIndex('event_evidence', ['expires_at'], { name: 'idx_evidence_expires' });

  await queryInterface.createTable('event_notes', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    event_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'detection_events', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user_id: userRef,
    note: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('event_notes', ['event_id', 'created_at'], { name: 'idx_notes_event' });
}

async function down({ context: { queryInterface } }) {
  await queryInterface.dropTable('event_notes');
  await queryInterface.dropTable('event_evidence');
  await queryInterface.dropTable('detection_events');
}

module.exports = { up, down };

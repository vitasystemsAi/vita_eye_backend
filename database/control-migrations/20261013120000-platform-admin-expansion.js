'use strict';

/**
 * Extends the control plane for subscriptions, account lifecycle, provisioning retries,
 * legal holds, password-reset issuance and retention reports.
 * Does not run on tenant databases.
 */
async function up({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const sequelize = queryInterface.sequelize;
  const now = () => Sequelize.literal('CURRENT_TIMESTAMP(3)');

  await sequelize.query(`
    ALTER TABLE organizations MODIFY COLUMN status
    ENUM('PROVISIONING','PENDING','ACTIVE','SUSPENDED','ON_HOLD','DEACTIVATED','ARCHIVED','FAILED')
    NOT NULL DEFAULT 'ACTIVE'
  `);

  const columns = [
    ['code', { type: DataTypes.STRING(32), allowNull: true }],
    ['timezone', { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'UTC' }],
    ['subscription_plan', { type: DataTypes.STRING(32), allowNull: true }],
    ['camera_limit', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }],
    ['storage_limit_bytes', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }],
    ['retention_grace_days', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }],
    ['retention_mode', { type: DataTypes.ENUM('DRY_RUN', 'ENFORCE'), allowNull: false, defaultValue: 'ENFORCE' }],
    ['provisioning_error', { type: DataTypes.STRING(500), allowNull: true }],
    ['pending_admin_name', { type: DataTypes.STRING(120), allowNull: true }],
    ['pending_admin_email', { type: DataTypes.STRING(255), allowNull: true }],
    ['pending_password_hash', { type: DataTypes.STRING(255), allowNull: true }],
  ];
  for (const [name, spec] of columns) {
    await queryInterface.addColumn('organizations', name, spec);
  }
  await queryInterface.addIndex('organizations', ['code'], { name: 'uq_organizations_code', unique: true });
  await queryInterface.addIndex('organizations', ['contact_email'], { name: 'uq_organizations_contact_email', unique: true });

  // Existing explicit feature lists keep newly supported flags that would otherwise turn off.
  const [rows] = await sequelize.query("SELECT id, features FROM organizations WHERE features IS NOT NULL");
  for (const row of rows) {
    const raw = row.features;
    const features = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(features)) continue;
    const next = [...new Set([...features, 'multiCameraDashboard', 'exportDownload'])];
    await sequelize.query('UPDATE organizations SET features = ? WHERE id = ?', {
      replacements: [JSON.stringify(next), row.id],
    });
  }

  await queryInterface.changeColumn('client_credentials', 'encrypted_password', { type: DataTypes.TEXT, allowNull: true });
  await sequelize.query('UPDATE client_credentials SET encrypted_password = NULL');

  await queryInterface.createTable('subscription_plans', {
    code: { type: DataTypes.STRING(32), primaryKey: true, allowNull: false },
    label: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: false },
    camera_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    storage_limit_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    retention_max_days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    features: { type: DataTypes.JSON, allowNull: false },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });

  const gb = (n) => n * 1024 * 1024 * 1024;
  const starter = ['dashboard', 'liveMonitoring', 'cameraManagement', 'detectionHistory', 'notifications', 'userManagement'];
  const professional = [...starter, 'multiCameraDashboard', 'faceRegistration', 'unknownAlerts', 'evidenceCapture', 'reportsExport', 'exportDownload', 'emailAlerts', 'settings', 'auditLogs'];
  const enterprise = [...professional, 'pushAlerts'];
  const plans = [
    ['STARTER', 'Starter', 'Live monitoring, detection history, cameras and user management', 8, gb(5), 15, starter],
    ['PROFESSIONAL', 'Professional', 'Face recognition, evidence, reports, multi-camera monitoring and audit', 32, gb(50), 90, professional],
    ['ENTERPRISE', 'Enterprise', 'Every feature supported by this deployment', null, null, 3650, enterprise],
  ];
  for (const plan of plans) {
    await sequelize.query(
      `INSERT INTO subscription_plans (code, label, description, camera_limit, storage_limit_bytes, retention_max_days, features)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      { replacements: [plan[0], plan[1], plan[2], plan[3], plan[4], plan[5], JSON.stringify(plan[6])] },
    );
  }

  await queryInterface.createTable('organization_subscriptions', {
    organization_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    plan_code: {
      type: DataTypes.STRING(32),
      allowNull: false,
      references: { model: 'subscription_plans', key: 'code' },
      onUpdate: 'CASCADE',
    },
    camera_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    storage_limit_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    updated_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });

  await queryInterface.createTable('organization_holds', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    hold_type: { type: DataTypes.ENUM('LEGAL', 'INVESTIGATION'), allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    released_by: { type: DataTypes.UUID, allowNull: true },
    released_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('organization_holds', ['organization_id', 'active'], { name: 'idx_org_holds_active' });

  await queryInterface.createTable('provisioning_jobs', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    organization_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'organizations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    status: { type: DataTypes.ENUM('RUNNING', 'SUCCEEDED', 'FAILED'), allowNull: false },
    attempt: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    database_name: { type: DataTypes.STRING(64), allowNull: false },
    error: { type: DataTypes.STRING(500), allowNull: true },
    started_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
    finished_at: { type: DataTypes.DATE(3), allowNull: true },
  });
  await queryInterface.addIndex('provisioning_jobs', ['organization_id', 'started_at'], { name: 'idx_provisioning_org' });

  await queryInterface.createTable('password_reset_requests', {
    id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
    kind: { type: DataTypes.ENUM('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN'), allowNull: false },
    subject_id: { type: DataTypes.UUID, allowNull: false },
    organization_id: { type: DataTypes.UUID, allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: false },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    used_at: { type: DataTypes.DATE(3), allowNull: true },
    requested_by: { type: DataTypes.UUID, allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    created_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: now() },
  });
  await queryInterface.addIndex('password_reset_requests', ['token_hash'], { name: 'uq_password_reset_hash', unique: true });
  await queryInterface.addIndex('password_reset_requests', ['email', 'created_at'], { name: 'idx_password_reset_email' });

  await queryInterface.createTable('retention_cleanup_runs', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
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
  await queryInterface.addIndex('retention_cleanup_runs', ['organization_id', 'finished_at'], { name: 'idx_cleanup_org_finished' });
}

async function down({ context: { queryInterface, Sequelize } }) {
  const { DataTypes } = Sequelize;
  const sequelize = queryInterface.sequelize;
  await queryInterface.dropTable('retention_cleanup_runs');
  await queryInterface.dropTable('password_reset_requests');
  await queryInterface.dropTable('provisioning_jobs');
  await queryInterface.dropTable('organization_holds');
  await queryInterface.dropTable('organization_subscriptions');
  await queryInterface.dropTable('subscription_plans');
  await sequelize.query("UPDATE client_credentials SET encrypted_password = '' WHERE encrypted_password IS NULL");
  await queryInterface.changeColumn('client_credentials', 'encrypted_password', { type: DataTypes.TEXT, allowNull: false });
  await queryInterface.removeIndex('organizations', 'uq_organizations_contact_email');
  await queryInterface.removeIndex('organizations', 'uq_organizations_code');
  for (const col of [
    'pending_password_hash',
    'pending_admin_email',
    'pending_admin_name',
    'provisioning_error',
    'retention_mode',
    'retention_grace_days',
    'storage_limit_bytes',
    'camera_limit',
    'subscription_plan',
    'timezone',
    'code',
  ]) {
    await queryInterface.removeColumn('organizations', col);
  }
  await sequelize.query("UPDATE organizations SET status = 'SUSPENDED' WHERE status IN ('ON_HOLD','DEACTIVATED','ARCHIVED','PENDING')");
  await sequelize.query(`
    ALTER TABLE organizations MODIFY COLUMN status
    ENUM('PROVISIONING','ACTIVE','SUSPENDED','FAILED')
    NOT NULL DEFAULT 'ACTIVE'
  `);
}

module.exports = { up, down };

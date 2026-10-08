'use strict';

/**
 * Creates the platform administrator (VITA Systems) from PLATFORM_ADMIN_* environment variables.
 * Skips when the account already exists; the password is never overwritten by re-seeding.
 */
async function up({ context: { queryInterface, env, hashPassword, uuid, log } }) {
  const sequelize = queryInterface.sequelize;
  const email = String(env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    log('PLATFORM_ADMIN_EMAIL not set — platform admin NOT created');
    return;
  }
  const [[existing]] = await sequelize.query('SELECT id FROM platform_admins WHERE email = ?', { replacements: [email] });
  if (existing) {
    log(`Platform admin ${email} already exists — skipped`);
    return;
  }
  if (!env.PLATFORM_ADMIN_PASSWORD || env.PLATFORM_ADMIN_PASSWORD.length < 12) {
    log('PLATFORM_ADMIN_PASSWORD not set (min 12 chars) — platform admin NOT created');
    return;
  }
  const id = uuid();
  await sequelize.query(
    `INSERT INTO platform_admins (id, name, email, password_hash, status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
    { replacements: [id, env.PLATFORM_ADMIN_NAME, email, await hashPassword(env.PLATFORM_ADMIN_PASSWORD)] },
  );
  await sequelize.query(
    `INSERT INTO platform_audit_logs (platform_admin_id, action, metadata) VALUES (?, 'PLATFORM_ADMIN_SEEDED', ?)`,
    { replacements: [id, JSON.stringify({ email })] },
  );
  log(`Created platform admin ${email}`);
}

async function down() {
  // Intentionally a no-op.
}

module.exports = { up, down };

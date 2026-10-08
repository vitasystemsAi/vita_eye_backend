'use strict';

/**
 * Development bootstrap: creates the first organization, its default settings and a SUPER_ADMIN
 * account from SEED_* environment variables. Skips anything that already exists.
 */
async function up({ context: { queryInterface, env, defaultSettings, hashPassword, uuid, log } }) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (transaction) => {
    let [[org]] = await sequelize.query('SELECT id FROM organizations ORDER BY created_at LIMIT 1', { transaction });
    if (!org) {
      org = { id: uuid() };
      await sequelize.query('INSERT INTO organizations (id, name, status) VALUES (?, ?, ?)', {
        replacements: [org.id, env.SEED_ORG_NAME, 'ACTIVE'],
        transaction,
      });
      log(`Created organization "${env.SEED_ORG_NAME}"`);
    }

    await sequelize.query(
      'INSERT IGNORE INTO app_settings (organization_id, settings) VALUES (?, ?)',
      { replacements: [org.id, JSON.stringify(defaultSettings)], transaction },
    );

    const email = String(env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
    const [[existing]] = await sequelize.query('SELECT id FROM users WHERE email = ?', { replacements: [email], transaction });
    if (existing) {
      log(`Admin ${email} already exists — skipped`);
      return;
    }
    if (!env.SEED_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD.length < 12) {
      log('SEED_ADMIN_PASSWORD not set (min 12 chars) — admin user NOT created');
      return;
    }
    const [[role]] = await sequelize.query("SELECT id FROM roles WHERE name = 'SUPER_ADMIN'", { transaction });
    const id = uuid();
    await sequelize.query(
      `INSERT INTO users (id, name, email, password_hash, role_id, organization_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      { replacements: [id, env.SEED_ADMIN_NAME, email, await hashPassword(env.SEED_ADMIN_PASSWORD), role.id, org.id], transaction },
    );
    await sequelize.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
       VALUES (?, NULL, 'USER_SEEDED', 'user', ?, ?)`,
      { replacements: [org.id, id, JSON.stringify({ email })], transaction },
    );
    log(`Created SUPER_ADMIN ${email}`);
  });
}

async function down() {
  // Intentionally a no-op: never delete real organization/user data from a seed rollback.
}

module.exports = { up, down };

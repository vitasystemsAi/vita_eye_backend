/* eslint-disable no-console */
import type { Sequelize } from 'sequelize';
import { env } from '../config/env';
import { buildSequelize } from '../config/database';
import { createControlMigrator, createMigrator, createSeeder } from './runner';
import { listTenantDatabases, migrateTenantDatabase, syncTenantReferenceData } from './tenantDatabases';

/** Brings every organization database up to the current schema and RBAC catalogue. */
async function migrateTenants(primary: Sequelize) {
  const tenants = await listTenantDatabases(primary);
  for (const t of tenants) {
    const done = await migrateTenantDatabase(t.database_name);
    await syncTenantReferenceData(primary, t.database_name, t);
    console.log(`Tenant "${t.name}" (${t.database_name}): ${done.length ? `applied ${done.length} migration(s)` : 'up to date'}`);
  }
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'create') {
    const admin = buildSequelize(null, env.DB_ADMIN_USER || env.DB_USER, env.DB_ADMIN_PASSWORD || env.DB_PASSWORD);
    try {
      // DB_NAME is validated against ^[A-Za-z0-9_]+$ in config/env.ts
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      console.log(`Database "${env.DB_NAME}" is ready on ${env.DB_HOST}:${env.DB_PORT}`);
    } finally {
      await admin.close();
    }
    return;
  }

  const sequelize = buildSequelize();
  try {
    await sequelize.authenticate();
    switch (cmd) {
      case 'migrate': {
        const done = await createMigrator(sequelize).up();
        const control = await createControlMigrator(sequelize).up();
        const total = done.length + control.length;
        console.log(total ? `Applied ${total} migration(s) to the primary database` : 'Primary database schema is up to date');
        await migrateTenants(sequelize);
        break;
      }
      case 'migrate:undo': {
        const undone = await createMigrator(sequelize).down();
        console.log(`Reverted ${undone.map((m) => m.name).join(', ') || 'nothing'}`);
        break;
      }
      case 'migrate:undo:control': {
        const undone = await createControlMigrator(sequelize).down();
        console.log(`Reverted ${undone.map((m) => m.name).join(', ') || 'nothing'}`);
        break;
      }
      case 'status': {
        const m = createMigrator(sequelize);
        const c = createControlMigrator(sequelize);
        console.log('Executed:', (await m.executed()).map((x) => x.name));
        console.log('Pending :', (await m.pending()).map((x) => x.name));
        console.log('Control executed:', (await c.executed()).map((x) => x.name));
        console.log('Control pending :', (await c.pending()).map((x) => x.name));
        for (const t of await listTenantDatabases(sequelize).catch(() => [])) {
          const tenant = buildSequelize(t.database_name);
          try {
            console.log(`Tenant ${t.name} (${t.database_name}) pending:`, (await createMigrator(tenant).pending()).map((x) => x.name));
          } finally {
            await tenant.close();
          }
        }
        break;
      }
      case 'seed': {
        await createSeeder(sequelize).up();
        await migrateTenants(sequelize);
        console.log('Seeding complete');
        break;
      }
      default:
        console.log('Usage: tsx src/db/cli.ts <create|migrate|migrate:undo|migrate:undo:control|status|seed>');
        process.exitCode = 1;
    }
  } finally {
    await sequelize.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import path from 'node:path';
import crypto from 'node:crypto';
import { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug, memoryStorage, type UmzugOptions } from 'umzug';
import { env } from '../config/env';
import { DEFAULT_SETTINGS } from '../config/defaultSettings';
import { PERMISSIONS, ROLES } from '../config/rbac';
import { hashPassword } from '../utils/password';

const databaseDir = path.join(env.rootDir, 'database');

function toPosix(p: string) {
  return p.split(path.sep).join('/');
}

type Logger = UmzugOptions['logger'];

/** Organization schema: applied to the primary database and to every tenant database. */
export function createMigrator(sequelize: Sequelize, logger: Logger = console) {
  return new Umzug({
    migrations: { glob: ['*.js', { cwd: toPosix(path.join(databaseDir, 'migrations')) }] },
    context: { queryInterface: sequelize.getQueryInterface(), Sequelize: require('sequelize') },
    storage: new SequelizeStorage({ sequelize, tableName: 'SequelizeMeta' }),
    logger,
  });
}

/** Control plane schema: primary database only. */
export function createControlMigrator(sequelize: Sequelize, logger: Logger = console) {
  return new Umzug({
    migrations: { glob: ['*.js', { cwd: toPosix(path.join(databaseDir, 'control-migrations')) }] },
    context: { queryInterface: sequelize.getQueryInterface(), Sequelize: require('sequelize') },
    storage: new SequelizeStorage({ sequelize, tableName: 'SequelizeControlMeta' }),
    logger,
  });
}

export function createSeeder(sequelize: Sequelize) {
  return new Umzug({
    migrations: { glob: ['*.js', { cwd: toPosix(path.join(databaseDir, 'seeders')) }] },
    context: {
      queryInterface: sequelize.getQueryInterface(),
      Sequelize: require('sequelize'),
      env,
      rbac: { PERMISSIONS, ROLES },
      defaultSettings: DEFAULT_SETTINGS,
      hashPassword,
      uuid: () => crypto.randomUUID(),
      // eslint-disable-next-line no-console
      log: (msg: string) => console.log(`  [seed] ${msg}`),
    },
    // Role/permission seeding is idempotent and safe to re-run, so seeds are not recorded.
    // Omitting storage makes Umzug fall back to JSONStorage (backend/umzug.json), which would
    // skip later catalogue changes such as a new role. Memory storage starts empty every run.
    storage: memoryStorage(),
    logger: console,
  });
}

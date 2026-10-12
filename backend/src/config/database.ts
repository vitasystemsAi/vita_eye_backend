import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from './logger';

/** Pass `database: null` to connect without selecting a schema (used by db:create). */
export function buildSequelize(database: string | null = env.DB_NAME, user = env.DB_USER, password = env.DB_PASSWORD) {
  return new Sequelize(database ?? '', user, password, {
    host: env.DB_HOST,
    port: env.DB_PORT,
    dialect: 'mysql',
    timezone: '+00:00',
    logging: env.LOG_LEVEL === 'debug' ? (sql: string) => logger.debug(sql) : false,
    pool: { max: env.DB_POOL_MAX, min: 0, idle: 10_000, acquire: 30_000 },
    dialectOptions: {
      ...(env.DB_SSL ? { ssl: 'Amazon RDS' } : {}),
      dateStrings: false,
      supportBigNumbers: true,
    },
    define: { underscored: true, timestamps: true },
  });
}

interface TableRef {
  tableName: string;
  schema?: string;
  as?: string;
  name?: string;
}

interface QueryGenerator {
  quoteIdentifier(id: string): string;
  quoteTable(param: unknown, alias?: unknown): string;
}

/**
 * Sequelize's MySQL dialect folds a model schema into the table name (`schema.table` as one
 * identifier). Tenant routing needs real cross-database references on the shared connection pool,
 * so a schema is emitted as its own identifier: `tenant_db`.`table`.
 */
function enableDatabaseQualifiedTables(instance: Sequelize) {
  const qg = (instance.getQueryInterface() as unknown as { queryGenerator: QueryGenerator }).queryGenerator;
  const original = qg.quoteTable.bind(qg);
  qg.quoteTable = (param: unknown, alias?: unknown) => {
    if (param && typeof param === 'object' && (param as TableRef).schema) {
      const ref = param as TableRef;
      const as = alias === true ? ref.as || ref.name || ref.tableName : alias;
      const table = `${qg.quoteIdentifier(ref.schema!)}.${qg.quoteIdentifier(ref.tableName)}`;
      return typeof as === 'string' && as ? `${table} AS ${qg.quoteIdentifier(as)}` : table;
    }
    return original(param, alias);
  };
}

export const sequelize = buildSequelize();
enableDatabaseQualifiedTables(sequelize);

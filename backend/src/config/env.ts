import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const rootDir = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  BACKEND_HOST: z.string().min(1).default('127.0.0.1'),
  BACKEND_PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3001'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3001'),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: bool(false),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/, 'DB_NAME may only contain letters, digits and _').default('vita_eye_db'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().default(''),
  DB_ADMIN_USER: z.string().optional(),
  DB_ADMIN_PASSWORD: z.string().optional(),
  DB_SSL: bool(false),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  EVIDENCE_URL_SECRET: z.string().min(32, 'EVIDENCE_URL_SECRET must be at least 32 characters'),
  DATA_ENCRYPTION_KEYS: z.string().min(1),
  DATA_ENCRYPTION_ACTIVE_KEY: z.string().min(1),
  INTERNAL_SERVICE_TOKEN: z.string().min(24, 'INTERNAL_SERVICE_TOKEN must be at least 24 characters'),

  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  MAX_CONCURRENT_INFERENCE: z.coerce.number().int().positive().default(4),

  CAMERA_ALLOWED_NETWORKS: z.string().default('10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8'),
  CAMERA_BLOCKED_NETWORKS: z.string().default('169.254.0.0/16'),

  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),
  EVIDENCE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().default('VITA EYE Alerts <alerts@example.com>'),

  FCM_ENABLED: bool(false),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional().default(''),

  SEED_ORG_NAME: z.string().default('VITA EYE Demo Organization'),
  SEED_ADMIN_NAME: z.string().default('System Administrator'),
  SEED_ADMIN_EMAIL: z.string().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: z.string().optional().default(''),

  PLATFORM_ADMIN_NAME: z.string().default('VITA Systems Platform Admin'),
  PLATFORM_ADMIN_EMAIL: z.string().optional().default(''),
  PLATFORM_ADMIN_PASSWORD: z.string().optional().default(''),
  PLATFORM_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),

  // Every registered organization gets its own database: <prefix><slug>_<id fragment>
  TENANT_DB_PREFIX: z.string().regex(/^[A-Za-z0-9_]*$/, 'TENANT_DB_PREFIX may only contain letters, digits and _').optional().default(''),
  // Host part used when granting DB_USER access to new tenant databases (only when DB_ADMIN_USER differs)
  DB_APP_USER_HOST: z.string().default('%'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}\nSee .env.example`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  rootDir,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  frontendOrigins: raw.FRONTEND_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  evidenceDir: path.isAbsolute(raw.EVIDENCE_STORAGE_DIR)
    ? raw.EVIDENCE_STORAGE_DIR
    : path.resolve(rootDir, raw.EVIDENCE_STORAGE_DIR),
  cookieSecure: raw.COOKIE_SECURE || raw.NODE_ENV === 'production',
  tenantDbPrefix: raw.TENANT_DB_PREFIX || `${raw.DB_NAME}_org_`,
};

export type Env = typeof env;

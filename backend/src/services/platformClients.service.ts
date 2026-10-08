import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { DEFAULT_SETTINGS } from '../config/defaultSettings';
import { FEATURES, FEATURE_KEYS, enabledFeatures, type FeatureKey } from '../config/features';
import {
  AppSetting,
  AuditLog,
  Camera,
  ClientCredential,
  DetectionEvent,
  Organization,
  PlatformAuditLog,
  RefreshToken,
  RegisteredPerson,
  TenantUserDirectory,
  User,
  sequelize,
} from '../models';
import { createTenantDatabase, dropTenantDatabase, migrateTenantDatabase, syncTenantReferenceData } from '../db/tenantDatabases';
import { AppError } from '../utils/errors';
import { hashPassword } from '../utils/password';
import { disconnectOrg } from '../sockets/emitter';
import { audit } from './audit.service';
import { issueSession } from './auth.service';
import { presentCamera } from './cameras.service';
import { revealClientPassword, storeClientPassword } from './clientCredentials.service';
import { stopTenantStreams } from './ingestion.service';
import { platformAudit } from './platformAuth.service';
import { roleById, roleByName } from './rbac.service';
import { reloadSettings } from './settings.service';
import { invalidateTenant, isEmailTaken, runInTenant } from './tenancy.service';
import type { PlatformAdminContext } from '../types/auth';

interface Actor {
  admin: PlatformAdminContext;
  ip: string | null;
  userAgent?: string | null;
}

export interface RegisterOrganizationInput {
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  features: string[];
  detectionRetentionDays: number;
  admin: { name: string; email: string; password?: string };
}

export interface UpdateOrganizationInput {
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  features?: string[];
  detectionRetentionDays?: number;
}

const PASSWORD_SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*?-_'];

/** Strong random password that always satisfies PASSWORD_POLICY. */
export function generatePassword(length = 16): string {
  const all = PASSWORD_SETS.join('');
  const chars = PASSWORD_SETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** "Acme Security Ltd." -> slug "acme_security_ltd_3f9a1c", database "<prefix>acme_security_ltd_3f9a1c". */
function databaseIdentity(name: string) {
  const suffix = randomBytes(3).toString('hex');
  const room = 64 - env.tenantDbPrefix.length - suffix.length - 1;
  if (room < 1) throw new AppError(500, 'CONFIG_ERROR', 'TENANT_DB_PREFIX is too long');
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, Math.min(room, 32))
      .replace(/_+$/, '') || 'org';
  const slug = `${base}_${suffix}`;
  return { slug, databaseName: `${env.tenantDbPrefix}${slug}` };
}

function normalizeFeatures(keys: string[]): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => keys.includes(k));
}

export function presentOrganization(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    databaseName: org.databaseName ?? null,
    dedicatedDatabase: Boolean(org.databaseName),
    features: [...enabledFeatures(org.features)],
    detectionRetentionDays: org.detectionRetentionDays ?? null,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    holdReason: org.holdReason,
    heldAt: org.heldAt,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

export function featureCatalog() {
  return FEATURE_KEYS.map((key) => ({ key, label: FEATURES[key].label, description: FEATURES[key].description }));
}

async function findOrganization(id: string) {
  const org = await Organization.findByPk(id);
  if (!org) throw AppError.notFound('Organization');
  return org;
}

/** The organization's primary admin: the vault-tracked account, else its oldest super admin. Call inside the tenant context. */
async function primaryAdmin(organizationId: string): Promise<User | null> {
  const cred = await ClientCredential.findByPk(organizationId);
  if (cred) {
    const tracked = await User.findOne({ where: { id: cred.userId, organizationId } });
    if (tracked) return tracked;
  }
  const role = await roleByName('SUPER_ADMIN');
  if (!role) return null;
  return User.findOne({ where: { organizationId, roleId: role.id }, order: [['status', 'ASC'], ['createdAt', 'ASC']] });
}

// ---------------------------------------------------------------------------------------------
// Registration (database-per-organization provisioning)
// ---------------------------------------------------------------------------------------------

/**
 * Registers an organization and provisions its dedicated database:
 *  1. control-plane row (PROVISIONING)        4. settings + primary admin + login directory + vault
 *  2. CREATE DATABASE (+ GRANT to app user)    5. status ACTIVE
 *  3. schema migrations + RBAC reference data
 * Any failure rolls everything back, including dropping the half-built database.
 */
export async function registerOrganization(input: RegisterOrganizationInput, actor: Actor) {
  const email = input.admin.email.toLowerCase();
  if (await isEmailTaken(email)) throw AppError.conflict('This admin email is already used by another account');
  if (await Organization.findOne({ where: { name: input.name } })) throw AppError.conflict('An organization with this name already exists');

  const id = randomUUID();
  const { slug, databaseName } = databaseIdentity(input.name);
  const features = normalizeFeatures(input.features);
  const password = input.admin.password ?? generatePassword();
  const passwordHash = await hashPassword(password);
  const startedAt = Date.now();

  const org = await Organization.create({
    id,
    name: input.name,
    status: 'PROVISIONING',
    slug,
    databaseName,
    features,
    detectionRetentionDays: input.detectionRetentionDays,
    contactName: input.contactName ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    createdByPlatformAdmin: actor.admin.id,
  });

  let databaseCreated = false;
  try {
    await createTenantDatabase(databaseName);
    databaseCreated = true;
    await migrateTenantDatabase(databaseName);
    await syncTenantReferenceData(sequelize, databaseName, { id, name: input.name });
    invalidateTenant(id);

    const role = await roleByName('SUPER_ADMIN');
    if (!role) throw new Error('SUPER_ADMIN role is missing; run the seeders');
    const cap = input.detectionRetentionDays;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.retention.eventDays = Math.min(settings.retention.eventDays, cap);
    settings.retention.evidenceDays = Math.min(settings.retention.evidenceDays, cap);

    const adminUser = await runInTenant(id, () =>
      sequelize.transaction(async (transaction) => {
        await AppSetting.create({ organizationId: id, settings, updatedBy: null }, { transaction });
        const user = await User.create({ name: input.admin.name, email, passwordHash, roleId: role.id, organizationId: id }, { transaction });
        // Control-plane rows share the connection, so they commit atomically with the tenant rows.
        await TenantUserDirectory.create({ email, organizationId: id, userId: user.id }, { transaction });
        await storeClientPassword({ organizationId: id, userId: user.id, email, password, updatedBy: actor.admin.email }, transaction);
        await audit(
          {
            organizationId: id,
            action: 'ORGANIZATION_PROVISIONED',
            entityType: 'organization',
            entityId: id,
            ipAddress: actor.ip,
            metadata: { by: actor.admin.email, database: databaseName, features, detectionRetentionDays: cap, adminEmail: email },
          },
          transaction,
        );
        return user;
      }),
    );

    await org.update({ status: 'ACTIVE' });
    invalidateTenant(id);
    await platformAudit({
      platformAdminId: actor.admin.id,
      organizationId: id,
      action: 'ORGANIZATION_REGISTERED',
      ipAddress: actor.ip,
      metadata: { name: input.name, database: databaseName, features, detectionRetentionDays: cap, adminEmail: email, ms: Date.now() - startedAt },
    });
    logger.info({ organizationId: id, database: databaseName, ms: Date.now() - startedAt }, 'Organization provisioned');

    return {
      organization: presentOrganization(org),
      admin: { id: adminUser.id, name: adminUser.name, email, password, generated: !input.admin.password },
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err, organizationId: id, database: databaseName }, 'Organization provisioning failed; rolling back');
    if (databaseCreated) {
      await dropTenantDatabase(databaseName).catch((e) => logger.error({ err: e, database: databaseName }, 'Could not drop tenant database during rollback'));
    }
    await TenantUserDirectory.destroy({ where: { organizationId: id } }).catch(() => undefined);
    await ClientCredential.destroy({ where: { organizationId: id } }).catch(() => undefined);
    await org.destroy().catch(() => org.update({ status: 'FAILED' }).catch(() => undefined));
    invalidateTenant(id);
    await platformAudit({
      platformAdminId: actor.admin.id,
      organizationId: null,
      action: 'ORGANIZATION_PROVISIONING_FAILED',
      ipAddress: actor.ip,
      metadata: { name: input.name, database: databaseName, error: message.slice(0, 500) },
    }).catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'PROVISIONING_FAILED', `The organization database could not be created: ${message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Clients (read)
// ---------------------------------------------------------------------------------------------

export async function listClients() {
  const orgs = await Organization.findAll({ order: [['createdAt', 'DESC']] });
  const creds = new Map((await ClientCredential.findAll()).map((c) => [c.organizationId, c]));

  return Promise.all(
    orgs.map(async (org) => {
      const base = { ...presentOrganization(org), admin: null as null | { userId: string; name: string; email: string; status: string; lastLoginAt: Date | null }, hasStoredPassword: creds.has(org.id), counts: null as null | Record<string, number> };
      if (org.status === 'PROVISIONING' || org.status === 'FAILED') return base;
      try {
        return await runInTenant(org.id, async () => {
          const admin = await primaryAdmin(org.id);
          const [users, cameras, camerasOnline, persons] = await Promise.all([
            User.count({ where: { organizationId: org.id } }),
            Camera.count({ where: { organizationId: org.id } }),
            Camera.count({ where: { organizationId: org.id, status: 'ONLINE' } }),
            RegisteredPerson.count({ where: { organizationId: org.id } }),
          ]);
          return {
            ...base,
            admin: admin ? { userId: admin.id, name: admin.name, email: admin.email, status: admin.status, lastLoginAt: admin.lastLoginAt } : null,
            counts: { users, cameras, camerasOnline, persons },
          };
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message, organizationId: org.id }, 'Could not read client database');
        return base;
      }
    }),
  );
}

export async function getClient(id: string) {
  const org = await findOrganization(id);
  const cred = await ClientCredential.findByPk(id);
  const detail = {
    organization: presentOrganization(org),
    credentials: cred ? { userId: cred.userId, email: cred.email, updatedBy: cred.updatedBy, updatedAt: cred.updatedAt } : null,
    admin: null as null | { userId: string; name: string; email: string; status: string; lastLoginAt: Date | null; lockedUntil: Date | null },
    users: [] as unknown[],
    cameras: [] as unknown[],
    stats: null as null | Record<string, unknown>,
    recentActivity: [] as unknown[],
  };
  if (org.status === 'PROVISIONING' || org.status === 'FAILED') return detail;

  return runInTenant(id, async () => {
    const admin = await primaryAdmin(id);
    const users = await User.findAll({ where: { organizationId: id }, order: [['createdAt', 'ASC']] });
    const roles = new Map<number, string>();
    for (const u of users) if (!roles.has(u.roleId)) roles.set(u.roleId, (await roleById(u.roleId))?.name ?? 'UNKNOWN');
    const cameras = await Camera.findAll({ where: { organizationId: id }, order: [['cameraName', 'ASC']] });
    const since = new Date(Date.now() - 86400_000);
    const [persons, eventsTotal, events24h, unknown24h, oldest, newest] = await Promise.all([
      RegisteredPerson.count({ where: { organizationId: id } }),
      DetectionEvent.count({ where: { organizationId: id } }),
      DetectionEvent.count({ where: { organizationId: id, eventTimestamp: { [Op.gte]: since } } }),
      DetectionEvent.count({ where: { organizationId: id, eventTimestamp: { [Op.gte]: since }, eventType: { [Op.in]: ['UNKNOWN', 'UNCERTAIN'] } } }),
      DetectionEvent.min<Date, DetectionEvent>('eventTimestamp', { where: { organizationId: id } }),
      DetectionEvent.max<Date, DetectionEvent>('eventTimestamp', { where: { organizationId: id } }),
    ]);
    const activity = await AuditLog.findAll({
      where: { organizationId: id, action: { [Op.in]: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'LOGOUT', 'IMPERSONATION_STARTED', 'PASSWORD_RESET_BY_PLATFORM', 'PASSWORD_RESET_COMPLETED'] } },
      order: [['createdAt', 'DESC']],
      limit: 25,
    });
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    return {
      ...detail,
      admin: admin ? { userId: admin.id, name: admin.name, email: admin.email, status: admin.status, lastLoginAt: admin.lastLoginAt, lockedUntil: admin.lockedUntil } : null,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: roles.get(u.roleId),
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        lockedUntil: u.lockedUntil,
        isPrimaryAdmin: admin?.id === u.id,
        createdAt: u.createdAt,
      })),
      cameras: cameras.map(presentCamera),
      stats: {
        users: users.length,
        cameras: cameras.length,
        camerasOnline: cameras.filter((c) => c.status === 'ONLINE').length,
        persons,
        eventsTotal,
        events24h,
        unknown24h,
        oldestEventAt: oldest ?? null,
        newestEventAt: newest ?? null,
      },
      recentActivity: activity.map((a) => ({
        id: a.id,
        action: a.action,
        userEmail: a.userId ? (emailById.get(a.userId) ?? null) : null,
        ipAddress: a.ipAddress,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Plan changes and hold
// ---------------------------------------------------------------------------------------------

export async function updateOrganization(id: string, input: UpdateOrganizationInput, actor: Actor) {
  const org = await findOrganization(id);
  if (org.status === 'PROVISIONING') throw AppError.conflict('The organization is still being provisioned');
  if (input.name && input.name !== org.name && (await Organization.findOne({ where: { name: input.name, id: { [Op.ne]: id } } }))) {
    throw AppError.conflict('An organization with this name already exists');
  }
  const changes: Partial<Organization> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.contactName !== undefined) changes.contactName = input.contactName;
  if (input.contactEmail !== undefined) changes.contactEmail = input.contactEmail;
  if (input.contactPhone !== undefined) changes.contactPhone = input.contactPhone;
  if (input.features !== undefined) changes.features = normalizeFeatures(input.features);
  if (input.detectionRetentionDays !== undefined) changes.detectionRetentionDays = input.detectionRetentionDays;

  const before = { features: [...enabledFeatures(org.features)], detectionRetentionDays: org.detectionRetentionDays, name: org.name };
  await org.update(changes);
  invalidateTenant(id);

  await runInTenant(id, async () => {
    if (changes.name && org.databaseName) {
      await syncTenantReferenceData(sequelize, org.databaseName, { id, name: org.name });
    }
    // Pushes the new effective policy (evidence / alerts / retention) to running streams.
    await reloadSettings(id);
    await audit({ organizationId: id, action: 'ORGANIZATION_PLAN_UPDATED', entityType: 'organization', entityId: id, ipAddress: actor.ip, metadata: { by: actor.admin.email, before, changes } });
  });
  await platformAudit({ platformAdminId: actor.admin.id, organizationId: id, action: 'ORGANIZATION_UPDATED', ipAddress: actor.ip, metadata: { before, changes } });
  return presentOrganization(org);
}

export async function setHold(id: string, input: { onHold: boolean; reason?: string | null }, actor: Actor) {
  const org = await findOrganization(id);
  if (org.status === 'PROVISIONING' || org.status === 'FAILED') throw AppError.conflict('Only active organizations can be put on hold');
  if (input.onHold === (org.status === 'SUSPENDED')) return presentOrganization(org);

  if (input.onHold) {
    await org.update({ status: 'SUSPENDED', holdReason: input.reason?.trim() || null, heldAt: new Date() });
  } else {
    await org.update({ status: 'ACTIVE', holdReason: null, heldAt: null });
  }
  invalidateTenant(id);

  await runInTenant(id, async () => {
    if (input.onHold) {
      await RefreshToken.update({ revokedAt: new Date() }, { where: { revokedAt: null, impersonatedBy: null } });
      await stopTenantStreams('Organization on hold');
    }
    await audit({
      organizationId: id,
      action: input.onHold ? 'ORGANIZATION_HELD' : 'ORGANIZATION_REACTIVATED',
      entityType: 'organization',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { by: actor.admin.email, reason: input.reason ?? null },
    });
  });
  if (input.onHold) disconnectOrg(id);
  await platformAudit({
    platformAdminId: actor.admin.id,
    organizationId: id,
    action: input.onHold ? 'ORGANIZATION_HELD' : 'ORGANIZATION_REACTIVATED',
    ipAddress: actor.ip,
    metadata: { reason: input.reason ?? null },
  });
  return presentOrganization(org);
}

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

export async function revealPassword(id: string, actor: Actor) {
  const org = await findOrganization(id);
  const secret = await revealClientPassword(id);
  if (!secret) throw new AppError(404, 'NO_STORED_PASSWORD', 'No stored password for this client. Reset the password to set a new one.');
  await platformAudit({ platformAdminId: actor.admin.id, organizationId: id, action: 'CLIENT_PASSWORD_VIEWED', ipAddress: actor.ip, metadata: { email: secret.email } });
  await runInTenant(org.id, () =>
    audit({ organizationId: id, userId: secret.userId, action: 'PASSWORD_VIEWED_BY_PLATFORM', entityType: 'user', entityId: secret.userId, ipAddress: actor.ip, metadata: { by: actor.admin.email } }),
  );
  return { email: secret.email, password: secret.password, updatedAt: secret.updatedAt };
}

export async function resetClientPassword(id: string, input: { password?: string }, actor: Actor) {
  const org = await findOrganization(id);
  if (org.status === 'PROVISIONING' || org.status === 'FAILED') throw AppError.conflict('The organization is not provisioned');
  const password = input.password ?? generatePassword();
  const passwordHash = await hashPassword(password);

  const user = await runInTenant(id, async () => {
    const admin = await primaryAdmin(id);
    if (!admin) throw AppError.notFound('Organization admin account');
    await sequelize.transaction(async (transaction) => {
      await User.update({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' }, { where: { id: admin.id }, transaction });
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: admin.id, revokedAt: null }, transaction });
      await storeClientPassword({ organizationId: id, userId: admin.id, email: admin.email, password, updatedBy: actor.admin.email }, transaction);
      await audit(
        { organizationId: id, userId: admin.id, action: 'PASSWORD_RESET_BY_PLATFORM', entityType: 'user', entityId: admin.id, ipAddress: actor.ip, metadata: { by: actor.admin.email } },
        transaction,
      );
    });
    return admin;
  });
  await platformAudit({ platformAdminId: actor.admin.id, organizationId: id, action: 'CLIENT_PASSWORD_RESET', ipAddress: actor.ip, metadata: { email: user.email, generated: !input.password } });
  return { email: user.email, password, generated: !input.password };
}

// ---------------------------------------------------------------------------------------------
// "View as" (impersonation)
// ---------------------------------------------------------------------------------------------

/**
 * Opens an organization console session as one of its users (default: the primary admin). The session
 * is marked with the platform admin's email: it shows a banner, every action it performs is audited
 * with `impersonatedBy`, and it keeps working while the organization is on hold.
 */
export async function impersonate(id: string, input: { userId?: string }, actor: Actor) {
  const org = await findOrganization(id);
  if (org.status !== 'ACTIVE' && org.status !== 'SUSPENDED') throw AppError.conflict('The organization is not provisioned');

  const result = await runInTenant(
    id,
    async () => {
      const user = input.userId ? await User.findOne({ where: { id: input.userId, organizationId: id } }) : await primaryAdmin(id);
      if (!user) throw AppError.notFound('User');
      if (user.status !== 'ACTIVE') throw AppError.conflict('This user account is disabled');
      const tokens = await issueSession(user, { ip: actor.ip, userAgent: actor.userAgent ?? null }, actor.admin.email);
      await audit({ organizationId: id, userId: user.id, action: 'IMPERSONATION_STARTED', entityType: 'user', entityId: user.id, ipAddress: actor.ip, metadata: { by: actor.admin.email } });
      return { tokens, user: { id: user.id, name: user.name, email: user.email } };
    },
    { impersonatedBy: actor.admin.email },
  );
  await platformAudit({ platformAdminId: actor.admin.id, organizationId: id, action: 'CLIENT_IMPERSONATED', ipAddress: actor.ip, metadata: { userId: result.user.id, email: result.user.email } });
  return result;
}

export async function listPlatformAudit(opts: { organizationId?: string; limit: number }) {
  const rows = await PlatformAuditLog.findAll({
    where: opts.organizationId ? { organizationId: opts.organizationId } : {},
    order: [['createdAt', 'DESC']],
    limit: opts.limit,
  });
  return rows.map((r) => r.get({ plain: true }));
}

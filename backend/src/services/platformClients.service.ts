import { randomBytes, randomUUID } from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { DEFAULT_SETTINGS } from '../config/defaultSettings';
import { FEATURE_KEYS, enabledFeatures, featureCatalog as catalog, type FeatureKey } from '../config/features';
import { PLANS, isPlanCode, planCatalog, planSelectionErrors, type PlanCode } from '../config/plans';
import { isAllowedCapacity, isOrganizationType, organizationTypeCatalog, organizationTypeOf, type OrganizationTypeCode } from '../config/organizationTypes';
import {
  AppSetting,
  AuditLog,
  Camera,
  ClientCredential,
  DetectionEvent,
  Organization,
  OrganizationHold,
  PasswordResetRequest,
  PasswordResetToken,
  PlatformAdmin,
  PlatformAuditLog,
  ProvisioningJob,
  RefreshToken,
  RegisteredPerson,
  RetentionCleanupRun,
  TenantUserDirectory,
  User,
  sequelize,
} from '../models';
import { createTenantDatabase, dropTenantDatabase, migrateTenantDatabase, syncTenantReferenceData } from '../db/tenantDatabases';
import { AppError } from '../utils/errors';
import { randomToken, sha256 } from '../utils/crypto';
import { hashPassword, verifyPassword } from '../utils/password';
import { disconnectOrg } from '../sockets/emitter';
import { pageMeta } from '../utils/http';
import { actionBlocksAccess, canRetryProvisioning, holdPausesCleanup, impersonationAllowed, statusForAction, type AccountAction, type HoldPolicy } from '../utils/accountPolicy';
import { nextRetentionRun, retentionCutoff, type RetentionMode } from '../utils/retentionPolicy';
import { audit } from './audit.service';
import { issueSession } from './auth.service';
import { presentCamera } from './cameras.service';
import { rememberClientAdmin } from './clientCredentials.service';
import { emailConfigured, escapeHtml, sendEmail } from './email.service';
import { stopTenantStreams } from './ingestion.service';
import { assertProfileChange } from './premises.service';
import { platformAudit } from './platformAuth.service';
import { roleById, roleByName } from './rbac.service';
import { organizationStorageBytes } from './storageUsage.service';
import { reloadSettings } from './settings.service';
import { invalidateTenant, isEmailTaken, runInTenant } from './tenancy.service';
import type { PlatformAdminContext } from '../types/auth';
import type { OrganizationStatus } from '../models/Organization';

interface Actor {
  admin: PlatformAdminContext;
  ip: string | null;
  userAgent?: string | null;
}

export interface RegisterOrganizationInput {
  name: string;
  code: string;
  contactName?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  timezone: string;
  subscriptionPlan: PlanCode;
  features: string[];
  detectionRetentionDays: number;
  retentionGraceDays: number;
  retentionMode: RetentionMode;
  cameraLimit?: number | null;
  storageLimitBytes?: number | null;
  organizationType: OrganizationTypeCode;
  capacity: number;
  admin: { name: string; email: string };
}

export interface UpdateOrganizationInput {
  name?: string;
  code?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  timezone?: string;
  subscriptionPlan?: PlanCode;
  features?: string[];
  detectionRetentionDays?: number;
  retentionGraceDays?: number;
  retentionMode?: RetentionMode;
  cameraLimit?: number | null;
  storageLimitBytes?: number | null;
  organizationType?: OrganizationTypeCode;
  capacity?: number;
}

const RESET_MINUTES = 30;

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
  return FEATURE_KEYS.filter((key) => keys.includes(key));
}

function assertSelection(plan: PlanCode, input: { features: string[]; detectionRetentionDays: number; cameraLimit: number | null; storageLimitBytes: number | null }) {
  const errors = planSelectionErrors(plan, {
    features: input.features,
    retentionDays: input.detectionRetentionDays,
    cameraLimit: input.cameraLimit,
    storageLimitBytes: input.storageLimitBytes,
  });
  if (errors.length) throw AppError.validation(errors.map((message) => ({ path: 'plan', message })));
}

export function presentOrganization(org: Organization) {
  const kind = organizationTypeOf(org.organizationType);
  return {
    id: org.id,
    name: org.name,
    code: org.code,
    slug: org.slug,
    status: org.status,
    databaseName: org.databaseName ?? null,
    dedicatedDatabase: Boolean(org.databaseName),
    features: [...enabledFeatures(org.features)],
    detectionRetentionDays: org.detectionRetentionDays ?? null,
    retentionGraceDays: org.retentionGraceDays ?? 0,
    retentionMode: org.retentionMode ?? 'ENFORCE',
    timezone: org.timezone || 'UTC',
    subscriptionPlan: org.subscriptionPlan,
    cameraLimit: org.cameraLimit ?? null,
    storageLimitBytes: org.storageLimitBytes ?? null,
    organizationType: kind.code,
    organizationTypeLabel: kind.label,
    capacity: org.capacity ?? null,
    capacityUnit: kind.capacityUnit,
    capacityLabel: kind.capacityLabel,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    holdReason: org.holdReason,
    heldAt: org.heldAt,
    provisioningError: org.provisioningError,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

export function featureCatalog() {
  return catalog();
}

export function subscriptionPlans() {
  return planCatalog();
}

export function organizationTypes() {
  return organizationTypeCatalog();
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

const READABLE: ReadonlySet<OrganizationStatus> = new Set(['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED']);

function like(value: string) {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function limitsFor(input: { subscriptionPlan: PlanCode; cameraLimit?: number | null; storageLimitBytes?: number | null }) {
  const plan = PLANS[input.subscriptionPlan];
  return {
    cameraLimit: input.cameraLimit === undefined ? plan.cameraLimit : input.cameraLimit,
    storageLimitBytes: input.storageLimitBytes === undefined ? plan.storageLimitBytes : input.storageLimitBytes,
  };
}

async function assertUnique(input: { name: string; code: string; contactEmail: string; adminEmail: string }, ignoreId?: string) {
  const exclude = ignoreId ? { id: { [Op.ne]: ignoreId } } : {};
  if (await isEmailTaken(input.adminEmail)) throw AppError.conflict('This admin email is already used by another account');
  if (await Organization.findOne({ where: { name: input.name, ...exclude } })) throw AppError.conflict('An organization with this name already exists');
  if (await Organization.findOne({ where: { code: input.code, ...exclude } })) throw AppError.conflict('This organization code is already in use');
  if (await Organization.findOne({ where: { contactEmail: input.contactEmail, ...exclude } })) throw AppError.conflict('This organization email is already in use');
}

function presentPlatformCamera(camera: Camera) {
  const view = presentCamera(camera);
  return {
    id: view.id,
    cameraName: view.cameraName,
    cameraType: view.cameraType,
    location: view.location,
    site: view.site,
    status: view.status,
    isActive: view.isActive,
    monitoringEnabled: view.monitoringEnabled,
    withinSchedule: view.withinSchedule,
    lastError: view.lastError,
    lastConnectedAt: view.lastConnectedAt,
    streamConfigured: Boolean(camera.streamReference),
    connection: view.status === 'ONLINE' ? 'connected' : view.status === 'ERROR' ? 'reconnecting' : 'unavailable',
  };
}

export interface SetupLink {
  email: string;
  emailed: boolean;
  expiresAt: string;
  /** Returned once, and only when email could not be sent. Never written to the audit log. */
  setupLink: string | null;
}

async function issueAdminSetupLink(org: Organization, user: User, actor: Actor): Promise<SetupLink> {
  const secret = `${org.id}.${randomToken(32)}`;
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
  const tokenHash = sha256(secret);
  await PasswordResetRequest.update({ usedAt: new Date() }, { where: { subjectId: user.id, kind: 'ORGANIZATION_ADMIN', usedAt: null } });
  await runInTenant(org.id, async () => {
    await PasswordResetToken.update({ usedAt: new Date() }, { where: { userId: user.id, usedAt: null } });
    await PasswordResetToken.create({ userId: user.id, tokenHash, expiresAt });
    await audit({
      organizationId: org.id,
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: actor.ip,
      metadata: { by: actor.admin.email },
    });
  });
  await PasswordResetRequest.create({
    kind: 'ORGANIZATION_ADMIN',
    subjectId: user.id,
    organizationId: org.id,
    email: user.email,
    tokenHash,
    expiresAt,
    requestedBy: actor.admin.id,
    ipAddress: actor.ip,
  });
  const link = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(secret)}`;
  let emailed = false;
  if (emailConfigured()) {
    try {
      await sendEmail(
        user.email,
        'Set your VITA EYE password',
        `A platform administrator asked you to set a password for ${org.name}.\n\nThis link works once and expires in ${RESET_MINUTES} minutes:\n${link}\n\nIf you were not expecting this, contact VITA Systems.`,
        `<p>A platform administrator asked you to set a password for ${escapeHtml(org.name)}.</p><p><a href="${escapeHtml(link)}">Set your password</a> (one use, ${RESET_MINUTES} minutes).</p>`,
      );
      emailed = true;
    } catch (err) {
      logger.error({ err: (err as Error).message, organizationId: org.id }, 'Failed to send organization setup email');
    }
  }
  await platformAudit({
    platformAdminId: actor.admin.id,
    organizationId: org.id,
    action: 'CLIENT_SETUP_LINK_ISSUED',
    ipAddress: actor.ip,
    metadata: { email: user.email, emailed },
  });
  return { email: user.email, emailed, expiresAt: expiresAt.toISOString(), setupLink: emailed ? null : link };
}

async function saveSubscription(org: Organization) {
  if (!org.subscriptionPlan || !isPlanCode(org.subscriptionPlan)) return;
  await sequelize.query(
    `INSERT INTO organization_subscriptions (organization_id, plan_code, camera_limit, storage_limit_bytes)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code), camera_limit = VALUES(camera_limit), storage_limit_bytes = VALUES(storage_limit_bytes), updated_at = CURRENT_TIMESTAMP(3)`,
    { replacements: [org.id, org.subscriptionPlan, org.cameraLimit, org.storageLimitBytes] },
  );
}

async function provision(org: Organization, admin: { name: string; email: string; passwordHash: string }, actor: Actor, retry: boolean) {
  const id = org.id;
  const databaseName = org.databaseName;
  if (!databaseName) throw new AppError(500, 'PROVISIONING_FAILED', 'Organization has no database name');
  const attempt = (await ProvisioningJob.count({ where: { organizationId: id } })) + 1;
  const job = await ProvisioningJob.create({ organizationId: id, status: 'RUNNING', attempt, databaseName, startedAt: new Date() });
  let databaseCreated = false;
  try {
    if (retry) await dropTenantDatabase(databaseName);
    await createTenantDatabase(databaseName);
    databaseCreated = true;
    await migrateTenantDatabase(databaseName);
    await syncTenantReferenceData(sequelize, databaseName, { id, name: org.name });
    invalidateTenant(id);

    const role = await roleByName('SUPER_ADMIN');
    if (!role) throw new Error('SUPER_ADMIN role is missing; run the seeders');
    const cap = org.detectionRetentionDays ?? DEFAULT_SETTINGS.retention.eventDays;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.retention.eventDays = Math.min(settings.retention.eventDays, cap);
    settings.retention.evidenceDays = Math.min(settings.retention.evidenceDays, cap);

    const adminUser = await runInTenant(id, () =>
      sequelize.transaction(async (transaction) => {
        await AppSetting.create({ organizationId: id, settings, updatedBy: null }, { transaction });
        const user = await User.create({ name: admin.name, email: admin.email, passwordHash: admin.passwordHash, roleId: role.id, organizationId: id }, { transaction });
        await TenantUserDirectory.create({ email: admin.email, organizationId: id, userId: user.id }, { transaction });
        await rememberClientAdmin({ organizationId: id, userId: user.id, email: admin.email, updatedBy: actor.admin.email }, transaction);
        await audit(
          {
            organizationId: id,
            action: 'ORGANIZATION_PROVISIONED',
            entityType: 'organization',
            entityId: id,
            ipAddress: actor.ip,
            metadata: { by: actor.admin.email, database: databaseName },
          },
          transaction,
        );
        return user;
      }),
    );

    await org.update({ status: 'ACTIVE', provisioningError: null, pendingPasswordHash: null });
    await saveSubscription(org);
    invalidateTenant(id);
    await job.update({ status: 'SUCCEEDED', finishedAt: new Date() });
    let setup: SetupLink;
    try {
      setup = await issueAdminSetupLink(org, adminUser, actor);
    } catch (err) {
      logger.error({ err, organizationId: id }, 'Organization is active but the setup link could not be issued');
      setup = { email: admin.email, emailed: false, expiresAt: new Date().toISOString(), setupLink: null };
    }
    await platformAudit({
      platformAdminId: actor.admin.id,
      organizationId: id,
      action: retry ? 'ORGANIZATION_PROVISION_RETRIED' : 'ORGANIZATION_REGISTERED',
      ipAddress: actor.ip,
      metadata: { name: org.name, database: databaseName, attempt },
    });
    logger.info({ organizationId: id, database: databaseName, attempt }, 'Organization provisioned');
    return { organization: presentOrganization(await org.reload()), admin: { id: adminUser.id, name: adminUser.name, email: adminUser.email }, setup };
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err, organizationId: id, database: databaseName }, 'Organization provisioning failed');
    if (databaseCreated) {
      await dropTenantDatabase(databaseName).catch((dropErr) => logger.error({ err: dropErr, database: databaseName }, 'Could not drop tenant database during rollback'));
    }
    await TenantUserDirectory.destroy({ where: { organizationId: id } }).catch(() => undefined);
    await ClientCredential.destroy({ where: { organizationId: id } }).catch(() => undefined);
    await org.update({ status: 'FAILED', provisioningError: message.slice(0, 500) });
    await job.update({ status: 'FAILED', error: message.slice(0, 500), finishedAt: new Date() });
    invalidateTenant(id);
    await platformAudit({
      platformAdminId: actor.admin.id,
      organizationId: id,
      action: 'ORGANIZATION_PROVISIONING_FAILED',
      ipAddress: actor.ip,
      metadata: { name: org.name, database: databaseName, error: message.slice(0, 500), attempt },
    }).catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'PROVISIONING_FAILED', `The organization database could not be created: ${message}`, { organizationId: id });
  }
}

export async function registerOrganization(input: RegisterOrganizationInput, actor: Actor) {
  const email = input.admin.email.toLowerCase();
  const code = input.code.toLowerCase();
  const contactEmail = input.contactEmail.toLowerCase();
  await assertUnique({ name: input.name, code, contactEmail, adminEmail: email });
  const limits = limitsFor(input);
  assertSelection(input.subscriptionPlan, {
    features: input.features,
    detectionRetentionDays: input.detectionRetentionDays,
    cameraLimit: limits.cameraLimit,
    storageLimitBytes: limits.storageLimitBytes,
  });
  const passwordHash = await hashPassword(randomToken(24));
  const { slug, databaseName } = databaseIdentity(input.name);
  const org = await Organization.create({
    id: randomUUID(),
    name: input.name,
    code,
    status: 'PROVISIONING',
    slug,
    databaseName,
    features: normalizeFeatures(input.features),
    detectionRetentionDays: input.detectionRetentionDays,
    retentionGraceDays: input.retentionGraceDays,
    retentionMode: input.retentionMode,
    timezone: input.timezone,
    subscriptionPlan: input.subscriptionPlan,
    cameraLimit: limits.cameraLimit,
    storageLimitBytes: limits.storageLimitBytes,
    contactName: input.contactName ?? null,
    contactEmail,
    contactPhone: input.contactPhone ?? null,
    organizationType: input.organizationType,
    capacity: input.capacity,
    createdByPlatformAdmin: actor.admin.id,
    pendingAdminName: input.admin.name,
    pendingAdminEmail: email,
    pendingPasswordHash: passwordHash,
  });
  return provision(org, { name: input.admin.name, email, passwordHash }, actor, false);
}

export async function retryProvisioning(id: string, actor: Actor) {
  const org = await Organization.scope('withPendingSecret').findByPk(id);
  if (!org) throw AppError.notFound('Organization');
  if (!canRetryProvisioning(org.status)) throw AppError.conflict('Only a failed provisioning attempt can be retried');
  if (!org.pendingPasswordHash || !org.pendingAdminEmail || !org.pendingAdminName || !org.databaseName) {
    throw AppError.conflict('This failed registration has no saved administrator record. Register the organization again.');
  }
  await org.update({ status: 'PROVISIONING', provisioningError: null });
  return provision(org, { name: org.pendingAdminName, email: org.pendingAdminEmail, passwordHash: org.pendingPasswordHash }, actor, true);
}

async function hydrateClient(org: Organization) {
  const base = {
    ...presentOrganization(org),
    admin: null as null | { userId: string; name: string; email: string; status: string; lastLoginAt: Date | null },
    counts: null as null | { users: number; cameras: number; camerasOnline: number; camerasOffline: number; persons: number; events: number },
    storageUsedBytes: null as number | null,
    approachingLimit: false,
    activeHold: false,
  };
  base.activeHold = (await OrganizationHold.count({ where: { organizationId: org.id, active: true } })) > 0;
  if (!READABLE.has(org.status)) return base;
  try {
    const usage = await organizationStorageBytes(org.id);
    const detail = await runInTenant(org.id, async () => {
      const admin = await primaryAdmin(org.id);
      const [users, cameras, camerasOnline, persons, events] = await Promise.all([
        User.count({ where: { organizationId: org.id } }),
        Camera.count({ where: { organizationId: org.id } }),
        Camera.count({ where: { organizationId: org.id, status: 'ONLINE' } }),
        RegisteredPerson.count({ where: { organizationId: org.id } }),
        DetectionEvent.count({ where: { organizationId: org.id } }),
      ]);
      return { admin, users, cameras, camerasOnline, persons, events };
    });
    const storagePressure = org.storageLimitBytes != null && org.storageLimitBytes > 0 && usage / org.storageLimitBytes >= 0.8;
    const cameraPressure = org.cameraLimit != null && org.cameraLimit > 0 && detail.cameras / org.cameraLimit >= 0.8;
    return {
      ...base,
      admin: detail.admin ? { userId: detail.admin.id, name: detail.admin.name, email: detail.admin.email, status: detail.admin.status, lastLoginAt: detail.admin.lastLoginAt } : null,
      counts: { users: detail.users, cameras: detail.cameras, camerasOnline: detail.camerasOnline, camerasOffline: detail.cameras - detail.camerasOnline, persons: detail.persons, events: detail.events },
      storageUsedBytes: usage,
      approachingLimit: storagePressure || cameraPressure,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, organizationId: org.id }, 'Could not read client database');
    return base;
  }
}

export async function listClients(query: { q?: string; status?: OrganizationStatus; page: number; pageSize: number }) {
  const where: WhereOptions<Organization> = {};
  if (query.status) where.status = query.status;
  if (query.q?.trim()) {
    const term = like(query.q.trim());
    const directory = await TenantUserDirectory.findAll({ where: { email: { [Op.like]: term } }, attributes: ['organizationId'] });
    const ids = directory.map((row) => row.organizationId);
    Object.assign(where, {
      [Op.or]: [
        { name: { [Op.like]: term } },
        { code: { [Op.like]: term } },
        { contactEmail: { [Op.like]: term } },
        { slug: { [Op.like]: term } },
        ...(ids.length ? [{ id: { [Op.in]: ids } }] : []),
      ],
    });
  }
  const total = await Organization.count({ where });
  const orgs = await Organization.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });
  return { rows: await Promise.all(orgs.map(hydrateClient)), meta: pageMeta(query.page, query.pageSize, total) };
}

export async function getClient(id: string) {
  const org = await findOrganization(id);
  const [holds, jobs, cleanup] = await Promise.all([
    OrganizationHold.findAll({ where: { organizationId: id }, order: [['createdAt', 'DESC']], limit: 20 }),
    ProvisioningJob.findAll({ where: { organizationId: id }, order: [['startedAt', 'DESC']], limit: 10 }),
    RetentionCleanupRun.findOne({ where: { organizationId: id }, order: [['finishedAt', 'DESC']] }),
  ]);
  let cutoff: string | null = null;
  if (org.detectionRetentionDays) {
    try {
      cutoff = retentionCutoff(new Date(), org.detectionRetentionDays, org.retentionGraceDays ?? 0, org.timezone || 'UTC').toISOString();
    } catch {
      cutoff = null;
    }
  }
  const detail = {
    organization: presentOrganization(org),
    admin: null as null | { userId: string; name: string; email: string; status: string; lastLoginAt: Date | null; lockedUntil: Date | null },
    users: [] as unknown[],
    cameras: [] as unknown[],
    detections: [] as unknown[],
    stats: null as null | Record<string, unknown>,
    recentActivity: [] as unknown[],
    holds: holds.map((hold) => hold.get({ plain: true })),
    provisioningJobs: jobs.map((job) => job.get({ plain: true })),
    cleanup: cleanup ? cleanup.get({ plain: true }) : null,
    nextCleanupAt: nextRetentionRun().toISOString(),
    retentionCutoff: cutoff,
    storageUsedBytes: READABLE.has(org.status) ? await organizationStorageBytes(id) : null,
  };
  if (!READABLE.has(org.status)) return detail;

  return runInTenant(id, async () => {
    const admin = await primaryAdmin(id);
    const users = await User.findAll({ where: { organizationId: id }, order: [['createdAt', 'ASC']] });
    const roles = new Map<number, string>();
    for (const user of users) if (!roles.has(user.roleId)) roles.set(user.roleId, (await roleById(user.roleId))?.name ?? 'UNKNOWN');
    const cameras = await Camera.findAll({ where: { organizationId: id }, order: [['cameraName', 'ASC']] });
    const since = new Date(Date.now() - 86400_000);
    const [persons, eventsTotal, events24h, unknown24h] = await Promise.all([
      RegisteredPerson.count({ where: { organizationId: id } }),
      DetectionEvent.count({ where: { organizationId: id } }),
      DetectionEvent.count({ where: { organizationId: id, eventTimestamp: { [Op.gte]: since } } }),
      DetectionEvent.count({ where: { organizationId: id, eventTimestamp: { [Op.gte]: since }, eventType: { [Op.in]: ['UNKNOWN', 'UNCERTAIN'] } } }),
    ]);
    const activity = await AuditLog.findAll({ where: { organizationId: id }, order: [['createdAt', 'DESC']], limit: 25 });
    const detections = await DetectionEvent.findAll({
      where: { organizationId: id },
      include: [{ model: Camera, as: 'camera', attributes: ['id', 'cameraName', 'location'], paranoid: false }],
      order: [['eventTimestamp', 'DESC']],
      limit: 8,
    });
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    return {
      ...detail,
      admin: admin ? { userId: admin.id, name: admin.name, email: admin.email, status: admin.status, lastLoginAt: admin.lastLoginAt, lockedUntil: admin.lockedUntil } : null,
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: roles.get(user.roleId),
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        lockedUntil: user.lockedUntil,
        isPrimaryAdmin: admin?.id === user.id,
        createdAt: user.createdAt,
      })),
      cameras: cameras.map(presentPlatformCamera),
      detections: detections.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        reviewStatus: event.reviewStatus,
        eventTimestamp: event.eventTimestamp,
        legalHold: event.legalHold,
        eligibleForDeletion: cutoff ? event.eventTimestamp < new Date(cutoff) && !event.legalHold && event.reviewStatus !== 'INVESTIGATING' : false,
        camera: event.camera ? { id: event.camera.id, name: event.camera.cameraName, location: event.camera.location } : null,
      })),
      stats: {
        users: users.length,
        cameras: cameras.length,
        camerasOnline: cameras.filter((camera) => camera.status === 'ONLINE').length,
        camerasOffline: cameras.filter((camera) => camera.status !== 'ONLINE').length,
        persons,
        eventsTotal,
        events24h,
        unknown24h,
      },
      recentActivity: activity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        userEmail: entry.userId ? (emailById.get(entry.userId) ?? null) : null,
        ipAddress: entry.ipAddress,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
    };
  });
}

export async function listClientDetections(
  id: string,
  query: { page: number; pageSize: number; from?: Date; to?: Date; cameraId?: string; eventType?: string; reviewStatus?: string },
) {
  const org = await findOrganization(id);
  if (!READABLE.has(org.status)) return { rows: [], meta: pageMeta(query.page, query.pageSize, 0) };
  return runInTenant(id, async () => {
    const where: WhereOptions<DetectionEvent> = { organizationId: id };
    if (query.cameraId) where.cameraId = query.cameraId;
    if (query.eventType) where.eventType = query.eventType as DetectionEvent['eventType'];
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus as DetectionEvent['reviewStatus'];
    if (query.from || query.to) {
      where.eventTimestamp = { ...(query.from ? { [Op.gte]: query.from } : {}), ...(query.to ? { [Op.lte]: query.to } : {}) };
    }
    const total = await DetectionEvent.count({ where });
    const rows = await DetectionEvent.findAll({
      where,
      include: [{ model: Camera, as: 'camera', attributes: ['id', 'cameraName', 'location'], paranoid: false }],
      order: [['eventTimestamp', 'DESC']],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    let cutoff: Date | null = null;
    if (org.detectionRetentionDays) {
      try {
        cutoff = retentionCutoff(new Date(), org.detectionRetentionDays, org.retentionGraceDays ?? 0, org.timezone || 'UTC');
      } catch {
        cutoff = null;
      }
    }
    return {
      rows: rows.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        reviewStatus: event.reviewStatus,
        eventTimestamp: event.eventTimestamp,
        legalHold: event.legalHold,
        eligibleForDeletion: Boolean(cutoff && event.eventTimestamp < cutoff && !event.legalHold && event.reviewStatus !== 'INVESTIGATING'),
        camera: event.camera ? { id: event.camera.id, name: event.camera.cameraName, location: event.camera.location } : null,
      })),
      meta: pageMeta(query.page, query.pageSize, total),
    };
  });
}

export async function updateOrganization(id: string, input: UpdateOrganizationInput, actor: Actor) {
  const org = await findOrganization(id);
  if (org.status === 'PROVISIONING') throw AppError.conflict('The organization is still being provisioned');
  if (input.name && input.name !== org.name && (await Organization.findOne({ where: { name: input.name, id: { [Op.ne]: id } } }))) {
    throw AppError.conflict('An organization with this name already exists');
  }
  if (input.code && input.code.toLowerCase() !== org.code && (await Organization.findOne({ where: { code: input.code.toLowerCase(), id: { [Op.ne]: id } } }))) {
    throw AppError.conflict('This organization code is already in use');
  }
  if (input.contactEmail && input.contactEmail.toLowerCase() !== org.contactEmail && (await Organization.findOne({ where: { contactEmail: input.contactEmail.toLowerCase(), id: { [Op.ne]: id } } }))) {
    throw AppError.conflict('This organization email is already in use');
  }
  const touchesPlan = input.subscriptionPlan !== undefined || input.features !== undefined || input.detectionRetentionDays !== undefined || input.cameraLimit !== undefined || input.storageLimitBytes !== undefined;
  if (touchesPlan) {
    const planCode = input.subscriptionPlan ?? (org.subscriptionPlan && isPlanCode(org.subscriptionPlan) ? org.subscriptionPlan : null);
    const features = input.features ?? [...enabledFeatures(org.features)];
    const retentionDays = input.detectionRetentionDays ?? org.detectionRetentionDays ?? 30;
    const cameraLimit = input.cameraLimit !== undefined ? input.cameraLimit : (org.cameraLimit ?? null);
    const storageLimitBytes = input.storageLimitBytes !== undefined ? input.storageLimitBytes : (org.storageLimitBytes ?? null);
    if (planCode) assertSelection(planCode, { features, detectionRetentionDays: retentionDays, cameraLimit, storageLimitBytes });
    else {
      const unsupported = catalog().filter((feature) => !feature.supported && features.includes(feature.key));
      if (unsupported.length) throw AppError.validation(unsupported.map((feature) => ({ path: 'features', message: `${feature.label} is not available in this deployment` })));
    }
  }

  const changes: Partial<Organization> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.code !== undefined) changes.code = input.code.toLowerCase();
  if (input.contactName !== undefined) changes.contactName = input.contactName;
  if (input.contactEmail !== undefined) changes.contactEmail = input.contactEmail ? input.contactEmail.toLowerCase() : null;
  if (input.contactPhone !== undefined) changes.contactPhone = input.contactPhone;
  if (input.timezone !== undefined) changes.timezone = input.timezone;
  if (input.subscriptionPlan !== undefined) changes.subscriptionPlan = input.subscriptionPlan;
  if (input.features !== undefined) changes.features = normalizeFeatures(input.features);
  if (input.detectionRetentionDays !== undefined) changes.detectionRetentionDays = input.detectionRetentionDays;
  if (input.retentionGraceDays !== undefined) changes.retentionGraceDays = input.retentionGraceDays;
  if (input.retentionMode !== undefined) changes.retentionMode = input.retentionMode;
  if (input.cameraLimit !== undefined) changes.cameraLimit = input.cameraLimit;
  if (input.storageLimitBytes !== undefined) changes.storageLimitBytes = input.storageLimitBytes;
  if (input.organizationType !== undefined || input.capacity !== undefined) {
    const nextType = input.organizationType ?? (isOrganizationType(org.organizationType) ? org.organizationType : 'OTHER');
    const nextCapacity = input.capacity !== undefined ? input.capacity : (org.capacity ?? null);
    if (nextCapacity != null && !isAllowedCapacity(nextType, nextCapacity)) {
      throw AppError.validation([{ path: 'capacity', message: 'Choose a capacity listed for this organization type' }]);
    }
    if (READABLE.has(org.status)) await runInTenant(id, () => assertProfileChange(id, nextType, nextCapacity));
    if (input.organizationType !== undefined) changes.organizationType = input.organizationType;
    if (input.capacity !== undefined) changes.capacity = input.capacity;
  }

  const before = presentOrganization(org);
  await org.update(changes);
  if (org.subscriptionPlan) await saveSubscription(org);
  invalidateTenant(id);
  if (READABLE.has(org.status)) {
    await runInTenant(id, async () => {
      if (changes.name && org.databaseName) await syncTenantReferenceData(sequelize, org.databaseName, { id, name: org.name });
      await reloadSettings(id);
      await audit({
        organizationId: id,
        action: 'ORGANIZATION_PLAN_UPDATED',
        entityType: 'organization',
        entityId: id,
        ipAddress: actor.ip,
        metadata: { by: actor.admin.email },
      });
    });
  }
  await platformAudit({ platformAdminId: actor.admin.id, organizationId: id, action: 'ORGANIZATION_UPDATED', ipAddress: actor.ip, metadata: { before: { name: before.name, features: before.features, plan: before.subscriptionPlan } } });
  return presentOrganization(org);
}

export async function setAccountStatus(id: string, input: { action: AccountAction; reason?: string | null; holdType?: HoldPolicy | null }, actor: Actor) {
  const org = await findOrganization(id);
  if (!READABLE.has(org.status)) throw AppError.conflict('Finish provisioning before changing account status');
  const reason = input.reason?.trim() || null;
  if (actionBlocksAccess(input.action) && !reason) throw AppError.validation([{ path: 'reason', message: 'A reason is required' }]);
  const next = statusForAction(input.action);
  const holdType = input.action === 'HOLD' ? (input.holdType ?? 'ACCOUNT') : null;
  await org.update({
    status: next,
    holdReason: actionBlocksAccess(input.action) ? reason : null,
    heldAt: actionBlocksAccess(input.action) ? new Date() : null,
  });
  invalidateTenant(id);
  if ((holdType === 'LEGAL' || holdType === 'INVESTIGATION') && reason) {
    await OrganizationHold.create({ organizationId: id, holdType, reason, active: true, createdBy: actor.admin.id });
  }
  await runInTenant(id, async () => {
    if (actionBlocksAccess(input.action)) {
      await RefreshToken.update({ revokedAt: new Date() }, { where: { revokedAt: null, impersonatedBy: null } });
      await stopTenantStreams('Organization access restricted');
    }
    await audit({
      organizationId: id,
      action: `ORGANIZATION_${input.action}`,
      entityType: 'organization',
      entityId: id,
      ipAddress: actor.ip,
      metadata: { by: actor.admin.email, reason, holdType, pausesCleanup: holdPausesCleanup(holdType) },
    });
  });
  if (actionBlocksAccess(input.action)) disconnectOrg(id);
  await platformAudit({
    platformAdminId: actor.admin.id,
    organizationId: id,
    action: `ORGANIZATION_${input.action}`,
    ipAddress: actor.ip,
    metadata: { reason, holdType, status: next },
  });
  return presentOrganization(org);
}

export async function releaseHold(id: string, holdId: string, actor: Actor) {
  const hold = await OrganizationHold.findOne({ where: { id: holdId, organizationId: id, active: true } });
  if (!hold) throw AppError.notFound('Hold');
  await hold.update({ active: false, releasedBy: actor.admin.id, releasedAt: new Date() });
  await platformAudit({
    platformAdminId: actor.admin.id,
    organizationId: id,
    action: 'LEGAL_HOLD_RELEASED',
    ipAddress: actor.ip,
    metadata: { holdId, holdType: hold.holdType },
  });
  return hold.get({ plain: true });
}

export async function resetClientPassword(id: string, input: { confirmPassword: string }, actor: Actor) {
  const platformAdmin = await PlatformAdmin.scope('withSecrets').findByPk(actor.admin.id);
  if (!platformAdmin || !(await verifyPassword(platformAdmin.passwordHash, input.confirmPassword))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Re-enter your platform password to issue a reset link');
  }
  const org = await findOrganization(id);
  if (!READABLE.has(org.status)) throw AppError.conflict('The organization is not provisioned');
  const user = await runInTenant(id, () => primaryAdmin(id));
  if (!user) throw AppError.notFound('Organization admin account');
  return issueAdminSetupLink(org, user, actor);
}

export async function impersonate(id: string, input: { userId?: string; purpose?: 'CONSOLE' | 'LIVE_PREVIEW' }, actor: Actor) {
  const org = await findOrganization(id);
  if (!impersonationAllowed(org.status)) throw AppError.conflict('The organization is not provisioned');
  const result = await runInTenant(
    id,
    async () => {
      const user = input.userId ? await User.findOne({ where: { id: input.userId, organizationId: id } }) : await primaryAdmin(id);
      if (!user) throw AppError.notFound('User');
      if (user.status !== 'ACTIVE') throw AppError.conflict('This user account is disabled');
      const tokens = await issueSession(user, { ip: actor.ip, userAgent: actor.userAgent ?? null }, actor.admin.email);
      await audit({
        organizationId: id,
        userId: user.id,
        action: input.purpose === 'LIVE_PREVIEW' ? 'LIVE_FEED_ACCESSED' : 'IMPERSONATION_STARTED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: actor.ip,
        metadata: { by: actor.admin.email, purpose: input.purpose ?? 'CONSOLE' },
      });
      return { tokens, user: { id: user.id, name: user.name, email: user.email } };
    },
    { impersonatedBy: actor.admin.email },
  );
  await platformAudit({
    platformAdminId: actor.admin.id,
    organizationId: id,
    action: input.purpose === 'LIVE_PREVIEW' ? 'LIVE_FEED_ACCESSED' : 'CLIENT_IMPERSONATED',
    ipAddress: actor.ip,
    metadata: { userId: result.user.id, email: result.user.email, purpose: input.purpose ?? 'CONSOLE' },
  });
  return result;
}

export async function listPlatformAudit(opts: { organizationId?: string; limit: number; page?: number }) {
  const page = opts.page ?? 1;
  const where = opts.organizationId ? { organizationId: opts.organizationId } : {};
  const total = await PlatformAuditLog.count({ where });
  const rows = await PlatformAuditLog.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: opts.limit,
    offset: (page - 1) * opts.limit,
  });
  return { rows: rows.map((row) => row.get({ plain: true })), meta: pageMeta(page, opts.limit, total) };
}

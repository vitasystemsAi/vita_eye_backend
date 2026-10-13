import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from '../config/database';

/** Operator of the whole VITA EYE platform (VITA Systems). Not a member of any organization. */
export class PlatformAdmin extends Model<InferAttributes<PlatformAdmin>, InferCreationAttributes<PlatformAdmin>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare status: CreationOptional<'ACTIVE' | 'DISABLED'>;
  declare failedLoginAttempts: CreationOptional<number>;
  declare lockedUntil: CreationOptional<Date | null>;
  declare lastLoginAt: CreationOptional<Date | null>;
  /** Incremented on logout / password change; invalidates every issued platform session. */
  declare tokenVersion: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PlatformAdmin.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
    failedLoginAttempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    lockedUntil: { type: DataTypes.DATE(3), allowNull: true },
    lastLoginAt: { type: DataTypes.DATE(3), allowNull: true },
    tokenVersion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'platform_admins',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withSecrets: { attributes: { include: ['passwordHash'] } } },
  },
);

/** Global email -> organization index for users stored in dedicated tenant databases. */
export class TenantUserDirectory extends Model<InferAttributes<TenantUserDirectory>, InferCreationAttributes<TenantUserDirectory>> {
  declare email: string;
  declare organizationId: string;
  declare userId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

TenantUserDirectory.init(
  {
    email: { type: DataTypes.STRING(255), primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'tenant_user_directory' },
);

/**
 * Directory row for an organization's primary administrator. Passwords are not stored here.
 * `encryptedPassword` remains only so older rows can be nulled; it is never read back.
 */
export class ClientCredential extends Model<InferAttributes<ClientCredential>, InferCreationAttributes<ClientCredential>> {
  declare organizationId: string;
  declare userId: string;
  declare email: string;
  declare encryptedPassword: string | null;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ClientCredential.init(
  {
    organizationId: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    encryptedPassword: { type: DataTypes.TEXT, allowNull: true },
    updatedBy: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'client_credentials',
    defaultScope: { attributes: { exclude: ['encryptedPassword'] } },
    scopes: { withSecret: { attributes: { include: ['encryptedPassword'] } } },
  },
);

export class PlatformAuditLog extends Model<InferAttributes<PlatformAuditLog>, InferCreationAttributes<PlatformAuditLog>> {
  declare id: CreationOptional<number>;
  declare platformAdminId: string | null;
  declare organizationId: string | null;
  declare action: string;
  declare ipAddress: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
}

PlatformAuditLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    platformAdminId: { type: DataTypes.UUID, allowNull: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'platform_audit_logs', updatedAt: false },
);

export type ProvisioningJobStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export class ProvisioningJob extends Model<InferAttributes<ProvisioningJob>, InferCreationAttributes<ProvisioningJob>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare status: CreationOptional<ProvisioningJobStatus>;
  declare attempt: CreationOptional<number>;
  declare databaseName: string;
  declare error: CreationOptional<string | null>;
  declare startedAt: CreationOptional<Date>;
  declare finishedAt: CreationOptional<Date | null>;
}

ProvisioningJob.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.ENUM('RUNNING', 'SUCCEEDED', 'FAILED'), allowNull: false, defaultValue: 'RUNNING' },
    attempt: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    databaseName: { type: DataTypes.STRING(64), allowNull: false },
    error: { type: DataTypes.STRING(500), allowNull: true },
    startedAt: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
    finishedAt: { type: DataTypes.DATE(3), allowNull: true },
  },
  { sequelize, tableName: 'provisioning_jobs', updatedAt: false, createdAt: false },
);

export type HoldType = 'LEGAL' | 'INVESTIGATION';

/** Pauses destructive retention. Separate from account suspension. */
export class OrganizationHold extends Model<InferAttributes<OrganizationHold>, InferCreationAttributes<OrganizationHold>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare holdType: HoldType;
  declare reason: string;
  declare active: CreationOptional<boolean>;
  declare createdBy: string | null;
  declare releasedBy: CreationOptional<string | null>;
  declare releasedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
}

OrganizationHold.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    holdType: { type: DataTypes.ENUM('LEGAL', 'INVESTIGATION'), allowNull: false },
    reason: { type: DataTypes.STRING(255), allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    releasedBy: { type: DataTypes.UUID, allowNull: true },
    releasedAt: { type: DataTypes.DATE(3), allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'organization_holds', updatedAt: false },
);

export class PasswordResetRequest extends Model<InferAttributes<PasswordResetRequest>, InferCreationAttributes<PasswordResetRequest>> {
  declare id: CreationOptional<string>;
  declare kind: 'PLATFORM_ADMIN' | 'ORGANIZATION_ADMIN';
  declare subjectId: string;
  declare organizationId: string | null;
  declare email: string;
  declare tokenHash: string;
  declare expiresAt: Date;
  declare usedAt: CreationOptional<Date | null>;
  declare requestedBy: string | null;
  declare ipAddress: string | null;
  declare createdAt: CreationOptional<Date>;
}

PasswordResetRequest.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    kind: { type: DataTypes.ENUM('PLATFORM_ADMIN', 'ORGANIZATION_ADMIN'), allowNull: false },
    subjectId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE(3), allowNull: false },
    usedAt: { type: DataTypes.DATE(3), allowNull: true },
    requestedBy: { type: DataTypes.UUID, allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'password_reset_requests',
    updatedAt: false,
    defaultScope: { attributes: { exclude: ['tokenHash'] } },
    scopes: { withHash: { attributes: { include: ['tokenHash'] } } },
  },
);

export type CleanupMode = 'DRY_RUN' | 'ENFORCE' | 'SKIPPED';

export class RetentionCleanupRun extends Model<InferAttributes<RetentionCleanupRun>, InferCreationAttributes<RetentionCleanupRun>> {
  declare id: CreationOptional<number>;
  declare organizationId: string;
  declare mode: CleanupMode;
  declare cutoffAt: Date | null;
  declare processed: CreationOptional<number>;
  declare deleted: CreationOptional<number>;
  declare failed: CreationOptional<number>;
  declare remaining: CreationOptional<number>;
  declare skippedHolds: CreationOptional<number>;
  declare error: CreationOptional<string | null>;
  declare startedAt: Date;
  declare finishedAt: Date;
}

RetentionCleanupRun.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    mode: { type: DataTypes.ENUM('DRY_RUN', 'ENFORCE', 'SKIPPED'), allowNull: false },
    cutoffAt: { type: DataTypes.DATE(3), allowNull: true },
    processed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    deleted: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    failed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    remaining: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    skippedHolds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    error: { type: DataTypes.STRING(500), allowNull: true },
    startedAt: { type: DataTypes.DATE(3), allowNull: false },
    finishedAt: { type: DataTypes.DATE(3), allowNull: false },
  },
  { sequelize, tableName: 'retention_cleanup_runs', timestamps: false },
);

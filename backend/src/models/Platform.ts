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
 * Recoverable copy of each client's primary admin password, encrypted with the data key (AES-256-GCM,
 * AAD bound to organization + user). Only platform admins can reveal it and every reveal is audited.
 */
export class ClientCredential extends Model<InferAttributes<ClientCredential>, InferCreationAttributes<ClientCredential>> {
  declare organizationId: string;
  declare userId: string;
  declare email: string;
  declare encryptedPassword: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ClientCredential.init(
  {
    organizationId: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    encryptedPassword: { type: DataTypes.TEXT, allowNull: false },
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

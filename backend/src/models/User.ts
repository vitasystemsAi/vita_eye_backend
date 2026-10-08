import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { Role } from './Role';
import type { Organization } from './Organization';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare roleId: number;
  declare organizationId: string;
  declare status: CreationOptional<'ACTIVE' | 'DISABLED'>;
  declare siteScope: CreationOptional<string[] | null>;
  declare failedLoginAttempts: CreationOptional<number>;
  declare lockedUntil: CreationOptional<Date | null>;
  declare lastLoginAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare role?: NonAttribute<Role>;
  declare organization?: NonAttribute<Organization>;
}

User.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    roleId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.ENUM('ACTIVE', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
    siteScope: { type: DataTypes.JSON, allowNull: true },
    failedLoginAttempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    lockedUntil: { type: DataTypes.DATE(3), allowNull: true },
    lastLoginAt: { type: DataTypes.DATE(3), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'users',
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withSecrets: { attributes: { include: ['passwordHash'] } } },
  },
);

export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tokenHash: string;
  declare userAgent: string | null;
  declare ipAddress: string | null;
  declare expiresAt: Date;
  declare revokedAt: CreationOptional<Date | null>;
  /** Platform admin (email) who opened this session via "view as"; null for normal sign-ins. */
  declare impersonatedBy: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
}

RefreshToken.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID, allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    expiresAt: { type: DataTypes.DATE(3), allowNull: false },
    revokedAt: { type: DataTypes.DATE(3), allowNull: true },
    impersonatedBy: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'refresh_tokens', updatedAt: false },
);

export class PasswordResetToken extends Model<InferAttributes<PasswordResetToken>, InferCreationAttributes<PasswordResetToken>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare tokenHash: string;
  declare expiresAt: Date;
  declare usedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
}

PasswordResetToken.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID, allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE(3), allowNull: false },
    usedAt: { type: DataTypes.DATE(3), allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'password_reset_tokens', updatedAt: false },
);

export class UserDevice extends Model<InferAttributes<UserDevice>, InferCreationAttributes<UserDevice>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare fcmToken: string;
  declare userAgent: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

UserDevice.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID, allowNull: false },
    fcmToken: { type: DataTypes.STRING(512), allowNull: false, unique: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'user_devices' },
);

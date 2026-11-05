import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import { ORGANIZATION_TYPE_CODES, type OrganizationTypeCode } from '../config/organizationTypes';
import type { RetentionMode } from '../utils/retentionPolicy';

export type OrganizationStatus =
  | 'PROVISIONING'
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'ON_HOLD'
  | 'DEACTIVATED'
  | 'ARCHIVED'
  | 'FAILED';

const STATUSES: OrganizationStatus[] = ['PROVISIONING', 'PENDING', 'ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED', 'FAILED'];

export class Organization extends Model<InferAttributes<Organization>, InferCreationAttributes<Organization>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare status: CreationOptional<OrganizationStatus>;
  declare slug: CreationOptional<string | null>;
  /** Unique organization code chosen at registration. */
  declare code: CreationOptional<string | null>;
  /** Dedicated tenant database; null = data lives in the primary database (legacy / seed org). */
  declare databaseName: CreationOptional<string | null>;
  /** Enabled feature keys; null = all features. */
  declare features: CreationOptional<string[] | null>;
  /** Platform-imposed maximum age of detection history in days; null = no platform limit. */
  declare detectionRetentionDays: CreationOptional<number | null>;
  declare retentionGraceDays: CreationOptional<number>;
  declare retentionMode: CreationOptional<RetentionMode>;
  declare timezone: CreationOptional<string>;
  declare subscriptionPlan: CreationOptional<string | null>;
  declare cameraLimit: CreationOptional<number | null>;
  declare storageLimitBytes: CreationOptional<number | null>;
  declare organizationType: CreationOptional<OrganizationTypeCode>;
  /** Licensed size for the organization type: beds, employees, residents, students or people. */
  declare capacity: CreationOptional<number | null>;
  declare contactName: CreationOptional<string | null>;
  declare contactEmail: CreationOptional<string | null>;
  declare contactPhone: CreationOptional<string | null>;
  declare holdReason: CreationOptional<string | null>;
  declare heldAt: CreationOptional<Date | null>;
  declare createdByPlatformAdmin: CreationOptional<string | null>;
  declare provisioningError: CreationOptional<string | null>;
  /** Kept only until provisioning succeeds, so a failed attempt can be retried without a new organization. */
  declare pendingAdminName: CreationOptional<string | null>;
  declare pendingAdminEmail: CreationOptional<string | null>;
  declare pendingPasswordHash: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Organization.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'ACTIVE' },
    slug: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    code: { type: DataTypes.STRING(32), allowNull: true, unique: true },
    databaseName: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    features: { type: DataTypes.JSON, allowNull: true },
    detectionRetentionDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    retentionGraceDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    retentionMode: { type: DataTypes.ENUM('DRY_RUN', 'ENFORCE'), allowNull: false, defaultValue: 'ENFORCE' },
    timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'UTC' },
    subscriptionPlan: { type: DataTypes.STRING(32), allowNull: true },
    cameraLimit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    storageLimitBytes: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      get() {
        const value = this.getDataValue('storageLimitBytes') as number | string | null;
        return value == null ? null : Number(value);
      },
    },
    organizationType: { type: DataTypes.ENUM(...ORGANIZATION_TYPE_CODES), allowNull: false, defaultValue: 'OTHER' },
    capacity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    contactName: { type: DataTypes.STRING(120), allowNull: true },
    contactEmail: { type: DataTypes.STRING(255), allowNull: true },
    contactPhone: { type: DataTypes.STRING(40), allowNull: true },
    holdReason: { type: DataTypes.STRING(255), allowNull: true },
    heldAt: { type: DataTypes.DATE(3), allowNull: true },
    createdByPlatformAdmin: { type: DataTypes.UUID, allowNull: true },
    provisioningError: { type: DataTypes.STRING(500), allowNull: true },
    pendingAdminName: { type: DataTypes.STRING(120), allowNull: true },
    pendingAdminEmail: { type: DataTypes.STRING(255), allowNull: true },
    pendingPasswordHash: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'organizations',
    defaultScope: { attributes: { exclude: ['pendingPasswordHash'] } },
    scopes: { withPendingSecret: { attributes: { include: ['pendingPasswordHash'] } } },
  },
);

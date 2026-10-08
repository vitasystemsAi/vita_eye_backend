import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type OrganizationStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED';

export class Organization extends Model<InferAttributes<Organization>, InferCreationAttributes<Organization>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare status: CreationOptional<OrganizationStatus>;
  declare slug: CreationOptional<string | null>;
  /** Dedicated tenant database; null = data lives in the primary database (legacy / seed org). */
  declare databaseName: CreationOptional<string | null>;
  /** Enabled feature keys; null = all features. */
  declare features: CreationOptional<string[] | null>;
  /** Platform-imposed maximum age of detection history in days; null = no platform limit. */
  declare detectionRetentionDays: CreationOptional<number | null>;
  declare contactName: CreationOptional<string | null>;
  declare contactEmail: CreationOptional<string | null>;
  declare contactPhone: CreationOptional<string | null>;
  declare holdReason: CreationOptional<string | null>;
  declare heldAt: CreationOptional<Date | null>;
  declare createdByPlatformAdmin: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Organization.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(160), allowNull: false },
    status: { type: DataTypes.ENUM('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED'), allowNull: false, defaultValue: 'ACTIVE' },
    slug: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    databaseName: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    features: { type: DataTypes.JSON, allowNull: true },
    detectionRetentionDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    contactName: { type: DataTypes.STRING(120), allowNull: true },
    contactEmail: { type: DataTypes.STRING(255), allowNull: true },
    contactPhone: { type: DataTypes.STRING(40), allowNull: true },
    holdReason: { type: DataTypes.STRING(255), allowNull: true },
    heldAt: { type: DataTypes.DATE(3), allowNull: true },
    createdByPlatformAdmin: { type: DataTypes.UUID, allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'organizations' },
);

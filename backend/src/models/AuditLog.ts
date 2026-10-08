import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { User } from './User';
import type { AppSettings as AppSettingsShape } from '../config/defaultSettings';

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<number>;
  declare organizationId: string | null;
  declare userId: string | null;
  declare action: string;
  declare entityType: string | null;
  declare entityId: string | null;
  declare ipAddress: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
  declare user?: NonAttribute<User>;
}

AuditLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    entityType: { type: DataTypes.STRING(64), allowNull: true },
    entityId: { type: DataTypes.STRING(64), allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'audit_logs', updatedAt: false },
);

export class AppSetting extends Model<InferAttributes<AppSetting>, InferCreationAttributes<AppSetting>> {
  declare organizationId: string;
  declare settings: AppSettingsShape;
  declare updatedBy: string | null;
  declare updatedAt: CreationOptional<Date>;
}

AppSetting.init(
  {
    organizationId: { type: DataTypes.UUID, primaryKey: true },
    settings: { type: DataTypes.JSON, allowNull: false },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'app_settings', createdAt: false },
);

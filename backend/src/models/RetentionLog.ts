import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from '../config/database';

/** Organization-database copy of a retention run, so the tenant record stands on its own. */
export class RetentionCleanupLog extends Model<InferAttributes<RetentionCleanupLog>, InferCreationAttributes<RetentionCleanupLog>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare mode: 'DRY_RUN' | 'ENFORCE' | 'SKIPPED';
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

RetentionCleanupLog.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
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
  { sequelize, tableName: 'retention_cleanup_logs', timestamps: false },
);

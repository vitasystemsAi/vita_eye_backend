import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { User } from './User';
import type { DetectionEvent } from './DetectionEvent';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare eventId: string | null;
  declare channel: NotificationChannel;
  declare title: string;
  declare message: string;
  declare deliveryStatus: CreationOptional<DeliveryStatus>;
  declare attempts: CreationOptional<number>;
  declare lastError: CreationOptional<string | null>;
  declare sentAt: CreationOptional<Date | null>;
  declare readAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare user?: NonAttribute<User>;
  declare event?: NonAttribute<DetectionEvent>;
}

Notification.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID, allowNull: false },
    eventId: { type: DataTypes.UUID, allowNull: true },
    channel: { type: DataTypes.ENUM('IN_APP', 'EMAIL', 'PUSH'), allowNull: false },
    title: { type: DataTypes.STRING(200), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    deliveryStatus: {
      type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.STRING(512), allowNull: true },
    sentAt: { type: DataTypes.DATE(3), allowNull: true },
    readAt: { type: DataTypes.DATE(3), allowNull: true },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'notifications', updatedAt: false },
);

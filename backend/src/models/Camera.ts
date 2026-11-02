import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type CameraType = 'BROWSER' | 'RTSP' | 'ONVIF' | 'HTTP_MJPEG' | 'USB' | 'LAN';
export type CameraStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';

export interface CameraSchedule {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  start: string; // HH:mm
  end: string; // HH:mm
  timezone: string;
}

export class Camera extends Model<InferAttributes<Camera>, InferCreationAttributes<Camera>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare cameraName: string;
  declare cameraType: CameraType;
  declare location: string;
  declare site: string | null;
  declare streamReference: string | null;
  declare encryptedCredentials: CreationOptional<string | null>;
  declare status: CreationOptional<CameraStatus>;
  declare isActive: CreationOptional<boolean>;
  declare monitoringEnabled: CreationOptional<boolean>;
  declare monitorTicketId: CreationOptional<string | null>;
  declare schedule: CreationOptional<CameraSchedule | null>;
  declare samplingFps: CreationOptional<number>;
  declare lastError: CreationOptional<string | null>;
  declare lastConnectedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Camera.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    cameraName: { type: DataTypes.STRING(120), allowNull: false },
    cameraType: { type: DataTypes.ENUM('BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN'), allowNull: false },
    location: { type: DataTypes.STRING(160), allowNull: false },
    site: { type: DataTypes.STRING(120), allowNull: true },
    streamReference: { type: DataTypes.STRING(512), allowNull: true },
    encryptedCredentials: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('ONLINE', 'OFFLINE', 'ERROR', 'DISABLED'), allowNull: false, defaultValue: 'OFFLINE' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    monitoringEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    monitorTicketId: { type: DataTypes.CHAR(36), allowNull: true },
    schedule: { type: DataTypes.JSON, allowNull: true },
    samplingFps: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      defaultValue: 8,
      get() {
        const v = this.getDataValue('samplingFps');
        return v === null || v === undefined ? 8 : Number(v);
      },
    },
    lastError: { type: DataTypes.STRING(512), allowNull: true },
    lastConnectedAt: { type: DataTypes.DATE(3), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'cameras',
    defaultScope: { attributes: { exclude: ['encryptedCredentials'] } },
    scopes: { withCredentials: { attributes: { include: ['encryptedCredentials'] } } },
  },
);

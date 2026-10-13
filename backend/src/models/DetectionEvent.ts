import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { Camera } from './Camera';
import type { RegisteredPerson } from './Person';
import type { User } from './User';

export type EventType = 'KNOWN' | 'UNKNOWN' | 'UNCERTAIN';
export type ReviewStatus = 'NEW' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED';
/** SNAPSHOT = full scene with the face outlined; FACE = zoomed face close-up. */
export type EvidenceType = 'SNAPSHOT' | 'FACE' | 'CLIP';

const decimalGetter = (field: 'confidenceScore' | 'qualityScore') =>
  function (this: DetectionEvent) {
    const v = this.getDataValue(field);
    return v === null || v === undefined ? null : Number(v);
  };

export class DetectionEvent extends Model<InferAttributes<DetectionEvent>, InferCreationAttributes<DetectionEvent>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare cameraId: string;
  declare registeredPersonId: string | null;
  declare eventType: EventType;
  declare confidenceScore: number | null;
  declare qualityScore: number | null;
  declare modelVersion: string;
  declare trackId: string | null;
  declare framesObserved: number | null;
  declare eventTimestamp: Date;
  declare reviewStatus: CreationOptional<ReviewStatus>;
  declare acknowledgedBy: CreationOptional<string | null>;
  declare acknowledgedAt: CreationOptional<Date | null>;
  declare resolvedBy: CreationOptional<string | null>;
  declare resolvedAt: CreationOptional<Date | null>;
  declare resolution: CreationOptional<string | null>;
  /** Set by an authorized administrator. Retention never deletes a held record. */
  declare legalHold: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare camera?: NonAttribute<Camera>;
  declare person?: NonAttribute<RegisteredPerson>;
  declare evidence?: NonAttribute<EventEvidence[]>;
  declare notes?: NonAttribute<EventNote[]>;
  declare acknowledger?: NonAttribute<User>;
  declare resolver?: NonAttribute<User>;
}

DetectionEvent.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    cameraId: { type: DataTypes.UUID, allowNull: false },
    registeredPersonId: { type: DataTypes.UUID, allowNull: true },
    eventType: { type: DataTypes.ENUM('KNOWN', 'UNKNOWN', 'UNCERTAIN'), allowNull: false },
    confidenceScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, get: decimalGetter('confidenceScore') },
    qualityScore: { type: DataTypes.DECIMAL(6, 4), allowNull: true, get: decimalGetter('qualityScore') },
    modelVersion: { type: DataTypes.STRING(128), allowNull: false },
    trackId: { type: DataTypes.STRING(64), allowNull: true },
    framesObserved: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    eventTimestamp: { type: DataTypes.DATE(3), allowNull: false },
    reviewStatus: {
      type: DataTypes.ENUM('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'),
      allowNull: false,
      defaultValue: 'NEW',
    },
    acknowledgedBy: { type: DataTypes.UUID, allowNull: true },
    acknowledgedAt: { type: DataTypes.DATE(3), allowNull: true },
    resolvedBy: { type: DataTypes.UUID, allowNull: true },
    resolvedAt: { type: DataTypes.DATE(3), allowNull: true },
    resolution: { type: DataTypes.STRING(64), allowNull: true },
    legalHold: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'detection_events' },
);

export class EventEvidence extends Model<InferAttributes<EventEvidence>, InferCreationAttributes<EventEvidence>> {
  declare id: CreationOptional<string>;
  declare eventId: string;
  declare storageReference: string;
  declare evidenceType: CreationOptional<EvidenceType>;
  declare contentHash: string;
  declare mimeType: CreationOptional<string>;
  declare createdAt: CreationOptional<Date>;
  declare expiresAt: Date | null;
}

EventEvidence.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    eventId: { type: DataTypes.UUID, allowNull: false },
    storageReference: { type: DataTypes.STRING(512), allowNull: false },
    evidenceType: { type: DataTypes.ENUM('SNAPSHOT', 'FACE', 'CLIP'), allowNull: false, defaultValue: 'SNAPSHOT' },
    contentHash: { type: DataTypes.CHAR(64), allowNull: false },
    mimeType: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'image/jpeg' },
    createdAt: DataTypes.DATE(3),
    expiresAt: { type: DataTypes.DATE(3), allowNull: true },
  },
  {
    sequelize,
    tableName: 'event_evidence',
    updatedAt: false,
    defaultScope: { attributes: { exclude: ['storageReference'] } },
    scopes: { withStorage: { attributes: { include: ['storageReference'] } } },
  },
);

export class EventNote extends Model<InferAttributes<EventNote>, InferCreationAttributes<EventNote>> {
  declare id: CreationOptional<string>;
  declare eventId: string;
  declare userId: string | null;
  declare note: string;
  declare createdAt: CreationOptional<Date>;
  declare author?: NonAttribute<User>;
}

EventNote.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    eventId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: false },
    createdAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'event_notes', updatedAt: false },
);

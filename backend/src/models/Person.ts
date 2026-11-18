import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { User } from './User';

export type EnrollmentStatus = 'PENDING' | 'ENROLLED' | 'FAILED' | 'REVOKED';

export class RegisteredPerson extends Model<InferAttributes<RegisteredPerson>, InferCreationAttributes<RegisteredPerson>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare personName: string;
  declare referenceId: string;
  declare department: string | null;
  declare status: CreationOptional<'ACTIVE' | 'SUSPENDED' | 'INACTIVE'>;
  declare statusChangedAt: CreationOptional<Date>;
  declare enrollmentStatus: CreationOptional<EnrollmentStatus>;
  declare legalBasis: CreationOptional<string | null>;
  declare consentReference: CreationOptional<string | null>;
  declare consentRecordedAt: CreationOptional<Date | null>;
  declare enrolledBy: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare deletedAt: CreationOptional<Date | null>;
  declare templates?: NonAttribute<FaceTemplate[]>;
  declare enroller?: NonAttribute<User>;
}

RegisteredPerson.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    personName: { type: DataTypes.STRING(160), allowNull: false },
    referenceId: { type: DataTypes.STRING(64), allowNull: false },
    department: { type: DataTypes.STRING(120), allowNull: true },
    status: { type: DataTypes.ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE'), allowNull: false, defaultValue: 'ACTIVE' },
    statusChangedAt: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
    enrollmentStatus: {
      type: DataTypes.ENUM('PENDING', 'ENROLLED', 'FAILED', 'REVOKED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    legalBasis: { type: DataTypes.STRING(120), allowNull: true },
    consentReference: { type: DataTypes.STRING(255), allowNull: true },
    consentRecordedAt: { type: DataTypes.DATE(3), allowNull: true },
    enrolledBy: { type: DataTypes.UUID, allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
    deletedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'registered_persons', paranoid: true },
);

/**
 * Encrypted biometric template. Plaintext embeddings are decrypted only for the AI service
 * and while an admin export seals them under a passphrase. API responses never include them.
 */
export class FaceTemplate extends Model<InferAttributes<FaceTemplate>, InferCreationAttributes<FaceTemplate>> {
  declare id: CreationOptional<string>;
  declare registeredPersonId: string;
  declare encryptedEmbedding: string;
  declare modelName: string;
  declare modelVersion: string;
  declare qualityScore: number | null;
  declare previewReference: CreationOptional<string | null>;
  declare previewMime: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FaceTemplate.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    registeredPersonId: { type: DataTypes.UUID, allowNull: false },
    encryptedEmbedding: { type: DataTypes.TEXT, allowNull: false },
    modelName: { type: DataTypes.STRING(64), allowNull: false },
    modelVersion: { type: DataTypes.STRING(64), allowNull: false },
    qualityScore: { type: DataTypes.FLOAT, allowNull: true },
    previewReference: { type: DataTypes.STRING(512), allowNull: true },
    previewMime: { type: DataTypes.STRING(32), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  {
    sequelize,
    tableName: 'face_templates',
    defaultScope: { attributes: { exclude: ['encryptedEmbedding'] } },
    scopes: { withEmbedding: { attributes: { include: ['encryptedEmbedding'] } } },
  },
);

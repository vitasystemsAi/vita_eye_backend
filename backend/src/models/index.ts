import type { ModelStatic, Model } from 'sequelize';
import { sequelize } from '../config/database';
import { currentTenantDatabase } from '../db/tenantContext';
import { Organization } from './Organization';
import { Permission, Role, RolePermission } from './Role';
import { PasswordResetToken, RefreshToken, User, UserDevice } from './User';
import { FaceTemplate, RegisteredPerson } from './Person';
import { Camera } from './Camera';
import { DetectionEvent, EventEvidence, EventNote } from './DetectionEvent';
import { Notification } from './Notification';
import { AppSetting, AuditLog } from './AuditLog';
import { ClientCredential, OrganizationHold, PasswordResetRequest, PlatformAdmin, PlatformAuditLog, ProvisioningJob, RetentionCleanupRun, TenantUserDirectory } from './Platform';
import { RetentionCleanupLog } from './RetentionLog';
import { Bed, Department, EmployeeType, Floor, Room } from './Premises';

Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', otherKey: 'permissionId', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', otherKey: 'roleId', as: 'roles' });

User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
User.belongsTo(Organization, { foreignKey: 'organizationId', as: 'organization' });
Organization.hasMany(User, { foreignKey: 'organizationId', as: 'users' });
User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
User.hasMany(UserDevice, { foreignKey: 'userId', as: 'devices' });

RegisteredPerson.hasMany(FaceTemplate, { foreignKey: 'registeredPersonId', as: 'templates' });
FaceTemplate.belongsTo(RegisteredPerson, { foreignKey: 'registeredPersonId', as: 'person' });
RegisteredPerson.belongsTo(User, { foreignKey: 'enrolledBy', as: 'enroller' });

DetectionEvent.belongsTo(Camera, { foreignKey: 'cameraId', as: 'camera' });
Camera.hasMany(DetectionEvent, { foreignKey: 'cameraId', as: 'events' });
DetectionEvent.belongsTo(RegisteredPerson, { foreignKey: 'registeredPersonId', as: 'person' });
DetectionEvent.belongsTo(User, { foreignKey: 'acknowledgedBy', as: 'acknowledger' });
DetectionEvent.belongsTo(User, { foreignKey: 'resolvedBy', as: 'resolver' });
DetectionEvent.hasMany(EventEvidence, { foreignKey: 'eventId', as: 'evidence' });
EventEvidence.belongsTo(DetectionEvent, { foreignKey: 'eventId', as: 'event' });
DetectionEvent.hasMany(EventNote, { foreignKey: 'eventId', as: 'notes' });
EventNote.belongsTo(User, { foreignKey: 'userId', as: 'author' });

Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Notification.belongsTo(DetectionEvent, { foreignKey: 'eventId', as: 'event' });

AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Floor.hasMany(Room, { foreignKey: 'floorId', as: 'rooms' });
Room.belongsTo(Floor, { foreignKey: 'floorId', as: 'floor' });
Room.hasMany(Bed, { foreignKey: 'roomId', as: 'beds' });
Bed.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

/**
 * Organization data lives in the organization's own database. These models resolve their schema
 * from the tenant context on every query, so `tenant_db`.`table` is emitted while shared reference
 * tables (organizations, roles, permissions) and control-plane tables stay on the primary database.
 */
const TENANT_MODELS: Array<ModelStatic<Model>> = [
  User,
  RefreshToken,
  PasswordResetToken,
  UserDevice,
  RegisteredPerson,
  FaceTemplate,
  Camera,
  DetectionEvent,
  EventEvidence,
  EventNote,
  Notification,
  AuditLog,
  AppSetting,
  RetentionCleanupLog,
  Floor,
  Room,
  Bed,
  EmployeeType,
  Department,
];
for (const model of TENANT_MODELS) {
  Object.defineProperty(model, '_schema', {
    configurable: true,
    get: () => currentTenantDatabase(),
    set: () => undefined,
  });
}

export {
  sequelize,
  Organization,
  Permission,
  Role,
  RolePermission,
  User,
  RefreshToken,
  PasswordResetToken,
  UserDevice,
  RegisteredPerson,
  FaceTemplate,
  Camera,
  DetectionEvent,
  EventEvidence,
  EventNote,
  Notification,
  AuditLog,
  AppSetting,
  PlatformAdmin,
  TenantUserDirectory,
  ClientCredential,
  PlatformAuditLog,
  ProvisioningJob,
  OrganizationHold,
  PasswordResetRequest,
  RetentionCleanupRun,
  RetentionCleanupLog,
  Floor,
  Room,
  Bed,
  EmployeeType,
  Department,
};

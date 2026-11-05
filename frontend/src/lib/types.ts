export type RoleName = 'SUPER_ADMIN' | 'SECURITY_ADMIN' | 'SECURITY_OPERATOR' | 'AUDITOR' | 'PREVIEW';

export type Permission =
  | 'dashboard:view'
  | 'persons:view'
  | 'persons:manage'
  | 'persons:enroll'
  | 'persons:delete'
  | 'cameras:view'
  | 'cameras:manage'
  | 'cameras:monitor'
  | 'events:view'
  | 'events:review'
  | 'events:export'
  | 'evidence:view'
  | 'notifications:view'
  | 'notifications:manage'
  | 'users:view'
  | 'users:manage'
  | 'audit:view'
  | 'settings:view'
  | 'settings:manage'
  | 'premises:view'
  | 'premises:manage'
  | 'data:export'
  | 'data:import'
  | 'faces:export'
  | 'faces:import';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type FeatureKey =
  | 'dashboard'
  | 'liveMonitoring'
  | 'multiCameraDashboard'
  | 'cameraManagement'
  | 'objectDetection'
  | 'humanDetection'
  | 'vehicleDetection'
  | 'intrusionDetection'
  | 'restrictedAreaDetection'
  | 'motionDetection'
  | 'faceRegistration'
  | 'licensePlateRecognition'
  | 'unknownAlerts'
  | 'advancedAnalytics'
  | 'detectionHistory'
  | 'evidenceCapture'
  | 'reportsExport'
  | 'exportDownload'
  | 'notifications'
  | 'emailAlerts'
  | 'pushAlerts'
  | 'apiAccess'
  | 'userManagement'
  | 'settings'
  | 'auditLogs';

export type OrganizationTypeCode = 'OFFICE' | 'HOSTEL' | 'HOME' | 'SCHOOL' | 'HOSPITAL' | 'OTHER';
export type MasterKind = 'workforce' | 'lodging' | 'layout' | 'tenants' | 'none';
export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE';

export type OrganizationStatus = 'PROVISIONING' | 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ON_HOLD' | 'DEACTIVATED' | 'ARCHIVED' | 'FAILED';
export type RetentionMode = 'DRY_RUN' | 'ENFORCE';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
  features: FeatureKey[];
  siteScope: string[] | null;
  /** Platform admin email when this is a "view as" session opened from the platform console. */
  impersonatedBy: string | null;
  organization: {
    id: string;
    name: string;
    status: OrganizationStatus;
    detectionRetentionDays: number | null;
    organizationType: OrganizationTypeCode;
    organizationTypeLabel: string;
    capacity: number | null;
    capacityUnit: string;
    capacityLabel: string;
  } | null;
}

export type EventType = 'KNOWN' | 'UNKNOWN' | 'UNCERTAIN';
export type ReviewStatus = 'NEW' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED';
export type Resolution =
  | 'AUTHORIZED_VISITOR'
  | 'EMPLOYEE_NOT_ENROLLED'
  | 'FALSE_DETECTION'
  | 'ESCALATED'
  | 'NO_ACTION_REQUIRED'
  | 'OTHER'
  | 'AUTO_KNOWN';

export interface EventSummary {
  id: string;
  eventType: EventType;
  confidenceScore: number | null;
  qualityScore: number | null;
  eventTimestamp: string;
  reviewStatus: ReviewStatus;
  modelVersion: string;
  framesObserved: number;
  camera: { id: string; name: string; location: string; site: string | null } | null;
  person: { id: string; name: string; referenceId: string; department: string | null; deleted: boolean } | null;
  hasEvidence?: boolean;
  /** Thumbnail evidence: the face close-up when available, otherwise the full photo. */
  evidenceId?: string | null;
  faceEvidenceId?: string | null;
  sceneEvidenceId?: string | null;
  evidenceExpired?: boolean;
  createdAt: string;
  /** Present on a live unrecognized alert: how many double-verified unrecognized faces were counted today. */
  unrecognizedToday?: number;
}

export interface EventDetail extends EventSummary {
  trackId: string | null;
  acknowledgedBy: { id: string; name: string } | null;
  acknowledgedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: string | null;
  resolution: Resolution | null;
  evidence: Array<{ id: string; evidenceType: 'FACE' | 'SNAPSHOT' | 'CLIP'; contentHash: string; createdAt: string; expiresAt: string | null; expired: boolean }>;
  notes: Array<{ id: string; note: string; createdAt: string; author: { id: string; name: string } | null }>;
}

export type PersonStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type EnrollmentStatus = 'PENDING' | 'ENROLLED' | 'FAILED' | 'REVOKED';
export type LegalBasis = 'CONSENT' | 'EMPLOYMENT' | 'LEGAL_OBLIGATION' | 'LEGITIMATE_USE' | 'OTHER';

export interface Person {
  id: string;
  personName: string;
  referenceId: string;
  department: string | null;
  status: PersonStatus;
  enrollmentStatus: EnrollmentStatus;
  legalBasis: LegalBasis | null;
  consentReference: string | null;
  consentRecordedAt: string | null;
  enrolledBy: { id: string; name: string } | null;
  templateCount: number;
  statusChangedAt: string;
  /** True when no face was stored, so the registration can be deleted immediately. */
  canDiscard?: boolean;
  canDelete: boolean;
  deleteAvailableAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDetail extends Person {
  templates: Array<{ id: string; modelName: string; modelVersion: string; qualityScore: number | null; createdAt: string }>;
  history: Array<{ id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; user: { id: string; name: string } | null }>;
}

export interface FaceQuality {
  score: number;
  faceSize: number;
  sharpness: number;
  brightness: number;
  poseYaw: number;
  detectionScore: number;
  issues: string[];
}

export interface EnrollImageResult {
  index: number;
  fileName: string;
  accepted: boolean;
  quality?: FaceQuality;
  reasons?: string[];
  message?: string;
}

export type CameraType = 'BROWSER' | 'RTSP' | 'ONVIF' | 'HTTP_MJPEG' | 'USB' | 'LAN';

/** Picture is captured on this computer: the built-in webcam, or a camera on a USB / USB-C cable. */
export function isLocalCamera(type: CameraType): boolean {
  return type === 'BROWSER' || type === 'USB';
}
export type CameraStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';

export interface CameraSchedule {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
  timezone: string;
}

export interface Camera {
  id: string;
  cameraName: string;
  cameraType: CameraType;
  location: string;
  site: string | null;
  streamReference: string | null;
  hasCredentials: boolean;
  status: CameraStatus;
  isActive: boolean;
  monitoringEnabled: boolean;
  schedule: CameraSchedule | null;
  withinSchedule: boolean;
  samplingFps: number;
  lastError: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FaceLabel = 'KNOWN' | 'UNKNOWN' | 'UNCERTAIN' | 'LOW_QUALITY' | 'PENDING';

export interface FrameFace {
  trackId: string;
  bbox: [number, number, number, number];
  label: FaceLabel;
  personId: string | null;
  personName: string | null;
  similarity: number | null;
  quality: number;
}

export interface FrameAck {
  ok: boolean;
  dropped?: boolean;
  error?: string;
  frameSize?: [number, number];
  events?: number;
  alerts?: Array<{ id: string; eventType: 'UNKNOWN' | 'UNCERTAIN' }>;
  faces?: FrameFace[];
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface AppNotification {
  id: string;
  eventId: string | null;
  channel: NotificationChannel;
  title: string;
  message: string;
  deliveryStatus: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
  recipient?: { id: string; name: string; email: string } | null;
}

export interface NotificationSettings {
  unknownAlerts: boolean;
  uncertainAlerts: boolean;
  channels: { inApp: boolean; email: boolean; push: boolean };
  recipientRoles: RoleName[];
  alertCooldownSec: number;
  knownCooldownSec: number;
  unknownCooldownSec: number;
  providers: { email: boolean; push: boolean; pushReason: string | null };
}

export interface DashboardSummary {
  registeredPersons: number;
  enrolledPersons: number;
  activeCameras: number;
  onlineCameras: number;
  offlineCameras: number;
  errorCameras: number;
  monitoringCameras: number;
  today: { total: number; known: number; unknown: number; uncertain: number };
  uncertainPendingReview: number;
  unresolvedAlerts: number;
  unreadNotifications: number;
  generatedAt: string;
}

export interface TypeCounts {
  known: number;
  unknown: number;
  uncertain: number;
}

export interface DashboardTrends {
  days: Array<TypeCounts & { date: string }>;
  hourly: Array<TypeCounts & { hour: number }>;
  cameras: Array<{
    id: string;
    name: string;
    location: string;
    site: string | null;
    type: CameraType;
    status: CameraStatus;
    isActive: boolean;
    monitoringEnabled: boolean;
    lastConnectedAt: string | null;
    lastError: string | null;
    eventsToday: number;
  }>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email?: string } | null;
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: RoleName | null;
  status: 'ACTIVE' | 'DISABLED';
  siteScope: string[] | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecognitionSettings {
  knownThreshold: number;
  unknownThreshold: number;
  matchMargin: number;
  minFaceSize: number;
  minQuality: number;
  minDetectionScore: number;
  temporalMinFrames: number;
  temporalWindowSec: number;
  temporalAgreement: number;
}

export interface AppSettings {
  recognition: RecognitionSettings;
  events: { knownCooldownSec: number; unknownCooldownSec: number; captureEvidence: boolean; recordKnownEvents: boolean };
  notifications: Omit<NotificationSettings, 'knownCooldownSec' | 'unknownCooldownSec' | 'providers'>;
  retention: { evidenceDays: number; eventDays: number; notificationDays: number; auditDays: number; deletedPersonPurgeDays: number };
}

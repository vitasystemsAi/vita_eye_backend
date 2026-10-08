import type { Permission } from './rbac';

/**
 * Product features a platform admin can enable per organization. Disabling a feature removes the
 * listed permissions from every user of that organization (enforced by the API, not just hidden
 * in the UI). Features without permissions are enforced where they apply (see settings.service).
 */
export const FEATURES = {
  dashboard: {
    label: 'Dashboard',
    description: 'Live counters, trends and camera activity overview',
    permissions: ['dashboard:view'],
  },
  liveMonitoring: {
    label: 'Live monitoring',
    description: 'Stream browser and network cameras for real-time recognition',
    permissions: ['cameras:monitor'],
  },
  cameraManagement: {
    label: 'Camera management',
    description: 'Add, edit, test and remove cameras',
    permissions: ['cameras:manage'],
  },
  faceRegistration: {
    label: 'Face registration',
    description: 'Register known persons and enroll facial templates',
    permissions: ['persons:view', 'persons:manage', 'persons:enroll', 'persons:delete'],
  },
  unknownAlerts: {
    label: 'Unknown person alerts',
    description: 'Alert page and notifications for unknown / uncertain detections',
    permissions: [],
  },
  detectionHistory: {
    label: 'Detection history',
    description: 'Searchable history of detection events with review workflow',
    permissions: ['events:review'],
  },
  evidenceCapture: {
    label: 'Evidence snapshots',
    description: 'Store encrypted face and scene images for each event',
    permissions: ['evidence:view'],
  },
  reportsExport: {
    label: 'Reports & export',
    description: 'Export detection reports as CSV, Excel, PDF or ZIP',
    permissions: ['events:export'],
  },
  notifications: {
    label: 'Notification center',
    description: 'In-app notification inbox, delivery logs and channel settings',
    permissions: ['notifications:view', 'notifications:manage'],
  },
  emailAlerts: {
    label: 'Email alerts',
    description: 'Deliver alerts by email (requires SMTP)',
    permissions: [],
  },
  pushAlerts: {
    label: 'Push alerts',
    description: 'Deliver alerts as mobile / browser push notifications (requires Firebase)',
    permissions: [],
  },
  userManagement: {
    label: 'Users & roles',
    description: 'Let the organization manage its own console users',
    permissions: ['users:view', 'users:manage'],
  },
  settings: {
    label: 'Settings',
    description: 'Recognition thresholds, event handling and retention settings',
    permissions: ['settings:view', 'settings:manage'],
  },
  auditLogs: {
    label: 'Audit logs',
    description: 'Tamper-evident history of security-relevant actions',
    permissions: ['audit:view'],
  },
} as const satisfies Record<string, { label: string; description: string; permissions: readonly Permission[] }>;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(v: string): v is FeatureKey {
  return v in FEATURES;
}

/** `null` (organizations created before feature flags existed) means every feature is enabled. */
export function enabledFeatures(stored: string[] | null | undefined): Set<FeatureKey> {
  if (!Array.isArray(stored)) return new Set(FEATURE_KEYS);
  return new Set(stored.filter(isFeatureKey));
}

/** Removes permissions that belong to disabled features. */
export function filterPermissions<P extends Permission>(perms: Set<P>, features: Set<FeatureKey>): Set<P> {
  const blocked = new Set<Permission>();
  for (const key of FEATURE_KEYS) {
    if (!features.has(key)) for (const p of FEATURES[key].permissions) blocked.add(p);
  }
  if (!blocked.size) return perms;
  return new Set([...perms].filter((p) => !blocked.has(p)));
}

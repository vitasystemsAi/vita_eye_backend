import type { Permission } from './rbac';

export type FeatureCategory = 'Monitoring' | 'Detection' | 'Evidence' | 'Operations' | 'Administration';

interface FeatureDefinition {
  label: string;
  description: string;
  category: FeatureCategory;
  /** False when this deployment cannot perform the feature. Those keys cannot be enabled. */
  supported: boolean;
  legalNote: string | null;
  permissions: readonly Permission[];
}

/**
 * Product features a platform admin can enable per organization. Disabling a feature removes the
 * listed permissions from every user of that organization (enforced by the API, not just hidden
 * in the UI). Features without permissions are enforced on the routes or settings that implement them.
 * A permission listed on more than one feature is removed only when every one of those features is off.
 */
export const FEATURES = {
  dashboard: {
    label: 'Dashboard',
    description: 'Live counters, trends and camera activity overview',
    category: 'Monitoring',
    supported: true,
    legalNote: null,
    permissions: ['dashboard:view'],
  },
  liveMonitoring: {
    label: 'Live Camera Monitoring',
    description: 'Stream browser and network cameras for real-time recognition',
    category: 'Monitoring',
    supported: true,
    legalNote: null,
    permissions: ['cameras:monitor'],
  },
  multiCameraDashboard: {
    label: 'Multi-Camera Dashboard',
    description: 'Watch more than one camera at the same time',
    category: 'Monitoring',
    supported: true,
    legalNote: null,
    permissions: [],
  },
  cameraManagement: {
    label: 'Camera Management',
    description: 'Add, edit, test and remove cameras',
    category: 'Monitoring',
    supported: true,
    legalNote: null,
    permissions: ['cameras:manage'],
  },
  objectDetection: {
    label: 'AI Object Detection',
    description: 'General object detection beyond the deployed face pipeline',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  humanDetection: {
    label: 'Human Detection',
    description: 'Detect people without identifying them',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  vehicleDetection: {
    label: 'Vehicle Detection',
    description: 'Detect vehicles in the camera view',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  intrusionDetection: {
    label: 'Intrusion Detection',
    description: 'Alert when a person crosses a configured line or zone',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  restrictedAreaDetection: {
    label: 'Restricted Area Detection',
    description: 'Alert when a configured restricted area is entered',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  motionDetection: {
    label: 'Motion Detection',
    description: 'Record events from generic motion, without recognition',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  faceRegistration: {
    label: 'Face Recognition',
    description: 'Register known persons and match faces against that gallery',
    category: 'Detection',
    supported: true,
    legalNote: 'Enable only where face recognition is legally permitted and a lawful basis is recorded.',
    permissions: ['persons:view', 'persons:manage', 'persons:enroll', 'persons:delete', 'data:export', 'data:import', 'faces:export', 'faces:import'],
  },
  licensePlateRecognition: {
    label: 'License Plate Recognition',
    description: 'Read vehicle license plates from camera frames',
    category: 'Detection',
    supported: false,
    legalNote: 'Not available in this deployment. Enable only where plate recognition is legally permitted.',
    permissions: [],
  },
  unknownAlerts: {
    label: 'Unknown person alerts',
    description: 'Alert page and notifications for unknown or uncertain detections',
    category: 'Detection',
    supported: true,
    legalNote: null,
    permissions: [],
  },
  advancedAnalytics: {
    label: 'Advanced AI Analytics',
    description: 'Models and reports beyond the deployed recognition pipeline',
    category: 'Detection',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  detectionHistory: {
    label: 'Detection History',
    description: 'Searchable history of detection events with review workflow',
    category: 'Evidence',
    supported: true,
    legalNote: null,
    permissions: ['events:review'],
  },
  evidenceCapture: {
    label: 'Image and Video Evidence',
    description: 'Store encrypted face and scene images for each event. Video clips use the same private store when a clip is produced.',
    category: 'Evidence',
    supported: true,
    legalNote: null,
    permissions: ['evidence:view'],
  },
  reportsExport: {
    label: 'Reports and Analytics',
    description: 'Detection reports and analytics for the organization',
    category: 'Operations',
    supported: true,
    legalNote: null,
    permissions: ['events:export'],
  },
  exportDownload: {
    label: 'Export and Download',
    description: 'Download detection reports and evidence archives',
    category: 'Operations',
    supported: true,
    legalNote: null,
    permissions: [],
  },
  notifications: {
    label: 'Alerts and Notifications',
    description: 'In-app notification inbox and delivery logs',
    category: 'Operations',
    supported: true,
    legalNote: null,
    permissions: ['notifications:view', 'notifications:manage'],
  },
  emailAlerts: {
    label: 'Email alerts',
    description: 'Deliver alerts by email (requires SMTP)',
    category: 'Operations',
    supported: true,
    legalNote: null,
    permissions: [],
  },
  pushAlerts: {
    label: 'Push alerts',
    description: 'Deliver alerts as mobile or browser push notifications (requires Firebase)',
    category: 'Operations',
    supported: true,
    legalNote: null,
    permissions: [],
  },
  apiAccess: {
    label: 'API Access',
    description: 'External API credentials for integrations',
    category: 'Administration',
    supported: false,
    legalNote: null,
    permissions: [],
  },
  userManagement: {
    label: 'User and Role Management',
    description: 'Let the organization manage its own console users',
    category: 'Administration',
    supported: true,
    legalNote: null,
    permissions: ['users:view', 'users:manage'],
  },
  settings: {
    label: 'Settings',
    description: 'Recognition thresholds, event handling and retention settings',
    category: 'Administration',
    supported: true,
    legalNote: null,
    permissions: ['settings:view', 'settings:manage'],
  },
  auditLogs: {
    label: 'Audit logs',
    description: 'History of security-relevant actions inside the organization',
    category: 'Administration',
    supported: true,
    legalNote: null,
    permissions: ['audit:view'],
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export const FEATURE_CATEGORIES: FeatureCategory[] = ['Monitoring', 'Detection', 'Evidence', 'Operations', 'Administration'];

export function isFeatureKey(v: string): v is FeatureKey {
  return v in FEATURES;
}

/** `null` (organizations created before feature flags existed) means every feature is enabled. */
export function enabledFeatures(stored: string[] | null | undefined): Set<FeatureKey> {
  if (!Array.isArray(stored)) return new Set(FEATURE_KEYS);
  return new Set(stored.filter(isFeatureKey));
}

/**
 * Removes permissions that belong only to disabled features.
 * A permission shared by several features stays while any of those features is enabled.
 */
export function filterPermissions<P extends Permission>(perms: Set<P>, features: Set<FeatureKey>): Set<P> {
  const grantors = new Map<Permission, FeatureKey[]>();
  for (const key of FEATURE_KEYS) {
    for (const permission of FEATURES[key].permissions) {
      const list = grantors.get(permission) ?? [];
      list.push(key);
      grantors.set(permission, list);
    }
  }
  const blocked = new Set<Permission>();
  for (const [permission, keys] of grantors) {
    if (keys.every((key) => !features.has(key))) blocked.add(permission);
  }
  if (!blocked.size) return perms;
  return new Set([...perms].filter((permission) => !blocked.has(permission)));
}

export function featureCatalog() {
  return FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURES[key].label,
    description: FEATURES[key].description,
    category: FEATURES[key].category,
    supported: FEATURES[key].supported,
    legalNote: FEATURES[key].legalNote,
  }));
}

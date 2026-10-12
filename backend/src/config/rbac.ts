export const PERMISSIONS = {
  'dashboard:view': 'View dashboard metrics and trends',
  'persons:view': 'View registered persons (no biometric data)',
  'persons:manage': 'Create, edit, activate and deactivate registered persons',
  'persons:enroll': 'Capture and enroll facial templates',
  'persons:delete': 'Delete persons and purge biometric templates',
  'cameras:view': 'View cameras within permitted sites',
  'cameras:manage': 'Create, edit, test and deactivate cameras',
  'cameras:monitor': 'Start/stop monitoring and stream frames',
  'events:view': 'View detection events',
  'events:review': 'Acknowledge, annotate, resolve and reopen events',
  'events:export': 'Export detection reports',
  'evidence:view': 'Access event evidence through signed URLs',
  'notifications:view': 'View notification delivery logs and settings',
  'notifications:manage': 'Configure notification channels, recipients and send tests',
  'users:view': 'View users and roles',
  'users:manage': 'Create and modify users and role assignments',
  'audit:view': 'View audit logs',
  'settings:view': 'View system settings and health',
  'settings:manage': 'Modify recognition, retention and system settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_NAMES = ['SUPER_ADMIN', 'SECURITY_ADMIN', 'SECURITY_OPERATOR', 'AUDITOR', 'PREVIEW'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLES: Record<RoleName, { description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: {
    description: 'Full control of the organization, including user administration',
    permissions: ALL,
  },
  SECURITY_ADMIN: {
    description: 'Manages persons, cameras, alerts, notifications and settings',
    permissions: ALL.filter((p) => p !== 'users:manage'),
  },
  SECURITY_OPERATOR: {
    description: 'Monitors cameras and reviews detection events',
    permissions: [
      'dashboard:view',
      'persons:view',
      'cameras:view',
      'cameras:monitor',
      'events:view',
      'events:review',
      'evidence:view',
      'notifications:view',
    ],
  },
  AUDITOR: {
    description: 'Read-only access to events, configuration and audit history',
    permissions: [
      'dashboard:view',
      'persons:view',
      'cameras:view',
      'events:view',
      'events:export',
      'notifications:view',
      'users:view',
      'audit:view',
      'settings:view',
    ],
  },
  PREVIEW: {
    description: 'Kiosk-style live monitoring with real-time detections only',
    permissions: ['persons:view', 'cameras:view', 'cameras:monitor', 'events:view', 'evidence:view'],
  },
};

/** Roles a user may assign: nobody except SUPER_ADMIN can create SUPER_ADMINs. */
export function canAssignRole(actorRole: RoleName, target: RoleName): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  return target !== 'SUPER_ADMIN';
}

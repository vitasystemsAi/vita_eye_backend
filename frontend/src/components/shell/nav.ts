import {
  Bell,
  Building2,
  Camera,
  History,
  LayoutDashboard,
  MonitorPlay,
  ScrollText,
  Settings,
  ArrowLeftRight,
  ShieldAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureKey, Permission } from '@/lib/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Hidden when the platform has not enabled this feature for the organization. Omitted for setup that every organization has. */
  feature?: FeatureKey;
  section: 'Operations' | 'Management' | 'Administration';
}

// Visibility only; every endpoint enforces the same permissions and features on the server.
export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:view', feature: 'dashboard', section: 'Operations' },
  { href: '/monitoring', label: 'Live Monitoring', icon: MonitorPlay, permission: 'cameras:view', feature: 'liveMonitoring', section: 'Operations' },
  { href: '/alerts', label: 'Unknown Alerts', icon: ShieldAlert, permission: 'events:view', feature: 'unknownAlerts', section: 'Operations' },
  { href: '/events', label: 'Detection History', icon: History, permission: 'events:view', feature: 'detectionHistory', section: 'Operations' },
  { href: '/notifications', label: 'Notifications', icon: Bell, permission: 'dashboard:view', feature: 'notifications', section: 'Operations' },
  { href: '/persons', label: 'Face Registration', icon: UserPlus, permission: 'persons:view', feature: 'faceRegistration', section: 'Management' },
  { href: '/cameras', label: 'Cameras', icon: Camera, permission: 'cameras:view', feature: 'cameraManagement', section: 'Management' },
  { href: '/premises', label: 'Master data', icon: Building2, permission: 'premises:view', section: 'Management' },
  { href: '/users', label: 'Users & Roles', icon: Users, permission: 'users:view', feature: 'userManagement', section: 'Administration' },
  { href: '/data', label: 'Data exchange', icon: ArrowLeftRight, permission: 'data:export', feature: 'faceRegistration', section: 'Administration' },
  { href: '/settings', label: 'Settings', icon: Settings, permission: 'settings:view', feature: 'settings', section: 'Administration' },
  { href: '/audit', label: 'Audit Logs', icon: ScrollText, permission: 'audit:view', feature: 'auditLogs', section: 'Administration' },
];

export function navLabel(item: NavItem, organizationType?: string | null) {
  if (item.href !== '/premises') return item.label;
  switch (organizationType) {
    case 'OFFICE':
      return 'Workforce';
    case 'HOSTEL':
      return 'Tenants';
    case 'HOSPITAL':
      return 'Floors & beds';
    case 'HOME':
      return 'Home layout';
    case 'SCHOOL':
      return 'Campus';
    default:
      return item.label;
  }
}

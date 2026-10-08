import {
  Bell,
  Camera,
  History,
  LayoutDashboard,
  MonitorPlay,
  ScrollText,
  Settings,
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
  /** Hidden when the platform has not enabled this feature for the organization. */
  feature: FeatureKey;
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
  { href: '/users', label: 'Users & Roles', icon: Users, permission: 'users:view', feature: 'userManagement', section: 'Administration' },
  { href: '/settings', label: 'Settings', icon: Settings, permission: 'settings:view', feature: 'settings', section: 'Administration' },
  { href: '/audit', label: 'Audit Logs', icon: ScrollText, permission: 'audit:view', feature: 'auditLogs', section: 'Administration' },
];

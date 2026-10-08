import type { FeatureKey } from '../config/features';
import type { Permission, RoleName } from '../config/rbac';

export interface AuthContext {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  role: RoleName;
  /** Role permissions minus those of features disabled for the organization. */
  permissions: Set<Permission>;
  features: Set<FeatureKey>;
  /** null = all sites */
  siteScope: string[] | null;
  sessionId: string | null;
  /** Platform admin email when this session was opened through "view as". */
  impersonatedBy: string | null;
}

export interface PlatformAdminContext {
  id: string;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      platformAdmin?: PlatformAdminContext;
    }
  }
}

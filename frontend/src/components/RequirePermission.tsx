'use client';

import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import type { Permission } from '@/lib/types';
import { EmptyState } from './ui/primitives';

/** UX guard only — the API rejects the same requests with 403 regardless of the UI. */
export function RequirePermission({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  const perms = Array.isArray(permission) ? permission : [permission];
  if (!can(...perms)) {
    return (
      <div className="card">
        <EmptyState icon={<ShieldOff className="h-6 w-6" />} title="Access restricted" description="Your role does not include access to this area. Contact an administrator if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}

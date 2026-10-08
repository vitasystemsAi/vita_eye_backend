'use client';

import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { PlatformAuthProvider } from '@/lib/platform';

export default function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformAuthProvider>
      <PlatformShell>{children}</PlatformShell>
    </PlatformAuthProvider>
  );
}

'use client';

import { Building2, LayoutDashboard, LogOut, Menu, PlusCircle, ScrollText, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { cn } from '@/components/ui/cn';
import { LoadingBlock } from '@/components/ui/primitives';
import { usePlatform } from '@/lib/platform';

const NAV = [
  { href: '/platform/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/platform/clients', label: 'Clients', icon: Building2 },
  { href: '/platform/organizations/new', label: 'Register organization', icon: PlusCircle },
  { href: '/platform/audit', label: 'Platform audit', icon: ScrollText },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo />
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-violet-300 uppercase ring-1 ring-violet-500/30">
          <ShieldCheck className="h-3 w-3" /> Platform admin
        </p>
      </div>
      <ul className="flex-1 space-y-0.5 px-3 pb-6">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== '/platform/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active ? 'bg-violet-600/15 font-medium text-violet-200 ring-1 ring-violet-500/25' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const { admin, loading, logout } = usePlatform();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (loading || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Verifying platform session…" />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-800 bg-ink-900/95 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-ink-800 bg-ink-900">
            <button className="absolute top-5 right-3 p-1 text-ink-300" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded p-1.5 text-ink-300 hover:bg-ink-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-100">VITA Systems platform console</p>
            <p className="truncate text-xs text-ink-400">Organizations, plans and client access</p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-ink-100">{admin.name}</p>
            <p className="text-xs text-ink-400">{admin.email}</p>
          </div>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-ink-100" title="Sign out" aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

'use client';

import { Eye, LogOut, Menu, Wifi, WifiOff, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AlertSoundToggle } from '@/components/AlertSoundToggle';
import { Logo } from '@/components/Logo';
import { cn } from '@/components/ui/cn';
import { LoadingBlock } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { playAlert } from '@/lib/alertSound';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/format';
import { SocketProvider, useSocket, useSocketEvent } from '@/lib/socket';
import type { EventSummary } from '@/lib/types';
import { NAV, navLabel } from './nav';
import { NotificationBell } from './NotificationBell';

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, hasFeature, user } = useAuth();
  const sections = ['Operations', 'Management', 'Administration'] as const;
  return (
    <nav className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {sections.map((section) => {
          const items = NAV.filter((n) => n.section === section && can(n.permission) && (!n.feature || hasFeature(n.feature)));
          if (!items.length) return null;
          return (
            <div key={section}>
              <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">{section}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                          active ? 'bg-brand-600/15 font-medium text-brand-300 ring-1 ring-brand-500/25' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {navLabel(item, user?.organization?.organizationType)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function ConnectionPill() {
  const { state } = useSocket();
  const live = state === 'connected';
  return (
    <span
      className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 sm:inline-flex', live ? 'text-emerald-300 ring-emerald-500/30' : 'text-amber-300 ring-amber-500/30')}
      title={live ? 'Real-time updates connected' : 'Real-time updates reconnecting'}
    >
      {live ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {live ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline'}
    </span>
  );
}

function RealtimeAlerts({ toasts = true }: { toasts?: boolean }) {
  const notify = useToast();
  const router = useRouter();
  const { can, hasFeature } = useAuth();
  useSocketEvent<EventSummary>('event:new', (e) => {
    if (!can('events:view') || !hasFeature('unknownAlerts') || e.eventType === 'KNOWN') return;
    playAlert(e.eventType, e.id);
    if (!toasts) return;
    const where = e.camera ? `${e.camera.name} · ${e.camera.location}` : 'Unknown camera';
    const tally = e.eventType === 'UNKNOWN' && e.unrecognizedToday != null ? ` Unrecognized today: ${e.unrecognizedToday}.` : '';
    notify(
      e.eventType === 'UNKNOWN' ? 'error' : 'warning',
      e.eventType === 'UNKNOWN' ? 'Unrecognized person detected' : 'Uncertain match needs review',
      e.eventType === 'UNKNOWN' ? `${where}. Confirmed after double verification.${tally}` : `${where}. Verify before taking any action.`,
    );
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const body = e.eventType === 'UNKNOWN' ? `${where}. Confirmed after double verification.${tally}` : where;
      const n = new Notification('VITA EYE alert', { body, tag: e.id, icon: '/icon-192.png' });
      n.onclick = () => router.push(`/events/${e.id}`);
    }
  });
  return null;
}

const PREVIEW_HOME = '/monitoring';

/** Kiosk layout for the PREVIEW role: live monitoring only, no navigation chrome. */
function PreviewShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onHome = pathname === PREVIEW_HOME;
  useEffect(() => {
    if (!onHome) router.replace(PREVIEW_HOME);
  }, [onHome, router]);
  if (!onHome) return null;
  return (
    <div className="flex h-screen flex-col bg-black">
      <ImpersonationBanner />
      <div className="fixed top-3 right-3 z-30 flex items-center gap-2">
        <AlertSoundToggle className="bg-ink-900/80 ring-1 ring-ink-800" />
        <button
          onClick={() => void logout()}
          className="rounded-lg bg-ink-900/80 p-2 text-ink-400 ring-1 ring-ink-800 hover:text-ink-100"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <main className="relative min-h-0 flex-1">{children}</main>
      <RealtimeAlerts toasts={false} />
    </div>
  );
}

/** Shown on "view as" sessions opened from the platform console. */
function ImpersonationBanner() {
  const { user, logout } = useAuth();
  if (!user?.impersonatedBy) return null;
  const held = user.organization?.status === 'SUSPENDED';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-xs text-amber-200">
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" />
        Platform view: signed in as <strong className="font-semibold">{user.email}</strong> by {user.impersonatedBy}. Every action is audited.
      </span>
      {held && <span className="rounded bg-red-500/20 px-2 py-0.5 font-semibold text-red-200">Organization on hold</span>}
      <button onClick={() => void logout()} className="rounded-md bg-amber-500/25 px-2.5 py-1 font-semibold text-amber-100 hover:bg-amber-500/35">
        Exit view
      </button>
    </div>
  );
}

/** Sends users away from pages whose feature is disabled for their organization (e.g. the default /dashboard). */
function useFeatureGuard() {
  const { can, hasFeature, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const current = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  const blocked = Boolean(user && current?.feature && !hasFeature(current.feature));
  const fallback = NAV.find((n) => can(n.permission) && (!n.feature || hasFeature(n.feature)))?.href;
  useEffect(() => {
    if (blocked && fallback && fallback !== current?.href) router.replace(fallback);
  }, [blocked, fallback, current?.href, router]);
  return blocked && Boolean(fallback);
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const redirecting = useFeatureGuard();
  if (!user) return null;
  if (user.role === 'PREVIEW') return <PreviewShell>{children}</PreviewShell>;
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
        <ImpersonationBanner />
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-800 bg-ink-950/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded p-1.5 text-ink-300 hover:bg-ink-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-100">{user.organization?.name ?? 'VITA EYE'}</p>
            {user.siteScope?.length ? <p className="truncate text-xs text-ink-400">Sites: {user.siteScope.join(', ')}</p> : null}
          </div>
          <ConnectionPill />
          <AlertSoundToggle />
          <NotificationBell />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-ink-100">{user.name}</p>
            <p className="text-xs text-ink-400">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <button onClick={() => void logout()} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-ink-100" title="Sign out" aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{redirecting ? <LoadingBlock /> : children}</main>
      </div>
      <RealtimeAlerts />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Verifying session…" />
      </div>
    );
  }
  return (
    <SocketProvider enabled={Boolean(user)}>
      <Shell>{children}</Shell>
    </SocketProvider>
  );
}

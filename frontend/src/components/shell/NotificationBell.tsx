'use client';

import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { AppNotification } from '@/lib/types';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, raw, reload, setData } = useApi<AppNotification[]>('/notifications', { pageSize: 8 });
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (typeof raw?.unread === 'number') setUnread(raw.unread);
  }, [raw]);

  useSocketEvent<AppNotification>('notification:new', (n) => {
    setData((prev) => [n, ...(prev ?? [])].slice(0, 8));
    setUnread((u) => u + 1);
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function markAll() {
    await api.post('/notifications/read-all');
    setUnread(0);
    void reload();
  }

  async function markOne(n: AppNotification) {
    if (n.readAt) return;
    await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    setUnread((u) => Math.max(0, u - 1));
    setData((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-ink-100" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-700/70 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button onClick={() => void markAll()} className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300" disabled={!unread}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-ink-800 overflow-y-auto">
            {(data ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-400">No notifications yet</li>}
            {(data ?? []).map((n) => (
              <li key={n.id}>
                <Link
                  href={n.eventId ? `/events/${n.eventId}` : '/notifications'}
                  onClick={() => {
                    void markOne(n);
                    setOpen(false);
                  }}
                  className={cn('block px-4 py-3 hover:bg-ink-800', !n.readAt && 'bg-brand-500/5')}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-400" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-100">{n.title}</p>
                      <p className="line-clamp-2 text-xs text-ink-300">{n.message}</p>
                      <p className="mt-1 text-[11px] text-ink-400">{fmtRelative(n.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-ink-700/70 px-4 py-2.5 text-center text-xs text-brand-400 hover:bg-ink-800">
            Open notification center
          </Link>
        </div>
      )}
    </div>
  );
}

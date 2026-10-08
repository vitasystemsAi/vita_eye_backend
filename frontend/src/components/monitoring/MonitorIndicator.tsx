'use client';

import { CircleStop, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui/cn';
import { useMonitor, type MonitorStatus } from '@/lib/monitor';

const STATUS: Record<Exclude<MonitorStatus, 'idle' | 'starting'>, { label: string; dot: string }> = {
  running: { label: 'LIVE', dot: 'bg-red-500 animate-pulse' },
  connecting: { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse' },
  paused: { label: 'Paused (schedule)', dot: 'bg-sky-400' },
  'camera-unavailable': { label: 'Camera unavailable', dot: 'bg-amber-400' },
  'other-tab': { label: 'Running in another tab', dot: 'bg-red-500' },
};

/** Always-visible control for an active monitoring session — including after logout. */
export function MonitorIndicator() {
  const { session, status, stopping, stop, resume, error } = useMonitor();
  const pathname = usePathname();
  if (!session || status === 'idle' || status === 'starting' || pathname === '/monitoring') return null;
  const s = STATUS[status];
  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/95 px-3 py-2 shadow-xl backdrop-blur">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', s.dot)} />
      <Link href="/monitoring" className="min-w-0" title={error ?? undefined}>
        <p className="text-xs font-semibold text-ink-100">{s.label}</p>
        <p className="truncate text-xs text-ink-400">{session.cameraName || 'Browser camera'}</p>
      </Link>
      {status === 'camera-unavailable' && (
        <button onClick={resume} className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100" title="Retry camera" aria-label="Retry camera">
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={() => void stop()}
        disabled={stopping}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
      >
        <CircleStop className="h-3.5 w-3.5" />
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  );
}

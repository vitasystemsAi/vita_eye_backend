'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { previewAlert, setAlertSoundMuted, useAlertSound } from '@/lib/alertSound';

/** Per-device switch for the unknown / uncertain detection alarm. */
export function AlertSoundToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  const { muted, blocked } = useAlertSound();
  const needsClick = !muted && blocked;
  const title = muted ? 'Alert sound off — click to turn on' : needsClick ? 'Click to enable the alert sound in this browser' : 'Alert sound on — click to mute';

  function onClick() {
    if (needsClick) return previewAlert('UNCERTAIN');
    setAlertSoundMuted(!muted);
    if (muted) previewAlert('UNCERTAIN');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={!muted}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg p-2 text-xs transition hover:bg-ink-800',
        muted ? 'text-ink-400 hover:text-ink-100' : needsClick ? 'animate-pulse text-amber-300 ring-1 ring-amber-500/40' : 'text-emerald-300',
        className,
      )}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      {withLabel && <span>{muted ? 'Alert sound off' : needsClick ? 'Enable alert sound' : 'Alert sound on'}</span>}
    </button>
  );
}

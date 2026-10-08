'use client';

import { Eye, ImageOff, Lock } from 'lucide-react';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/components/ui/cn';
import type { EventDetail } from '@/lib/types';

type Evidence = EventDetail['evidence'][number];

export const EVIDENCE_LABELS: Record<string, string> = { FACE: 'Face close-up', SNAPSHOT: 'Full photo', CLIP: 'Video clip' };

/**
 * Evidence is never embedded in API responses. Viewing requests short-lived signed URLs (one audited
 * batch) bound to the current user, then loads the decrypted images.
 */
export function EvidenceViewer({ evidence }: { evidence: Evidence[] }) {
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewable = evidence.filter((v) => !v.expired);
  const paired = evidence.length > 1;

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Record<string, { url: string; expiresAt: string }>>('/evidence/urls', { ids: viewable.map((v) => v.id) });
      setUrls(Object.fromEntries(Object.entries(data).map(([id, v]) => [id, v.url])));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function failed() {
    setUrls(null);
    setError('The signed link expired or access was denied. Request it again.');
  }

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-4', paired && 'md:grid-cols-5')}>
        {evidence.map((v) => {
          const isFace = v.evidenceType === 'FACE';
          const src = urls?.[v.id];
          return (
            <figure key={v.id} className={cn('space-y-2', paired && (isFace ? 'md:col-span-2' : 'md:col-span-3'))}>
              <div className={cn('relative flex items-center justify-center overflow-hidden rounded-lg border border-ink-700 bg-ink-950', isFace ? 'aspect-square' : paired ? 'aspect-video md:aspect-[3/2]' : 'aspect-video')}>
                {v.expired ? (
                  <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-ink-400">
                    <ImageOff className="h-6 w-6" /> Expired under the retention policy
                  </div>
                ) : src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={EVIDENCE_LABELS[v.evidenceType] ?? 'Detection evidence'} className="h-full w-full object-contain" onError={failed} />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-4 text-ink-400">
                    {loading ? <Spinner /> : <Lock className="h-6 w-6" />}
                  </div>
                )}
              </div>
              <figcaption className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-ink-200">{EVIDENCE_LABELS[v.evidenceType] ?? v.evidenceType}</span>
                <span className="font-mono text-ink-500" title={`SHA-256 ${v.contentHash}`}>
                  SHA-256 {v.contentHash.slice(0, 12)}…
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {!urls && viewable.length > 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-700 p-4 text-center">
          <p className="max-w-sm text-xs text-ink-400">{error ?? 'Evidence is encrypted. Access is logged in the audit trail.'}</p>
          <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => void reveal()} loading={loading}>
            View evidence
          </Button>
        </div>
      )}
    </div>
  );
}

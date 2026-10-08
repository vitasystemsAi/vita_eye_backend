'use client';

import { ImageIcon, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EventTypeBadge, ReviewBadge } from '@/components/badges';
import { EvidenceLightbox, EvidenceThumb, useEvidenceImages } from '@/components/events/EvidenceThumbnails';
import { EmptyState, LoadingBlock } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtRelative, fmtScore } from '@/lib/format';
import type { EventSummary } from '@/lib/types';

export function EventsTable({ events, loading, compact, emptyText = 'No detection events match these filters.', highlight }: { events: EventSummary[]; loading?: boolean; compact?: boolean; emptyText?: string; highlight?: Set<string> }) {
  const { can } = useAuth();
  const canViewEvidence = can('evidence:view');
  const images = useEvidenceImages(events, canViewEvidence);
  const [viewing, setViewing] = useState<EventSummary | null>(null);

  if (loading && !events.length) return <LoadingBlock />;
  if (!events.length) return <EmptyState icon={<Inbox className="h-6 w-6" />} title={emptyText} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-ink-700/70">
          <tr>
            {canViewEvidence && <th className="table-head">Evidence</th>}
            <th className="table-head">Time</th>
            <th className="table-head">Classification</th>
            {!compact && <th className="table-head">Person</th>}
            <th className="table-head">Camera</th>
            <th className="table-head">Similarity</th>
            <th className="table-head">Review</th>
            {!canViewEvidence && <th className="table-head sr-only">Evidence</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {events.map((e) => (
            <tr key={e.id} className={`transition hover:bg-ink-800/40 ${highlight?.has(e.id) ? 'bg-brand-500/10' : ''}`}>
              {canViewEvidence && (
                <td className="table-cell py-2">
                  <EvidenceThumb event={e} image={e.evidenceId ? images[e.evidenceId] : undefined} onOpen={() => setViewing(e)} />
                </td>
              )}
              <td className="table-cell whitespace-nowrap">
                <Link href={`/events/${e.id}`} className="text-brand-300 hover:text-brand-200" title={fmtDateTime(e.eventTimestamp)}>
                  {fmtDateTime(e.eventTimestamp)}
                </Link>
                <p className="text-[11px] text-ink-400">{fmtRelative(e.eventTimestamp)}</p>
              </td>
              <td className="table-cell">
                <EventTypeBadge type={e.eventType} />
              </td>
              {!compact && (
                <td className="table-cell">
                  {e.person ? (
                    <span className={e.person.deleted ? 'text-ink-400 line-through' : ''}>
                      {e.person.name}
                      {e.person.referenceId && <span className="ml-1 font-mono text-xs text-ink-400">{e.person.referenceId}</span>}
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </td>
              )}
              <td className="table-cell">
                <p>{e.camera?.name ?? '—'}</p>
                <p className="text-xs text-ink-400">
                  {e.camera?.location}
                  {e.camera?.site ? ` · ${e.camera.site}` : ''}
                </p>
              </td>
              <td className="table-cell tabular-nums">{fmtScore(e.confidenceScore)}</td>
              <td className="table-cell">{e.eventType === 'KNOWN' && e.reviewStatus === 'RESOLVED' ? <span className="text-xs text-ink-400">Auto-resolved</span> : <ReviewBadge status={e.reviewStatus} />}</td>
              {!canViewEvidence && <td className="table-cell">{e.hasEvidence && <ImageIcon className="h-4 w-4 text-ink-400" aria-label="Has evidence" />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <EvidenceLightbox event={viewing} image={viewing?.evidenceId ? images[viewing.evidenceId] : undefined} onClose={() => setViewing(null)} />
    </div>
  );
}

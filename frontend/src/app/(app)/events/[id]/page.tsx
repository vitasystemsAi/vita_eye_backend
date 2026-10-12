'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, FileText, MessageSquarePlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { EventTypeBadge, ReviewBadge } from '@/components/badges';
import { EvidenceViewer } from '@/components/events/EvidenceImage';
import { RESOLUTIONS, ReviewActions } from '@/components/events/ReviewActions';
import { RequirePermission } from '@/components/RequirePermission';
import { Button, Card, ErrorBanner, KeyValue, LoadingBlock, PageHeader, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtPercent, fmtScore, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { EventDetail } from '@/lib/types';

const noteSchema = z.object({ note: z.string().trim().min(1, 'Write a note').max(2000) });

function EventDetailView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const notify = useToast();
  const { data: e, error, loading, reload, setData } = useApi<EventDetail>(`/events/${id}`);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ note: string }>({ resolver: zodResolver(noteSchema) });

  useSocketEvent<{ id: string }>('event:updated', (u) => u.id === id && void reload());

  if (loading && !e) return <LoadingBlock />;
  if (!e) return <ErrorBanner error={error ?? { message: 'Event not found' }} onRetry={reload} />;

  async function addNote(v: { note: string }) {
    try {
      const { data } = await api.post<EventDetail>(`/events/${id}/notes`, v);
      setData(() => data);
      reset({ note: '' });
    } catch (err) {
      notify('error', 'Could not add note', errorMessage(err));
    }
  }

  const resolutionLabel = e.resolution === 'AUTO_KNOWN' ? 'Automatically resolved (registered person)' : RESOLUTIONS.find(([v]) => v === e.resolution)?.[1] ?? humanize(e.resolution);

  return (
    <>
      <PageHeader
        title={e.eventType === 'UNKNOWN' ? 'Unrecognized person detection' : e.eventType === 'UNCERTAIN' ? 'Uncertain match' : 'Registered person detected'}
        icon={<FileText className="h-5 w-5" />}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <EventTypeBadge type={e.eventType} />
            <ReviewBadge status={e.reviewStatus} />
            <span className="font-mono text-xs text-ink-400">{e.id}</span>
          </span>
        }
        actions={
          <>
            <Link href="/events">
              <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                History
              </Button>
            </Link>
            {can('events:review') && <ReviewActions event={e} onChange={(d) => setData(() => d)} />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card title="Evidence" className="xl:col-span-3" description={e.evidence[0] ? `Encrypted at rest · expires ${fmtDateTime(e.evidence[0].expiresAt)}` : undefined}>
          <div className="p-5">
            {e.eventType === 'KNOWN' || e.evidence.length === 0 ? (
              <p className="text-sm text-ink-400">
                {e.eventType === 'KNOWN' ? 'Evidence images are not stored for a registered person.' : 'No evidence image was captured for this event.'}
              </p>
            ) : can('evidence:view') ? (
              <EvidenceViewer evidence={e.evidence} />
            ) : (
              <p className="text-sm text-ink-400">Your role cannot view evidence images.</p>
            )}
          </div>
        </Card>
        <Card title="Details" className="xl:col-span-2">
          <div className="p-5">
            <KeyValue
              items={[
                ['Detected at', fmtDateTime(e.eventTimestamp)],
                ['Camera', e.camera ? `${e.camera.name}` : '—'],
                ['Location', e.camera ? `${e.camera.location}${e.camera.site ? ` · ${e.camera.site}` : ''}` : '—'],
                ['Person', e.person ? (
                  can('persons:view') ? <Link href={`/persons/${e.person.id}`} className="text-brand-300">{e.person.name}{e.person.deleted ? ' (deleted)' : ''}</Link> : e.person.name
                ) : 'No gallery match'],
                ['Similarity', fmtScore(e.confidenceScore, 3)],
                ['Face quality', fmtPercent(e.qualityScore)],
                ['Frames verified', e.framesObserved],
                ['Model', e.modelVersion],
                ['Acknowledged', e.acknowledgedBy ? `${e.acknowledgedBy.name} · ${fmtDateTime(e.acknowledgedAt)}` : '—'],
                ['Resolved', e.resolvedBy ? `${e.resolvedBy.name} · ${fmtDateTime(e.resolvedAt)}` : e.resolution === 'AUTO_KNOWN' ? 'System' : '—'],
                ['Resolution', e.resolution ? resolutionLabel : '—'],
              ]}
            />
          </div>
        </Card>
      </div>
      <Card title="Investigation notes" className="mt-6">
        <ul className="divide-y divide-ink-800">
          {e.notes.length === 0 && <li className="px-5 py-5 text-sm text-ink-400">No notes yet.</li>}
          {e.notes.map((n) => (
            <li key={n.id} className="px-5 py-3">
              <p className="text-sm whitespace-pre-wrap text-ink-100">{n.note}</p>
              <p className="mt-1 text-xs text-ink-400">
                {n.author?.name ?? 'Unknown'} · {fmtDateTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        {can('events:review') && (
          <form onSubmit={handleSubmit(addNote)} className="space-y-3 border-t border-ink-700/70 p-5">
            <Textarea placeholder="Add a factual note (what was checked, who verified, outcome)" {...register('note')} />
            {errors.note && <p className="text-xs text-red-400">{errors.note.message}</p>}
            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting} icon={<MessageSquarePlus className="h-4 w-4" />}>
                Add note
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}

export default function EventDetailPage() {
  return (
    <RequirePermission permission="events:view">
      <EventDetailView />
    </RequirePermission>
  );
}

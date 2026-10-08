'use client';

import { ExternalLink, ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EventTypeBadge } from '@/components/badges';
import { cn } from '@/components/ui/cn';
import { Modal, Spinner } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { EventSummary } from '@/lib/types';

const BATCH = 50;

type ImageState = string | 'error';

/**
 * Loads evidence snapshots for a list of events. Signed URLs are requested in one audited batch and
 * the decrypted images are held as blob URLs, so they survive the short signed-link TTL.
 */
export function useEvidenceImages(events: EventSummary[], enabled: boolean): Record<string, ImageState> {
  const [images, setImages] = useState<Record<string, ImageState>>({});
  const requested = useRef(new Set<string>());
  const blobs = useRef<string[]>([]);
  const mounted = useRef(true);

  const key = useMemo(
    () => (enabled ? events.filter((e) => e.evidenceId && !e.evidenceExpired).map((e) => e.evidenceId as string).join(',') : ''),
    [events, enabled],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      blobs.current.forEach((u) => URL.revokeObjectURL(u));
      blobs.current = [];
    };
  }, []);

  useEffect(() => {
    const pending = key ? key.split(',').filter((id) => !requested.current.has(id)) : [];
    if (!pending.length) return;
    pending.forEach((id) => requested.current.add(id));
    const mark = (entries: Record<string, ImageState>) => mounted.current && setImages((m) => ({ ...m, ...entries }));

    async function loadOne(id: string, url: string | undefined) {
      if (!url) return mark({ [id]: 'error' });
      try {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const blobUrl = URL.createObjectURL(await res.blob());
        if (!mounted.current) return URL.revokeObjectURL(blobUrl);
        blobs.current.push(blobUrl);
        mark({ [id]: blobUrl });
      } catch {
        mark({ [id]: 'error' });
      }
    }

    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      api
        .get<Record<string, { url: string; expiresAt: string }>>('/evidence/urls', { ids: chunk })
        .then(({ data }) => Promise.all(chunk.map((id) => loadOne(id, data[id]?.url))))
        .catch(() => {
          chunk.forEach((id) => requested.current.delete(id));
          mark(Object.fromEntries(chunk.map((id) => [id, 'error' as const])));
        });
    }
  }, [key]);

  return images;
}

export function EvidenceThumb({ event, image, onOpen }: { event: EventSummary; image: ImageState | undefined; onOpen: () => void }) {
  if (!event.evidenceId) return <span className="text-xs text-ink-500">—</span>;
  const box = cn('flex h-12 items-center justify-center overflow-hidden rounded-md border border-ink-700 bg-ink-950', event.faceEvidenceId ? 'w-12' : 'w-20');
  if (event.evidenceExpired || image === 'error') {
    return (
      <div className={box} title={event.evidenceExpired ? 'Evidence expired under the retention policy' : 'Evidence could not be loaded'}>
        <ImageOff className="h-4 w-4 text-ink-500" />
      </div>
    );
  }
  if (!image) return <div className={`${box} animate-pulse`} aria-label="Loading evidence" />;
  return (
    <button type="button" onClick={onOpen} className={`${box} transition hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`} title="View evidence">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="Detection evidence thumbnail" className="h-full w-full object-cover" />
    </button>
  );
}

function useSceneImage(event: EventSummary | null): ImageState | undefined {
  const sceneId = event?.faceEvidenceId && event.sceneEvidenceId ? event.sceneEvidenceId : null;
  const [scene, setScene] = useState<{ id: string; src: ImageState } | null>(null);
  useEffect(() => {
    if (!sceneId) return;
    let cancelled = false;
    api
      .get<{ url: string; expiresAt: string }>(`/evidence/${sceneId}/url`)
      .then(({ data }) => !cancelled && setScene({ id: sceneId, src: data.url }))
      .catch(() => !cancelled && setScene({ id: sceneId, src: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [sceneId]);
  return sceneId && scene?.id === sceneId ? scene.src : undefined;
}

function Tile({ label, src, className }: { label: string; src: ImageState | undefined; className: string }) {
  return (
    <figure className="space-y-1.5">
      <div className={cn('flex items-center justify-center overflow-hidden rounded-lg border border-ink-700 bg-ink-950', className)}>
        {src === 'error' ? (
          <span className="flex items-center gap-2 text-xs text-ink-400">
            <ImageOff className="h-4 w-4" /> Could not load
          </span>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="h-full w-full object-contain" />
        ) : (
          <Spinner />
        )}
      </div>
      <figcaption className="text-xs font-medium text-ink-300">{label}</figcaption>
    </figure>
  );
}

export function EvidenceLightbox({ event, image, onClose }: { event: EventSummary | null; image: ImageState | undefined; onClose: () => void }) {
  const scene = useSceneImage(event);
  const paired = !!event?.faceEvidenceId && !!event.sceneEvidenceId;
  return (
    <Modal
      open={!!event && !!image && image !== 'error'}
      onClose={onClose}
      size="xl"
      title={
        event && (
          <span className="flex items-center gap-3">
            Detection evidence <EventTypeBadge type={event.eventType} />
          </span>
        )
      }
      footer={
        event && (
          <Link href={`/events/${event.id}`} className="inline-flex items-center gap-1.5 text-sm text-brand-300 hover:text-brand-200">
            Open event details <ExternalLink className="h-4 w-4" />
          </Link>
        )
      }
    >
      {event && image && image !== 'error' && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Detection evidence" className="mx-auto max-h-[70vh] w-full object-contain" />
          </div>
          <p className="text-xs text-ink-400">
            {fmtDateTime(event.eventTimestamp)} · {event.camera?.name ?? 'Unknown camera'}
            {event.camera?.location ? ` · ${event.camera.location}` : ''}
            {event.person ? ` · ${event.person.name}` : ''}
            {' · '}Access to evidence is recorded in the audit log.
          </p>
        </div>
      )}
    </Modal>
  );
}

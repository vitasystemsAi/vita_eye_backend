'use client';

import { useEffect, useState } from 'react';
import { fmtDateTime, fmtPercent } from '@/lib/format';
import type { PersonDetail } from '@/lib/types';

type Template = PersonDetail['templates'][number];

export function EnrolledFaces({
  personId,
  templates,
  highlightId,
}: {
  personId: string;
  templates: Template[];
  highlightId?: string | null;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const key = templates.map((t) => `${t.id}:${t.hasPhoto ? 1 : 0}`).join(',');

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    const withPhoto = templates.filter((t) => t.hasPhoto);
    setReady(false);
    if (!withPhoto.length) {
      setUrls({});
      setReady(true);
      return;
    }
    void (async () => {
      const next: Record<string, string> = {};
      for (const template of withPhoto) {
        try {
          const res = await fetch(`/api/v1/persons/${personId}/faces/${template.id}`, { credentials: 'same-origin', cache: 'no-store' });
          if (!res.ok) continue;
          const url = URL.createObjectURL(await res.blob());
          if (!alive) {
            URL.revokeObjectURL(url);
            continue;
          }
          created.push(url);
          next[template.id] = url;
        } catch {
          /* leave a placeholder for this face */
        }
      }
      if (alive) {
        setUrls(next);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
      created.forEach((url) => URL.revokeObjectURL(url));
      setUrls({});
    };
    // key captures the template ids that should reload photos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, key]);

  if (!templates.length) {
    return <p className="text-sm text-ink-400">No faces enrolled yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {templates.map((template, index) => {
        const src = urls[template.id];
        const highlighted = highlightId === template.id;
        return (
          <li key={template.id} className={`overflow-hidden rounded-lg border bg-ink-900 ${highlighted ? 'border-red-400 ring-2 ring-red-400/60' : 'border-ink-700'}`}>
            <div className="aspect-[3/4] bg-ink-850">
              {src ? (
                <img src={src} alt={`Enrolled face ${index + 1}`} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-2 text-center text-xs text-ink-500">
                  {template.hasPhoto && !ready ? 'Loading photo…' : template.hasPhoto ? 'Photo unavailable' : 'No photo stored'}
                </div>
              )}
            </div>
            <div className="px-2 py-1.5 text-xs text-ink-300">
              <p className="font-medium text-ink-100">{highlighted ? 'Matching face' : `Face ${index + 1}`}</p>
              <p>Quality {fmtPercent(template.qualityScore)}</p>
              {template.createdAt ? <p className="text-ink-500">{fmtDateTime(template.createdAt)}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

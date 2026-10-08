'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Eye, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Modal, Select, Textarea } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import type { EventDetail } from '@/lib/types';

export const RESOLUTIONS: Array<[string, string]> = [
  ['AUTHORIZED_VISITOR', 'Authorized visitor'],
  ['EMPLOYEE_NOT_ENROLLED', 'Employee / member not yet enrolled'],
  ['FALSE_DETECTION', 'False detection (not a face / mis-match)'],
  ['NO_ACTION_REQUIRED', 'No action required'],
  ['ESCALATED', 'Escalated to security staff for in-person verification'],
  ['OTHER', 'Other (explain in note)'],
];

const resolveSchema = z
  .object({ resolution: z.enum(['AUTHORIZED_VISITOR', 'EMPLOYEE_NOT_ENROLLED', 'FALSE_DETECTION', 'ESCALATED', 'NO_ACTION_REQUIRED', 'OTHER']), note: z.string().trim().max(2000) })
  .refine((v) => v.resolution !== 'OTHER' || v.note.length >= 5, { message: 'Explain the outcome when choosing Other', path: ['note'] });
type ResolveValues = z.infer<typeof resolveSchema>;

export function ReviewActions({ event, onChange }: { event: EventDetail; onChange: (e: EventDetail) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResolveValues>({ resolver: zodResolver(resolveSchema), defaultValues: { resolution: 'NO_ACTION_REQUIRED', note: '' } });

  async function act(action: 'acknowledge' | 'investigate' | 'reopen') {
    setBusy(action);
    try {
      const { data } = await api.post<EventDetail>(`/events/${event.id}/${action}`, {});
      onChange(data);
      notify('success', { acknowledge: 'Event acknowledged', investigate: 'Marked as investigating', reopen: 'Event reopened' }[action]);
    } catch (err) {
      notify('error', 'Action failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function resolve(v: ResolveValues) {
    try {
      const { data } = await api.post<EventDetail>(`/events/${event.id}/resolve`, { resolution: v.resolution, note: v.note || undefined });
      onChange(data);
      setResolving(false);
      reset();
      notify('success', 'Event resolved');
    } catch (err) {
      notify('error', 'Resolve failed', errorMessage(err));
    }
  }

  const s = event.reviewStatus;
  return (
    <div className="flex flex-wrap gap-2">
      {s === 'NEW' && (
        <Button variant="secondary" icon={<Eye className="h-4 w-4" />} loading={busy === 'acknowledge'} onClick={() => void act('acknowledge')}>
          Acknowledge
        </Button>
      )}
      {(s === 'NEW' || s === 'ACKNOWLEDGED') && (
        <Button variant="warning" icon={<Search className="h-4 w-4" />} loading={busy === 'investigate'} onClick={() => void act('investigate')}>
          Investigate
        </Button>
      )}
      {s !== 'RESOLVED' && (
        <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setResolving(true)}>
          Resolve
        </Button>
      )}
      {s === 'RESOLVED' && event.eventType !== 'KNOWN' && (
        <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'reopen'} onClick={() => void act('reopen')}>
          Reopen
        </Button>
      )}
      <Modal
        open={resolving}
        onClose={() => setResolving(false)}
        title="Resolve event"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(resolve)} loading={isSubmitting}>
              Resolve
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit(resolve)}>
          <Field label="Outcome" error={errors.resolution?.message}>
            <Select {...register('resolution')}>
              {RESOLUTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)" error={errors.note?.message}>
            <Textarea placeholder="What was verified and by whom" {...register('note')} />
          </Field>
          <p className="text-xs text-ink-400">A face recognition result alone is not proof of identity or intent. Record what was verified in person.</p>
        </form>
      </Modal>
    </div>
  );
}

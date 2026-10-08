'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import type { Camera, CameraType } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const schema = z
  .object({
    cameraName: z.string().trim().min(2, 'At least 2 characters').max(120),
    cameraType: z.enum(['BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG']),
    location: z.string().trim().min(2, 'At least 2 characters').max(160),
    site: z.string().trim().max(120),
    streamUrl: z.string().trim().max(512),
    username: z.string().max(128),
    password: z.string().max(256),
    clearCredentials: z.boolean(),
    samplingFps: z.number({ error: 'Enter a number' }).min(0.2).max(15),
    scheduleEnabled: z.boolean(),
    days: z.array(z.number()),
    start: hhmm,
    end: hhmm,
    timezone: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.streamUrl && /^[a-z]+:\/\/[^/]*@/i.test(v.streamUrl)) {
      ctx.addIssue({ code: 'custom', path: ['streamUrl'], message: 'Do not put credentials in the URL — use the username/password fields' });
    }
    if (v.scheduleEnabled && v.days.length === 0) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Select at least one day' });
  });
type FormValues = z.infer<typeof schema>;

export interface CameraPayload {
  cameraName: string;
  cameraType?: CameraType;
  location: string;
  site: string | null;
  streamUrl?: string;
  username?: string;
  password?: string;
  clearCredentials?: boolean;
  samplingFps: number;
  schedule: { enabled: boolean; days: number[]; start: string; end: string; timezone: string } | null;
}

export function CameraForm({ camera, onSubmit, onCancel }: { camera?: Camera; onSubmit: (p: CameraPayload) => Promise<void>; onCancel: () => void }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cameraName: camera?.cameraName ?? '',
      cameraType: camera?.cameraType ?? 'BROWSER',
      location: camera?.location ?? '',
      site: camera?.site ?? '',
      streamUrl: '',
      username: '',
      password: '',
      clearCredentials: false,
      samplingFps: camera?.samplingFps ?? 8,
      scheduleEnabled: camera?.schedule?.enabled ?? false,
      days: camera?.schedule?.days ?? [1, 2, 3, 4, 5],
      start: camera?.schedule?.start ?? '08:00',
      end: camera?.schedule?.end ?? '20:00',
      timezone: camera?.schedule?.timezone ?? tz,
    },
  });
  const type = useWatch({ control, name: 'cameraType' });
  const scheduleEnabled = useWatch({ control, name: 'scheduleEnabled' });
  const days = useWatch({ control, name: 'days' });
  const network = type !== 'BROWSER';

  async function submit(v: FormValues) {
    if (network && !camera && !v.streamUrl) {
      setError('streamUrl', { message: 'Stream URL is required for network cameras' });
      return;
    }
    const payload: CameraPayload = {
      cameraName: v.cameraName,
      location: v.location,
      site: v.site || null,
      samplingFps: v.samplingFps,
      schedule: v.scheduleEnabled ? { enabled: true, days: v.days, start: v.start, end: v.end, timezone: v.timezone } : camera?.schedule ? { ...camera.schedule, enabled: false } : null,
    };
    if (!camera) payload.cameraType = v.cameraType;
    if (network) {
      if (v.streamUrl) payload.streamUrl = v.streamUrl;
      if (v.clearCredentials) payload.clearCredentials = true;
      else if (v.username) {
        payload.username = v.username;
        payload.password = v.password;
      }
    }
    try {
      await onSubmit(payload);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        for (const [k, m] of Object.entries(fields)) setError(k as keyof FormValues, { message: m });
        if (!Object.keys(fields).length) setError('root', { message: err.message });
      } else setError('root', { message: 'Save failed' });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Camera name" error={errors.cameraName?.message}>
          <Input {...register('cameraName')} placeholder="Main entrance" />
        </Field>
        <Field label="Type" error={errors.cameraType?.message} hint={camera ? 'Type cannot be changed after creation' : undefined}>
          <Select {...register('cameraType')} disabled={Boolean(camera)}>
            <option value="BROWSER">Browser / laptop webcam (operator device)</option>
            <option value="RTSP">IP camera — RTSP</option>
            <option value="ONVIF">ONVIF camera (RTSP profile URL)</option>
            <option value="HTTP_MJPEG">HTTP MJPEG stream</option>
          </Select>
        </Field>
        <Field label="Location" error={errors.location?.message}>
          <Input {...register('location')} placeholder="Lobby, ground floor" />
        </Field>
        <Field label="Site" error={errors.site?.message} hint="Used for site-scoped access and alert routing">
          <Input {...register('site')} placeholder="HQ" />
        </Field>
      </div>

      {network && (
        <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <Field
            label={camera ? 'New stream URL (leave blank to keep current)' : 'Stream URL'}
            error={errors.streamUrl?.message}
            hint={camera?.streamReference ? `Current: ${camera.streamReference}` : type === 'HTTP_MJPEG' ? 'http(s)://192.168.1.20/video.mjpg' : 'rtsp://192.168.1.20:554/stream1 — host must be inside the approved camera networks'}
          >
            <Input {...register('streamUrl')} className="font-mono" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Username" error={errors.username?.message} hint={camera?.hasCredentials ? 'Stored encrypted — leave blank to keep' : 'Stored encrypted (AES-256-GCM)'}>
              <Input {...register('username')} autoComplete="off" />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <Input type="password" {...register('password')} autoComplete="new-password" />
            </Field>
          </div>
          {camera?.hasCredentials && (
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('clearCredentials')} /> Remove stored credentials
            </label>
          )}
          <p className="text-xs text-ink-400">Credentials are never returned to the browser and are only sent to the internal recognition service.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Sampling rate (frames / second)" error={errors.samplingFps?.message} hint="0.2–15. 8+ fps catches people walking past quickly; lower rates save CPU.">
          <Input type="number" step="0.1" min="0.2" max="15" {...register('samplingFps', { valueAsNumber: true })} />
        </Field>
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850/60 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-100">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('scheduleEnabled')} /> Restrict monitoring to a schedule
        </label>
        {scheduleEnabled && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="label">Days</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setValue('days', on ? days.filter((x) => x !== i) : [...days, i].sort(), { shouldValidate: true })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ${on ? 'bg-brand-600/20 text-brand-300 ring-brand-500/40' : 'text-ink-300 ring-ink-600'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              {errors.days && <p className="mt-1 text-xs text-red-400">{errors.days.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Start" error={errors.start?.message}>
                <Input type="time" {...register('start')} />
              </Field>
              <Field label="End" error={errors.end?.message} hint="End before start = overnight window">
                <Input type="time" {...register('end')} />
              </Field>
              <Field label="Time zone" error={errors.timezone?.message}>
                <Input {...register('timezone')} />
              </Field>
            </div>
          </div>
        )}
      </div>

      {errors.root && <p className="text-sm text-red-300">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {camera ? 'Save changes' : 'Add camera'}
        </Button>
      </div>
    </form>
  );
}

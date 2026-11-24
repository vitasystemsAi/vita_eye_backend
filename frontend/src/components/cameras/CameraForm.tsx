'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input, PasswordInput, Select } from '@/components/ui/primitives';
import { ApiError, api, errorMessage } from '@/lib/api';
import { listVideoInputs, splitVideoInputs } from '@/lib/usbCameras';
import type { Camera, CameraType } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const LAN_DEFAULTS = {
  rtsp: { port: '554', path: '/stream1' },
  rtsps: { port: '554', path: '/stream1' },
  onvif: { port: '554', path: '/stream1' },
  http: { port: '80', path: '/video' },
} as const;
type LanProtocol = keyof typeof LAN_DEFAULTS;

function splitLan(reference: string | null | undefined): { lanProtocol: LanProtocol; lanHost: string; lanPort: string; lanPath: string } {
  const fallback = { lanProtocol: 'rtsp' as const, lanHost: '', lanPort: LAN_DEFAULTS.rtsp.port, lanPath: LAN_DEFAULTS.rtsp.path };
  if (!reference) return fallback;
  try {
    const url = new URL(reference);
    const lanProtocol: LanProtocol =
      url.protocol === 'http:' || url.protocol === 'https:' ? 'http' : url.protocol === 'rtsps:' ? 'rtsps' : url.pathname.toLowerCase().includes('onvif') ? 'onvif' : 'rtsp';
    return {
      lanProtocol,
      lanHost: url.hostname,
      lanPort: url.port || LAN_DEFAULTS[lanProtocol].port,
      lanPath: `${url.pathname}${url.search}` || LAN_DEFAULTS[lanProtocol].path,
    };
  } catch {
    return fallback;
  }
}

function UsbCameraPreview({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        if (videoRef.current) videoRef.current.srcObject = opened;
      })
      .catch(() => {
        if (!cancelled) setError('This camera did not open. Unplug the cable, plug it back in, and detect again.');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId]);
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-black">
      <video ref={videoRef} autoPlay playsInline muted className={`aspect-video w-full object-contain ${error ? 'hidden' : ''}`} />
      {error ? <p className="px-3 py-6 text-center text-xs text-amber-300">{error}</p> : <p className="px-3 py-1.5 text-[11px] text-ink-400">Live preview of the selected USB camera</p>}
    </div>
  );
}

type LanDiscover = { cameras: Array<{ ip: string; name: string; streamUrl: string; source: 'onvif' | 'rtsp' | 'http' }>; computerAddresses?: string[]; notice?: string | null };

/** The PC with the cable answers on localhost. A page opened from another computer falls back to that computer's server. */
async function discoverFromThisComputer(): Promise<LanDiscover> {
  try {
    const local = await fetch('http://127.0.0.1:47915/discover', { method: 'POST', signal: AbortSignal.timeout(55000) });
    if (local.ok) return (await local.json()) as LanDiscover;
  } catch {
    /* Vita Eye is not running on the PC where this browser is open. */
  }
  const { data } = await api.post<LanDiscover>('/cameras/discover-lan-port', {}, { signal: AbortSignal.timeout(55000) });
  return data;
}

function lanStreamUrl(protocol: LanProtocol, host: string, port: string, path: string): string {
  const defaults = LAN_DEFAULTS[protocol];
  const scheme = protocol === 'http' ? 'http' : protocol === 'rtsps' ? 'rtsps' : 'rtsp';
  let cleanPath = path.trim() || defaults.path;
  if (!cleanPath.startsWith('/')) cleanPath = `/${cleanPath}`;
  return `${scheme}://${host.trim()}:${port.trim() || defaults.port}${cleanPath}`;
}

const schema = z
  .object({
    cameraName: z.string().trim().min(2, 'At least 2 characters').max(120),
    cameraType: z.enum(['BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN', 'LAN_PORT']),
    location: z.string().trim().min(2, 'At least 2 characters').max(160),
    site: z.string().trim().max(120),
    streamUrl: z.string().trim().max(512),
    usbDeviceId: z.string().trim().max(512),
    lanPortUrl: z.string().trim().max(512),
    lanProtocol: z.enum(['rtsp', 'rtsps', 'onvif', 'http']),
    lanHost: z.string().trim().max(253),
    lanPort: z.string().trim().max(5),
    lanPath: z.string().trim().max(200),
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
    if (v.cameraType === 'LAN' && v.lanHost) {
      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(v.lanHost);
      const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(v.lanHost);
      if (!ipv4 && !hostname) {
        ctx.addIssue({ code: 'custom', path: ['lanHost'], message: 'Enter the camera IP address, for example 192.168.1.64' });
      } else if (ipv4 && v.lanHost.split('.').some((part) => Number(part) > 255)) {
        ctx.addIssue({ code: 'custom', path: ['lanHost'], message: 'Enter a valid IPv4 address' });
      }
      const port = Number(v.lanPort || LAN_DEFAULTS[v.lanProtocol].port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        ctx.addIssue({ code: 'custom', path: ['lanPort'], message: 'Enter a port from 1 to 65535' });
      }
      if (v.lanPath && !v.lanPath.startsWith('/')) {
        ctx.addIssue({ code: 'custom', path: ['lanPath'], message: 'Path must start with /' });
      }
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
  /** Addresses chosen from CP Plus auto-detect. The server adds each one and starts monitoring. */
  cpPlusIps?: string[];
}

export function CameraForm({ camera, onSubmit, onCancel }: { camera?: Camera; onSubmit: (p: CameraPayload) => Promise<void>; onCancel: () => void }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lanInitial = splitLan(camera?.cameraType === 'LAN' ? camera.streamReference : null);
  const [usbDevices, setUsbDevices] = useState<MediaDeviceInfo[]>([]);
  const [skippedLaptops, setSkippedLaptops] = useState<string[]>([]);
  const [usbNotice, setUsbNotice] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [lanCameras, setLanCameras] = useState<Array<{ ip: string; name: string; streamUrl: string; source: 'onvif' | 'rtsp' | 'http' }>>([]);
  const [selectedIps, setSelectedIps] = useState<string[]>([]);
  const [lanNotice, setLanNotice] = useState<string | null>(null);
  const [findingLan, setFindingLan] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewSteps, setPreviewSteps] = useState<Array<{ title: string; detail: string; state: 'run' | 'ok' | 'fail' | 'pause' }>>([]);
  const [checkpoint, setCheckpoint] = useState<{ message: string; nextPath: string | null } | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const previewSession = useRef<string | null>(null);
  const previewBase = useRef('');
  const previewWatch = useRef(0);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    trigger,
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
      usbDeviceId: camera?.cameraType === 'USB' ? (camera.streamReference ?? '') : '',
      lanPortUrl: camera?.cameraType === 'LAN_PORT' ? (camera.streamReference ?? '') : '',
      lanProtocol: lanInitial.lanProtocol,
      lanHost: lanInitial.lanHost,
      lanPort: lanInitial.lanPort,
      lanPath: lanInitial.lanPath,
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
  const directUrl = type === 'RTSP' || type === 'ONVIF' || type === 'HTTP_MJPEG';
  const usbDeviceId = useWatch({ control, name: 'usbDeviceId' });
  const lanPortUrl = useWatch({ control, name: 'lanPortUrl' });
  useEffect(() => {
    if (!camera && type === 'LAN_PORT' && !getValues('cameraName').trim()) setValue('cameraName', 'CP Plus');
  }, [camera, type, getValues, setValue]);
  const lanProtocolField = register('lanProtocol');

  async function detectUsb() {
    setUsbNotice(null);
    setDetecting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setUsbNotice('Detection needs this page on localhost or HTTPS.');
        return;
      }
      const all = await listVideoInputs();
      const { cable, laptops } = splitVideoInputs(all);
      setUsbDevices(cable);
      setSkippedLaptops(laptops.map((device) => device.label || 'Laptop camera'));
      if (!cable.length) {
        setPreviewId('');
        setValue('usbDeviceId', '');
        setUsbNotice(
          laptops.length
            ? `Only the laptop camera was found (${laptops.map((device) => device.label || 'built-in camera').join(', ')}). Plug the USB or USB-C camera in and detect again.`
            : 'No USB or USB-C camera was found. Plug the cable in and detect again.',
        );
        return;
      }
      const current = getValues('usbDeviceId');
      const keep = cable.some((device) => device.deviceId === current) ? current : (cable[0] && cable.length === 1 ? cable[0].deviceId : '');
      setValue('usbDeviceId', keep, { shouldValidate: true });
      setPreviewId(keep);
      setUsbNotice(cable.length > 1 ? `${cable.length} USB cameras found. Select the one you want and check its preview.` : null);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setUsbNotice(name === 'NotAllowedError' ? 'Allow camera access in the browser, then detect again.' : 'Could not detect a camera. Plug in the USB or USB-C cable and try again.');
    } finally {
      setDetecting(false);
    }
  }

  async function detectLanPort() {
    setLanNotice(null);
    setFindingLan(true);
    try {
      const data = await discoverFromThisComputer();
      setLanCameras(data.cameras);
      setSelectedIps(data.cameras.map((item) => item.ip));
      if (!getValues('cameraName').trim()) setValue('cameraName', data.cameras.length === 1 ? `CP Plus ${data.cameras[0]?.ip ?? ''}`.trim() : 'CP Plus cameras');
      const here = data.computerAddresses?.length ? data.computerAddresses.join(', ') : 'this computer';
      if (data.notice) {
        setLanNotice(data.notice);
        if (!data.cameras.length) return;
      } else if (!data.cameras.length) {
        setLanNotice(`No camera answered on ${here}. Vita Eye must be running on the PC that has the LAN cable. Opening this website from another PC cannot see that cable. Power the camera with the 12V adapter and wait for the link light.`);
        return;
      }
      const current = getValues('lanPortUrl');
      const keep = data.cameras.some((item) => item.streamUrl === current) ? current : (data.cameras[0]?.streamUrl ?? '');
      setValue('lanPortUrl', keep, { shouldValidate: true });
      setLanNotice(data.cameras.length > 1 ? `${data.cameras.length} cameras found. Select the one plugged into this computer.` : 'Camera found. Select it, then add it.');
    } catch (err) {
      const name = (err as Error).name;
      setLanNotice(name === 'TimeoutError' || name === 'AbortError' ? 'Detection took too long. Check the Ethernet cable and try again.' : errorMessage(err));
    } finally {
      setFindingLan(false);
    }
  }

  function releasePreview() {
    previewWatch.current += 1;
    const id = previewSession.current;
    previewSession.current = null;
    setPreviewOn(false);
    if (id) void api.post(`/cameras/preview/${id}/stop`, {}).catch(() => undefined);
  }

  useEffect(() => {
    return () => {
      previewWatch.current += 1;
      const id = previewSession.current;
      previewSession.current = null;
      if (id) void api.post(`/cameras/preview/${id}/stop`, {}).catch(() => undefined);
    };
  }, []);

  function applyOpenedUrl(publicUrl: string) {
    const v = getValues();
    if (v.cameraType === 'LAN') {
      const parts = splitLan(publicUrl);
      setValue('lanProtocol', parts.lanProtocol);
      setValue('lanHost', parts.lanHost);
      setValue('lanPort', parts.lanPort);
      setValue('lanPath', parts.lanPath);
    } else if (v.cameraType === 'LAN_PORT') {
      setValue('lanPortUrl', publicUrl, { shouldValidate: true });
    } else {
      setValue('streamUrl', publicUrl);
    }
  }

  async function streamFromForm(): Promise<string | null> {
    const v = getValues();
    if (v.cameraType === 'LAN') {
      if (!v.lanHost.trim()) {
        setError('lanHost', { message: 'Enter the camera IP address on your LAN' });
        return null;
      }
      if (!(await trigger(['lanHost', 'lanPort', 'lanPath']))) return null;
      return lanStreamUrl(v.lanProtocol, v.lanHost, v.lanPort, v.lanPath);
    }
    if (v.cameraType === 'LAN_PORT') {
      const streamUrl = v.lanPortUrl.trim();
      if (!streamUrl) {
        setError('lanPortUrl', { message: 'Detect the LAN port cameras and select one' });
        return null;
      }
      return streamUrl;
    }
    const streamUrl = v.streamUrl.trim() || camera?.streamReference || '';
    if (!streamUrl) {
      setError('streamUrl', { message: 'Stream URL is required for network cameras' });
      return null;
    }
    return streamUrl;
  }

  function previewBody(streamUrl: string, path?: string, secure?: boolean) {
    const v = getValues();
    return {
      cameraId: camera?.id,
      cameraType: v.cameraType,
      streamUrl,
      username: v.username || undefined,
      password: v.password || undefined,
      clearCredentials: v.clearCredentials || undefined,
      path,
      secure: secure || undefined,
    };
  }

  function previewFailure(err: unknown): string {
    if (err instanceof ApiError) return err.fieldErrors().streamUrl || err.message;
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') return 'The camera did not answer in time. Check the IP, port, and path.';
    return errorMessage(err);
  }

  async function watchPreview(sessionId: string) {
    const ticket = previewWatch.current;
    while (previewSession.current === sessionId && ticket === previewWatch.current) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (previewSession.current !== sessionId || ticket !== previewWatch.current) return;
      try {
        const { data } = await api.get<{ frame: string }>(`/cameras/preview/${sessionId}`);
        if (previewSession.current !== sessionId) return;
        setPreviewSrc(`data:image/jpeg;base64,${data.frame}`);
      } catch {
        if (previewSession.current === sessionId) {
          previewSession.current = null;
          void api.post(`/cameras/preview/${sessionId}/stop`, {}).catch(() => undefined);
          setPreviewSteps((current) => [...current, { title: 'Preview stopped', detail: 'The camera closed the picture.', state: 'fail' }]);
        }
        return;
      }
    }
  }

  async function openPicture(streamUrl: string, path: string | undefined, secure: boolean) {
    const { data } = await api.post<{ ok: boolean; error?: string; sessionId?: string; frame?: string; publicUrl?: string }>(
      '/cameras/preview/start',
      previewBody(streamUrl, path, secure),
      { signal: AbortSignal.timeout(25000) },
    );
    if (!data.ok || !data.sessionId || !data.frame) {
      setPreviewSteps((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, state: 'fail', detail: data.error || 'The picture did not open.' };
        return next;
      });
      return false;
    }
    if (data.publicUrl) applyOpenedUrl(data.publicUrl);
    releasePreview();
    previewSession.current = data.sessionId;
    setPreviewOn(true);
    setPreviewSrc(`data:image/jpeg;base64,${data.frame}`);
    setPreviewSteps((current) => {
      const next = current.slice();
      const last = next[next.length - 1];
      if (last) next[next.length - 1] = { ...last, state: 'ok', detail: 'Picture is live. This path will be saved.' };
      return next;
    });
    void watchPreview(data.sessionId);
    return true;
  }

  async function runPreviewStep(streamUrl: string, path?: string) {
    setPreviewSteps((current) => [...current, { title: path || 'Typed address', detail: 'Opening this path with the username and password…', state: 'run' }]);
    setCheckpoint(null);
    const { data } = await api.post<{ decision: 'open' | 'pause' | 'stop'; message: string; path: string; encrypted: boolean; nextPath: string | null }>(
      '/cameras/preview/probe',
      previewBody(streamUrl, path),
      { signal: AbortSignal.timeout(25000) },
    );
    setPreviewSteps((current) => {
      const next = current.slice();
      const last = next[next.length - 1];
      if (last) {
        next[next.length - 1] = {
          title: data.path || last.title,
          detail: data.message,
          state: data.decision === 'open' ? 'ok' : data.decision === 'pause' ? 'pause' : 'fail',
        };
      }
      return next;
    });
    if (data.decision === 'open') {
      const opened = await openPicture(streamUrl, data.path, data.encrypted);
      if (!opened && data.nextPath) setCheckpoint({ message: 'No picture on this path.', nextPath: data.nextPath });
      return;
    }
    if (data.decision === 'pause') setCheckpoint({ message: data.message, nextPath: data.nextPath });
  }

  async function startLivePreview() {
    const streamUrl = await streamFromForm();
    if (!streamUrl) return;
    releasePreview();
    setPreviewSrc(null);
    setCheckpoint(null);
    setPreviewSteps([]);
    previewBase.current = streamUrl;
    setPreviewBusy(true);
    try {
      await runPreviewStep(streamUrl);
    } catch (err) {
      setPreviewSteps([{ title: 'Could not open', detail: previewFailure(err), state: 'fail' }]);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function proceedPreview() {
    const path = checkpoint?.nextPath;
    if (!path || !previewBase.current) return;
    setPreviewBusy(true);
    try {
      await runPreviewStep(previewBase.current, path);
    } catch (err) {
      setPreviewSteps((current) => [...current, { title: path, detail: previewFailure(err), state: 'fail' }]);
    } finally {
      setPreviewBusy(false);
    }
  }

  function interruptPreview() {
    releasePreview();
    setCheckpoint(null);
    setPreviewSteps((current) => [...current, { title: 'Interrupted', detail: 'Stopped. Change the path or the password, then run the preview again.', state: 'pause' }]);
  }

  async function submit(v: FormValues) {
    releasePreview();
    if (directUrl && !camera && !v.streamUrl) {
      setError('streamUrl', { message: 'Stream URL is required for network cameras' });
      return;
    }
    if (v.cameraType === 'USB' && !v.usbDeviceId) {
      setError('usbDeviceId', { message: 'Detect the USB cameras and select the one shown in the preview' });
      return;
    }
    if (!camera && v.cameraType === 'LAN_PORT') {
      if (!v.username.trim()) {
        setError('username', { message: 'Enter the CP Plus username' });
        return;
      }
      if (!v.password) {
        setError('password', { message: 'Enter the CP Plus password' });
        return;
      }
      if (!selectedIps.length) {
        setError('lanPortUrl', { message: 'Auto detect the CP Plus cameras and leave at least one selected' });
        return;
      }
    }
    if (v.cameraType === 'LAN_PORT' && !v.lanPortUrl && camera) {
      setError('lanPortUrl', { message: 'Detect the LAN port cameras and select one' });
      return;
    }
    if (v.cameraType === 'LAN' && !camera && !v.lanHost) {
      setError('lanHost', { message: 'Enter the camera IP address on your LAN' });
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
    if (v.cameraType === 'USB') {
      payload.streamUrl = v.usbDeviceId;
    } else if (v.cameraType === 'LAN') {
      if (v.lanHost) payload.streamUrl = lanStreamUrl(v.lanProtocol, v.lanHost, v.lanPort, v.lanPath);
      if (v.clearCredentials) payload.clearCredentials = true;
      else if (v.username) {
        payload.username = v.username;
        payload.password = v.password;
      }
    } else if (v.cameraType === 'LAN_PORT') {
      if (!camera) {
        payload.cpPlusIps = selectedIps;
        payload.username = v.username;
        payload.password = v.password;
      } else {
        if (v.lanPortUrl) payload.streamUrl = v.lanPortUrl;
        if (v.clearCredentials) payload.clearCredentials = true;
        else if (v.username) {
          payload.username = v.username;
          payload.password = v.password;
        }
      }
    } else if (directUrl) {
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
        for (const [k, m] of Object.entries(fields)) {
          const key = v.cameraType === 'LAN' && k === 'streamUrl' ? 'lanHost' : v.cameraType === 'LAN_PORT' && k === 'streamUrl' ? 'lanPortUrl' : k;
          setError(key as keyof FormValues, { message: m });
        }
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
            <option value="USB">USB / USB-C cable camera</option>
            <option value="LAN">LAN port camera (direct IP)</option>
            <option value="LAN_PORT">CP Plus (auto detect)</option>
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

      {type === 'USB' && (
        <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <input type="hidden" {...register('usbDeviceId')} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" loading={detecting} onClick={() => void detectUsb()}>
              Detect USB cameras
            </Button>
            {usbNotice && <p className="text-xs text-amber-300">{usbNotice}</p>}
          </div>
          <p className="text-xs text-ink-400">
            Plug each camera into a USB or USB-C port on this computer, then detect. The laptop camera is skipped. Select a camera to see its live preview before you add it.
          </p>
          {skippedLaptops.length > 0 && <p className="text-xs text-ink-400">Laptop camera ignored: {skippedLaptops.join(', ')}</p>}
          {errors.usbDeviceId && <p className="text-xs text-red-400">{errors.usbDeviceId.message}</p>}
          {usbDevices.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {usbDevices.map((device, index) => {
                const selected = usbDeviceId === device.deviceId;
                return (
                  <button
                    key={device.deviceId || index}
                    type="button"
                    onClick={() => {
                      setValue('usbDeviceId', device.deviceId, { shouldValidate: true });
                      setPreviewId(device.deviceId);
                    }}
                    className={`rounded-lg px-3 py-2 text-left ring-1 ${selected ? 'bg-brand-600/15 text-brand-100 ring-brand-500/50' : 'text-ink-200 ring-ink-600 hover:bg-ink-800'}`}
                  >
                    <span className="block text-sm font-medium">USB camera {index + 1}</span>
                    <span className="block truncate text-xs text-ink-400">{device.label || 'USB / USB-C camera'}</span>
                    <span className="mt-1 block text-[11px]">{selected ? 'Selected — preview below' : 'Select and preview'}</span>
                  </button>
                );
              })}
            </div>
          )}
          {previewId && <UsbCameraPreview deviceId={previewId} />}
        </div>
      )}

      {type === 'LAN' && (
        <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <p className="text-xs text-ink-400">
            The camera’s Ethernet cable goes to your LAN. Enter the IP from the camera website. CP Plus cameras use the same username and password as that website. Live preview opens that address with the login and pauses when a path fails, so you can try the next one or type it yourself.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Camera brand" hint="CP Plus fills the stream path those cameras publish.">
              <Select
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value !== 'cpplus') return;
                  setValue('lanProtocol', 'rtsp');
                  setValue('lanPort', '554');
                  setValue('lanPath', '/cam/realmonitor?channel=1&subtype=1');
                }}
              >
                <option value="">General</option>
                <option value="cpplus">CP Plus</option>
              </Select>
            </Field>
            <Field label="Protocol" error={errors.lanProtocol?.message} hint="RTSP on port 554 is the usual LAN camera. HTTP is for an MJPEG page.">
              <Select
                {...lanProtocolField}
                onChange={(event) => {
                  const next = event.target.value as LanProtocol;
                  const prev = getValues('lanProtocol');
                  const prevDefaults = LAN_DEFAULTS[prev];
                  const nextDefaults = LAN_DEFAULTS[next];
                  if (!getValues('lanPort') || getValues('lanPort') === prevDefaults.port) setValue('lanPort', nextDefaults.port);
                  if (!getValues('lanPath') || getValues('lanPath') === prevDefaults.path) setValue('lanPath', nextDefaults.path);
                  void lanProtocolField.onChange(event);
                }}
              >
                <option value="rtsp">RTSP</option>
                <option value="rtsps">RTSPS (encrypted)</option>
                <option value="onvif">ONVIF (RTSP profile)</option>
                <option value="http">HTTP MJPEG</option>
              </Select>
            </Field>
            <Field label="Camera IP" error={errors.lanHost?.message} hint={camera?.streamReference ? `Current: ${camera.streamReference}` : 'Use the address the client gave you. If this server is somewhere else, add the camera anyway. The site connector on the client’s PC opens it.'}>
              <Input {...register('lanHost')} className="font-mono" placeholder="192.168.1.64" autoComplete="off" />
            </Field>
            <Field label="Port" error={errors.lanPort?.message}>
              <Input {...register('lanPort')} className="font-mono" inputMode="numeric" placeholder="554" />
            </Field>
            <Field label="Stream path" error={errors.lanPath?.message} hint="CP Plus: /cam/realmonitor?channel=1&subtype=1. Others: /stream1 or /Streaming/Channels/101">
              <Input {...register('lanPath')} className="font-mono" placeholder="/stream1" autoComplete="off" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Username" error={errors.username?.message} hint={camera?.hasCredentials ? 'Stored encrypted — leave blank to keep' : 'Stored encrypted (AES-256-GCM)'}>
              <Input {...register('username')} autoComplete="off" />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <PasswordInput {...register('password')} autoComplete="new-password" />
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

      {type === 'LAN_PORT' && (
        <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <input type="hidden" {...register('lanPortUrl')} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" loading={findingLan} onClick={() => void detectLanPort()}>
              Auto detect
            </Button>
            {lanNotice && <p className="text-xs text-amber-300">{lanNotice}</p>}
          </div>
          <p className="text-xs text-ink-400">
            Select CP Plus, enter the username and password from the camera website, then Auto detect. Each selected camera is added and monitoring starts. Run Vita Eye on the PC that has the LAN cable.
          </p>
          {camera?.streamReference && !lanPortUrl && <p className="text-xs text-ink-400">Current stream: {camera.streamReference}</p>}
          {errors.lanPortUrl && <p className="text-xs text-red-400">{errors.lanPortUrl.message}</p>}
          {lanCameras.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {lanCameras.map((item) => {
                const selected = camera ? lanPortUrl === item.streamUrl : selectedIps.includes(item.ip);
                return (
                  <button
                    key={item.ip}
                    type="button"
                    onClick={() => {
                      if (camera) {
                        setValue('lanPortUrl', item.streamUrl, { shouldValidate: true });
                        return;
                      }
                      setSelectedIps((current) => (current.includes(item.ip) ? current.filter((ip) => ip !== item.ip) : [...current, item.ip]));
                    }}
                    className={`rounded-lg px-3 py-2 text-left ring-1 ${selected ? 'bg-brand-600/15 text-brand-100 ring-brand-500/50' : 'text-ink-200 ring-ink-600 hover:bg-ink-800'}`}
                  >
                    <span className="block text-sm font-medium">{item.name}</span>
                    <span className="block truncate font-mono text-xs text-ink-400">{item.ip}</span>
                    <span className="mt-1 block text-[11px]">{selected ? 'Selected for monitoring' : 'Select'}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Username" error={errors.username?.message} hint={camera?.hasCredentials ? 'Stored encrypted — leave blank to keep' : 'The username from the CP Plus website'}>
              <Input {...register('username')} autoComplete="off" />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <PasswordInput {...register('password')} autoComplete="new-password" />
            </Field>
          </div>
          {camera?.hasCredentials && (
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" className="h-4 w-4 accent-blue-600" {...register('clearCredentials')} /> Remove stored credentials
            </label>
          )}
        </div>
      )}

      {directUrl && (
        <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <Field
            label={camera ? 'New stream URL (leave blank to keep current)' : 'Stream URL'}
            error={errors.streamUrl?.message}
            hint={camera?.streamReference ? `Current: ${camera.streamReference}` : type === 'HTTP_MJPEG' ? 'http://192.168.1.20:8080/video — a phone app page such as http://192.168.1.20:8080/ is accepted and the video feed is selected automatically' : 'rtsp://192.168.1.20:554/stream1 — TCP is tried first, then UDP. Host must be inside the approved camera networks'}
          >
            <Input {...register('streamUrl')} className="font-mono" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Username" error={errors.username?.message} hint={camera?.hasCredentials ? 'Stored encrypted — leave blank to keep' : 'Stored encrypted (AES-256-GCM)'}>
              <Input {...register('username')} autoComplete="off" />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <PasswordInput {...register('password')} autoComplete="new-password" />
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
      {(type === 'LAN' || type === 'LAN_PORT' || directUrl) && (previewSteps.length > 0 || previewSrc) && (
        <div className="space-y-3 rounded-xl border border-ink-700 bg-ink-850/60 p-4">
          <div className="overflow-hidden rounded-lg border border-ink-700 bg-black">
            {previewSrc ? (
              <img src={previewSrc} alt="Live preview from the camera" className="aspect-video w-full object-contain" />
            ) : (
              <p className="px-3 py-8 text-center text-xs text-ink-400">The picture appears here when a path accepts the username and password.</p>
            )}
          </div>
          <ol className="space-y-2">
            {previewSteps.map((step, index) => (
              <li key={`${step.title}-${index}`} className="text-sm">
                <span className={step.state === 'ok' ? 'text-emerald-200' : step.state === 'fail' ? 'text-red-200' : step.state === 'pause' ? 'text-amber-200' : 'text-ink-100'}>
                  {index + 1}. {step.title}
                </span>
                <span className="mt-0.5 block text-xs text-ink-400">{step.detail}</span>
              </li>
            ))}
          </ol>
          {checkpoint && (
            <div className="space-y-3 rounded-lg bg-amber-500/10 px-3 py-3">
              <p className="text-sm text-amber-100">Checkpoint. {checkpoint.message}</p>
              {checkpoint.nextPath && <p className="break-all font-mono text-xs text-ink-300">Next path: {checkpoint.nextPath}</p>}
              <div className="flex flex-wrap gap-2">
                {checkpoint.nextPath && (
                  <Button variant="secondary" disabled={previewBusy} onClick={() => void proceedPreview()}>
                    Proceed
                  </Button>
                )}
                <Button variant="secondary" disabled={previewBusy} onClick={interruptPreview}>
                  Interrupt
                </Button>
              </div>
              <p className="text-xs text-ink-400">Proceed tries the next path. Interrupt stops here so you can change the path or password and run the preview again.</p>
            </div>
          )}
          {previewOn && (
            <Button variant="secondary" onClick={releasePreview}>
              Stop preview
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {(type === 'LAN' || type === 'LAN_PORT' || directUrl) && (
          <Button variant="secondary" className="mr-auto" icon={<Video className="h-4 w-4" />} loading={previewBusy} onClick={() => void startLivePreview()}>
            Live preview
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {camera ? 'Save changes' : type === 'LAN_PORT' ? 'Add for monitoring' : 'Add camera'}
        </Button>
      </div>
    </form>
  );
}

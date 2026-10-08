'use client';

import { Activity, Camera as CameraIcon, CircleStop, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertSoundToggle } from '@/components/AlertSoundToggle';
import { FACE_COLORS, FACE_LABELS } from '@/components/badges';
import { Badge, Button, Field, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMonitor, type MonitorStatus } from '@/lib/monitor';
import type { Camera } from '@/lib/types';

const PILL: Partial<Record<MonitorStatus, { text: string; className: string }>> = {
  running: { text: 'LIVE', className: 'bg-red-600/90' },
  connecting: { text: 'RECONNECTING', className: 'bg-amber-600/90' },
  paused: { text: 'PAUSED · OUTSIDE SCHEDULE', className: 'bg-sky-700/90' },
};

export function BrowserMonitor({ cameras, onCameraChange }: { cameras: Camera[]; onCameraChange: (c: Camera) => void }) {
  const { can } = useAuth();
  const notify = useToast();
  const monitor = useMonitor();
  const { session, status, stream, faces, frameSize, stats } = monitor;
  const browserCams = cameras.filter((c) => c.cameraType === 'BROWSER' && c.isActive);
  const [cameraId, setCameraId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const active = Boolean(session);
  const selectedId = session?.cameraId ?? cameraId;
  const camera = browserCams.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!cameraId && browserCams.length) setCameraId(browserCams[0].id);
  }, [browserCams, cameraId]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    setDevices(list);
  }, []);
  useEffect(() => void refreshDevices(), [refreshDevices, stream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  async function start() {
    if (!camera) return;
    setStartError(null);
    try {
      onCameraChange(await monitor.start(camera, deviceId));
    } catch (err) {
      setStartError(errorMessage(err));
      notify('error', 'Could not start monitoring', errorMessage(err));
    }
  }

  if (!can('cameras:monitor') && !active) {
    return <p className="p-5 text-sm text-ink-400">Your role can view camera status but cannot stream from this device.</p>;
  }

  if (!browserCams.length && !active) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-center">
        <CameraIcon className="h-8 w-8 text-ink-400" />
        <p className="text-sm text-ink-200">No active browser cameras</p>
        <p className="max-w-sm text-xs text-ink-400">Create a camera of type &quot;Browser&quot; in Camera Management to monitor using this computer&apos;s webcam.</p>
      </div>
    );
  }

  const showVideo = active && Boolean(stream) && status !== 'other-tab';
  const pill = PILL[status];
  const problem = active ? monitor.error : (startError ?? monitor.notice);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field label="Camera record">
            <Select value={selectedId} onChange={(e) => setCameraId(e.target.value)} disabled={active}>
              {session && !camera && <option value={session.cameraId}>{session.cameraName}</option>}
              {browserCams.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cameraName} — {c.location}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[200px] flex-1">
          <Field label="Video device">
            <Select value={session?.deviceId ?? deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={active}>
              <option value="">Default camera</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {active ? (
          <Button variant="danger" icon={<CircleStop className="h-4 w-4" />} loading={monitor.stopping} onClick={() => void monitor.stop()}>
            Stop
          </Button>
        ) : (
          <Button icon={<Play className="h-4 w-4" />} loading={status === 'starting'} onClick={() => void start()} disabled={!camera}>
            Start monitoring
          </Button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-black">
        <video ref={videoRef} playsInline muted className={`block h-auto w-full ${showVideo ? '' : 'hidden'}`} />
        {showVideo && frameSize && status === 'running' && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${frameSize[0]} ${frameSize[1]}`} preserveAspectRatio="none">
            {faces.map((f) => {
              const [x, y, w, h] = f.bbox;
              const color = FACE_COLORS[f.label];
              const label = f.label === 'KNOWN' && f.personName ? f.personName : FACE_LABELS[f.label];
              const sim = f.similarity !== null && f.label !== 'LOW_QUALITY' ? ` ${f.similarity.toFixed(2)}` : '';
              const fs = Math.max(12, frameSize[0] / 55);
              return (
                <g key={f.trackId}>
                  <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={Math.max(2, frameSize[0] / 320)} rx="4" />
                  <rect x={x} y={Math.max(0, y - fs * 1.6)} width={Math.max(w, (label.length + sim.length) * fs * 0.62)} height={fs * 1.5} fill={color} opacity="0.9" rx="3" />
                  <text x={x + fs * 0.3} y={Math.max(fs * 1.1, y - fs * 0.45)} fontSize={fs} fill="#05080f" fontWeight="600" fontFamily="system-ui, sans-serif">
                    {label}
                    {sim}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {!showVideo && (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 text-center text-ink-400">
            <CameraIcon className="h-10 w-10" />
            <p className="text-sm">
              {status === 'other-tab' ? 'Monitoring is running in another tab on this device' : active ? 'Waiting for the camera…' : 'Camera preview appears here'}
            </p>
          </div>
        )}
        {showVideo && pill && (
          <span className={`absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${pill.className}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {pill.text}
            {status === 'running' && ` · ${stats.fps ? stats.fps.toFixed(1) : '—'} / ${session?.samplingFps} fps`}
          </span>
        )}
      </div>

      {problem && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <TriangleAlert className="h-4 w-4 shrink-0" /> <span className="flex-1">{problem}</span>
          {status === 'camera-unavailable' && (
            <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={monitor.resume}>
              Resume
            </Button>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="blue">
          <Activity className="h-3 w-3" /> Sent {stats.sent}
        </Badge>
        <Badge tone="green">Processed {stats.processed}</Badge>
        <Badge>Skipped (busy) {stats.dropped}</Badge>
        {stats.failed > 0 && <Badge tone="red">Failed {stats.failed}</Badge>}
        <Badge>Latency {stats.latencyMs ? `${Math.round(stats.latencyMs)} ms` : '—'}</Badge>
        <Badge>Faces {faces.length}</Badge>
        <AlertSoundToggle withLabel className="ml-auto py-1" />
      </div>
      <p className="text-xs text-ink-400">
        Once started, monitoring keeps running on this device — through sign-out, session expiry, page changes and network drops — until Stop is pressed, and resumes automatically if the page is reloaded. Frames are analysed on the server and are not stored; only confirmed events are recorded with an encrypted face close-up and full photo. Keep this browser open; closing it pauses monitoring until it is reopened.
      </p>
    </div>
  );
}

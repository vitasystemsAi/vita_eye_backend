'use client';

import { Camera as CameraIcon, ChevronLeft, ChevronRight, LayoutGrid, Maximize2, Minimize2, Play, RectangleHorizontal, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserStage, RemotePreview } from '@/components/monitoring/BrowserMonitor';
import { cn } from '@/components/ui/cn';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { useMonitor } from '@/lib/monitor';
import type { Camera, CameraType } from '@/lib/types';

const TYPE_LABEL: Record<CameraType, string> = { BROWSER: 'Browser', RTSP: 'RTSP', ONVIF: 'ONVIF', HTTP_MJPEG: 'MJPEG' };
const PREFS_KEY = 'vita.monitor.wall';

type Mode = 'wall' | 'single';

function readPrefs(): { ids: string[] | null; mode: Mode; focusId: string | null } {
  if (typeof sessionStorage === 'undefined') return { ids: null, mode: 'wall', focusId: null };
  try {
    const raw = sessionStorage.getItem(PREFS_KEY);
    if (!raw) return { ids: null, mode: 'wall', focusId: null };
    const parsed = JSON.parse(raw) as { ids?: unknown; mode?: unknown; focusId?: unknown };
    return {
      ids: Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : null,
      mode: parsed.mode === 'single' ? 'single' : 'wall',
      focusId: typeof parsed.focusId === 'string' ? parsed.focusId : null,
    };
  } catch {
    return { ids: null, mode: 'wall', focusId: null };
  }
}

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 md:grid-cols-2';
  if (count === 3) return 'grid-cols-1 md:grid-cols-3';
  if (count === 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4';
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white ring-1 ring-white/15 backdrop-blur hover:bg-black/80"
    >
      {children}
    </button>
  );
}

function Picture({ camera }: { camera: Camera }) {
  const { session, status } = useMonitor();
  const localBrowser = camera.cameraType === 'BROWSER' && session?.cameraId === camera.id && status !== 'other-tab';
  if (camera.cameraType === 'BROWSER' && !camera.monitoringEnabled) return <BrowserStage camera={camera} />;
  if (localBrowser) return <BrowserStage camera={camera} />;
  if (camera.monitoringEnabled) return <RemotePreview cameras={[camera]} bare />;
  if (camera.cameraType === 'BROWSER') return <BrowserStage camera={camera} />;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black text-ink-500">
      <CameraIcon className="h-8 w-8" />
    </div>
  );
}

function NameBar({ camera }: { camera: Camera }) {
  const live = camera.isActive && camera.monitoringEnabled && camera.status !== 'ERROR' && camera.status !== 'OFFLINE';
  const tone = camera.status === 'ERROR' ? 'bg-red-400' : live ? 'bg-emerald-400' : 'bg-ink-400';
  const detail = camera.status === 'ERROR' && camera.lastError ? camera.lastError : `${TYPE_LABEL[camera.cameraType]} · ${camera.location}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-8 pb-2.5">
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone)} />
        <span className="truncate">{camera.cameraName}</span>
      </p>
      <p className={cn('truncate pl-3.5 text-[11px]', camera.status === 'ERROR' ? 'text-red-300' : 'text-white/70')}>{detail}</p>
    </div>
  );
}

export function CameraWall({
  cameras,
  busyId,
  canMonitor,
  onToggle,
  onCameraChange,
  className,
}: {
  cameras: Camera[];
  busyId: string | null;
  canMonitor: boolean;
  onToggle: (camera: Camera) => void;
  onCameraChange: (camera: Camera) => void;
  className?: string;
}) {
  const notify = useToast();
  const monitor = useMonitor();
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const active = useMemo(
    () => cameras.filter((c) => c.isActive).sort((a, b) => a.cameraName.localeCompare(b.cameraName)),
    [cameras],
  );
  const [selected, setSelected] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>('wall');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const stored = readPrefs();
    if (stored.ids) setSelected(stored.ids);
    setMode(stored.mode);
    if (stored.focusId) setFocusId(stored.focusId);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const known = new Set(active.map((c) => c.id));
    const next = selected.filter((id) => known.has(id));
    if (next.length !== selected.length) setSelected(next);
  }, [active, selected]);

  useEffect(() => {
    if (!selected) return;
    try {
      sessionStorage.setItem(PREFS_KEY, JSON.stringify({ ids: selected, mode, focusId }));
    } catch {
      /* private mode */
    }
  }, [selected, mode, focusId]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  const chosen = selected ?? active.map((c) => c.id);
  const shown = active.filter((c) => chosen.includes(c.id));
  const focus = shown.find((c) => c.id === focusId) ?? shown[0] ?? null;

  useEffect(() => {
    if (mode !== 'single' || !focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      const index = shown.findIndex((c) => c.id === focus.id);
      if (index < 0) return;
      const next = shown[(index + (event.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
      if (next) setFocusId(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, focus, shown]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const current = prev ?? active.map((c) => c.id);
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  }

  function watchAlone(camera: Camera) {
    setFocusId(camera.id);
    setMode('single');
  }

  async function toggleFullscreen() {
    const node = rootRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      notify('error', 'Fullscreen is unavailable in this browser');
    }
  }

  async function startBrowser(camera: Camera) {
    try {
      onCameraChange(await monitor.start(camera, ''));
    } catch (err) {
      notify('error', 'Could not start monitoring', errorMessage(err));
    }
  }

  function renderCell(camera: Camera, selectOnClick: boolean) {
    const browserHere = camera.cameraType === 'BROWSER' && monitor.session?.cameraId === camera.id;
    return (
      <div
        className={cn('group relative h-full min-h-0 overflow-hidden bg-black', selectOnClick && 'cursor-pointer')}
        onClick={() => selectOnClick && watchAlone(camera)}
      >
        <Picture camera={camera} />
        <NameBar camera={camera} />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            {selectOnClick && (
              <IconButton title="Watch this camera" onClick={() => watchAlone(camera)}>
                <RectangleHorizontal className="h-3.5 w-3.5" />
              </IconButton>
            )}
            {canMonitor && camera.cameraType === 'BROWSER' && (
              browserHere ? (
                <IconButton title="Stop" onClick={() => void monitor.stop()}>
                  <Square className="h-3.5 w-3.5" />
                </IconButton>
              ) : (
                <IconButton title="Start" onClick={() => void startBrowser(camera)}>
                  <Play className="h-3.5 w-3.5" />
                </IconButton>
              )
            )}
            {canMonitor && camera.cameraType !== 'BROWSER' && (
              <IconButton title={camera.monitoringEnabled ? 'Stop' : 'Start'} onClick={() => onToggle(camera)}>
                {busyId === camera.id ? <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" /> : camera.monitoringEnabled ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </IconButton>
            )}
          </div>
      </div>
    );
  }

  return (
    <section ref={rootRef} className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-700 bg-black', fullscreen && 'h-full', className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-950 px-3 py-2">
        <p className="mr-auto text-sm font-medium text-ink-100">
          Camera view
          <span className="ml-2 text-xs font-normal text-ink-400">{shown.length} of {active.length}</span>
        </p>
        <div className="flex rounded-lg bg-ink-800 p-0.5 ring-1 ring-ink-700" role="group" aria-label="Layout">
          <button
            type="button"
            onClick={() => setMode('wall')}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs', mode === 'wall' ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-100')}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Wall
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('single');
              if (!focusId && shown[0]) setFocusId(shown[0].id);
            }}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs', mode === 'single' ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-100')}
          >
            <RectangleHorizontal className="h-3.5 w-3.5" /> Single
          </button>
        </div>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="inline-flex h-8 items-center rounded-lg border border-ink-600 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700"
            aria-expanded={pickerOpen}
          >
            Cameras
          </button>
          {pickerOpen && (
            <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2 text-xs">
                <span className="text-ink-300">Show in this window</span>
                <span className="flex gap-2">
                  <button type="button" className="text-brand-300 hover:text-brand-200" onClick={() => setSelected(active.map((c) => c.id))}>
                    All
                  </button>
                  <button type="button" className="text-ink-400 hover:text-ink-200" onClick={() => setSelected([])}>
                    None
                  </button>
                </span>
              </div>
              <ul className="max-h-72 overflow-y-auto p-1">
                {active.map((camera) => (
                  <li key={camera.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-blue-500"
                        checked={chosen.includes(camera.id)}
                        onChange={() => toggleSelected(camera.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-100">{camera.cameraName}</span>
                        <span className="block truncate text-[11px] text-ink-400">
                          {TYPE_LABEL[camera.cameraType]} · {camera.location}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
                {active.length === 0 && <li className="px-2 py-3 text-xs text-ink-400">No active cameras.</li>}
              </ul>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700"
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {fullscreen ? 'Exit' : 'Fullscreen'}
        </button>
      </header>

      <div className={cn('bg-black', fullscreen && 'min-h-0 flex-1 overflow-auto')}>
        {mode === 'wall' ? (
          shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <CameraIcon className="h-8 w-8 text-ink-500" />
              <p className="text-sm text-ink-200">{active.length ? 'No cameras selected' : 'No active cameras'}</p>
              <p className="max-w-sm text-xs text-ink-400">
                {active.length ? 'Open Cameras and choose which feeds to watch in this window.' : 'Add an active camera in Camera Management.'}
              </p>
            </div>
          ) : (
            <div className={cn('grid items-start gap-px bg-ink-800', gridClass(shown.length))}>
              {shown.map((camera) => (
                <div key={camera.id} className="relative aspect-video">
                  {renderCell(camera, true)}
                </div>
              ))}
            </div>
          )
        ) : focus ? (
          <div className="flex flex-col">
            <div className="relative mx-auto aspect-video w-full">{renderCell(focus, true)}</div>
            {shown.length > 1 && (
              <div className="flex items-center gap-2 border-t border-ink-800 bg-ink-950 px-2 py-2">
                <button
                  type="button"
                  aria-label="Previous camera"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-300 hover:bg-ink-800"
                  onClick={() => {
                    const index = shown.findIndex((c) => c.id === focus.id);
                    const next = shown[(index - 1 + shown.length) % shown.length];
                    if (next) setFocusId(next.id);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                  {shown.map((camera) => (
                    <button
                      key={camera.id}
                      type="button"
                      onClick={() => setFocusId(camera.id)}
                      className={cn(
                        'shrink-0 rounded-lg px-3 py-1.5 text-left',
                        camera.id === focus.id ? 'bg-brand-600/20 text-white ring-1 ring-brand-400' : 'bg-ink-800 text-ink-300 hover:bg-ink-700',
                      )}
                    >
                      <span className="block max-w-40 truncate text-xs font-medium">{camera.cameraName}</span>
                      <span className="block max-w-40 truncate text-[10px] text-ink-400">{TYPE_LABEL[camera.cameraType]} · {camera.location}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Next camera"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-300 hover:bg-ink-800"
                  onClick={() => {
                    const index = shown.findIndex((c) => c.id === focus.id);
                    const next = shown[(index + 1) % shown.length];
                    if (next) setFocusId(next.id);
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">Select a camera to watch.</div>
        )}
      </div>
    </section>
  );
}

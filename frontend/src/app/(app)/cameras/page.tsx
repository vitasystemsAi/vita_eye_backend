'use client';

import { Camera as CameraIcon, MoreHorizontal, Pencil, Play, Plus, Power, PlugZap, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CameraStatusBadge } from '@/components/badges';
import { CameraForm, type CameraPayload } from '@/components/cameras/CameraForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, LoadingBlock, Modal, PageHeader, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtRelative, friendlyCameraError } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import { isLocalCamera, type Camera, type CameraStatus } from '@/lib/types';

const TYPE_LABEL: Record<Camera['cameraType'], string> = { BROWSER: 'Browser', USB: 'USB', LAN: 'LAN', LAN_PORT: 'CP Plus', RTSP: 'RTSP', ONVIF: 'ONVIF', HTTP_MJPEG: 'MJPEG' };

function ActionsMenu({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; above: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const height = menuRef.current?.offsetHeight ?? 168;
      const above = rect.bottom + height + 8 > window.innerHeight && rect.top > height + 8;
      setPlace({ top: above ? rect.top - 4 : rect.bottom + 4, left: rect.right, above });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onToggle();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);

  return (
    <>
      <Button ref={buttonRef} size="sm" variant="ghost" aria-label="More actions" aria-expanded={open} onClick={onToggle} icon={<MoreHorizontal className="h-4 w-4" />} />
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-xl"
          style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, transform: place?.above ? 'translate(-100%, -100%)' : 'translateX(-100%)' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

function CamerasView() {
  const { can } = useAuth();
  const notify = useToast();
  const [search, setSearch] = useState('');
  const [site, setSite] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, raw, loading, error, reload, setData } = useApi<Camera[]>('/cameras', { search: q, site, status, pageSize: 200 });
  const sites = (raw?.sites as string[] | undefined) ?? [];
  const [editing, setEditing] = useState<Camera | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Camera | null>(null);
  const [errorCamera, setErrorCamera] = useState<Camera | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  useSocketEvent<{ cameraId: string; status: CameraStatus; error?: string | null }>('camera:status', (s) => {
    setData((prev) => (prev ?? []).map((c) => (c.id === s.cameraId ? { ...c, status: s.status, lastError: s.error ?? (s.status === 'ERROR' ? c.lastError : null) } : c)));
  });

  const replace = (c: Camera) => setData((prev) => (prev ?? []).map((x) => (x.id === c.id ? c : x)));

  async function run(c: Camera, action: 'test' | 'start' | 'stop' | 'toggle') {
    setBusy(`${c.id}:${action}`);
    setMenu(null);
    try {
      if (action === 'test') {
        const { data: r } = await api.post<{ ok: boolean; tested: boolean; message?: string; error?: string; width?: number; height?: number }>(`/cameras/${c.id}/test-connection`);
        if (!r.tested) notify('info', c.cameraType === 'USB' ? 'USB camera' : 'Browser camera', r.message);
        else if (r.ok) notify('success', 'Connection OK', r.width ? `Received a ${r.width}×${r.height} frame from ${c.cameraName}.` : undefined);
        else notify('error', 'Connection failed', r.error ?? 'The stream could not be opened.');
        void reload();
      } else if (action === 'start' || action === 'stop') {
        const { data: r } = await api.post<{ camera: Camera; message: string }>(`/cameras/${c.id}/${action === 'start' ? 'start' : 'stop'}-monitoring`);
        replace(r.camera);
        notify('success', r.message);
      } else {
        const { data: r } = await api.patch<Camera>(`/cameras/${c.id}`, { isActive: !c.isActive });
        replace(r);
        notify('success', r.isActive ? 'Camera activated' : 'Camera deactivated');
      }
    } catch (err) {
      notify('error', 'Action failed', errorMessage(err));
      void reload();
    } finally {
      setBusy(null);
    }
  }

  async function save(payload: CameraPayload) {
    if (payload.cpPlusIps?.length) {
      const { data } = await api.post<{ added: Array<{ monitoring: boolean }>; failed: Array<{ ip: string; error: string }> }>(
        '/cameras/cp-plus',
        {
          location: payload.location,
          site: payload.site,
          samplingFps: payload.samplingFps,
          username: payload.username,
          password: payload.password,
          ips: payload.cpPlusIps,
        },
        { signal: AbortSignal.timeout(120000) },
      );
      const monitoring = data.added.filter((camera) => camera.monitoring).length;
      const problem = data.failed.length ? `${data.failed.length} could not be added.` : data.added.length === monitoring ? undefined : 'Added, but monitoring did not start for every camera.';
      notify('success', `${data.added.length} CP Plus camera${data.added.length === 1 ? '' : 's'} added`, problem ?? 'Monitoring is on.');
      setEditing(null);
      void reload();
      return;
    }
    if (editing === 'new') {
      await api.post<Camera>('/cameras', payload);
      notify('success', 'Camera added');
    } else if (editing) {
      await api.patch<Camera>(`/cameras/${editing.id}`, payload);
      notify('success', 'Camera updated');
    }
    setEditing(null);
    void reload();
  }

  async function deactivateCamera(camera: Camera) {
    setBusy(`${camera.id}:toggle`);
    try {
      const { data: r } = await api.patch<Camera>(`/cameras/${camera.id}`, { isActive: false });
      replace(r);
      notify('success', 'Camera deactivated', 'History is preserved. Activate again when you need this camera.');
      setDeleting(null);
    } catch (err) {
      notify('error', 'Action failed', errorMessage(err));
      void reload();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(`${deleting.id}:delete`);
    try {
      await api.delete(`/cameras/${deleting.id}`);
      notify('success', 'Camera deleted', 'Recorded events and evidence were kept.');
      setDeleting(null);
      void reload();
    } catch (err) {
      notify('error', 'Delete failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Camera Management"
        icon={<CameraIcon className="h-5 w-5" />}
        description="USB and USB-C cameras open on the computer the cable is plugged into. LAN direct IP cameras are opened from an address you type. LAN port cameras are found automatically on this computer, the same way a USB camera is selected. RTSP, ONVIF, and MJPEG streams are ingested on the server."
        actions={can('cameras:manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add camera</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-ink-700/70 p-4">
          <Input placeholder="Search name or location" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
            <option value="ERROR">Error</option>
            <option value="DISABLED">Disabled</option>
          </Select>
          {sites.length > 0 && (
            <Select className="w-40" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </div>
        <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
        {loading && !data ? (
          <LoadingBlock />
        ) : !data?.length ? (
          <EmptyState icon={<CameraIcon className="h-6 w-6" />} title="No cameras" description="Add a USB or USB-C cable camera, a LAN-port camera by IP, or a browser webcam." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-700/70">
                <tr>
                  <th className="table-head">Camera</th>
                  <th className="table-head">Type</th>
                  <th className="table-head">Location</th>
                  <th className="table-head">Status</th>
                  <th className="table-head">Last seen</th>
                  <th className="table-head">Schedule</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-800/40">
                    <td className="table-cell">
                      <p className="font-medium">{c.cameraName}</p>
                      {c.streamReference && <p className="max-w-[260px] truncate font-mono text-[11px] text-ink-400" title={c.streamReference}>{c.streamReference}</p>}
                      {c.status === 'ERROR' && c.lastError && (
                        <button type="button" onClick={() => setErrorCamera(c)} className="mt-0.5 block max-w-[260px] truncate text-left text-xs text-red-300 underline decoration-red-400/40 hover:text-red-200" title="View the full error">
                          {friendlyCameraError(c.lastError)}
                        </button>
                      )}
                    </td>
                    <td className="table-cell">
                      <Badge>{TYPE_LABEL[c.cameraType]}</Badge>
                      {c.hasCredentials && <Badge className="ml-1" tone="violet">Credentials</Badge>}
                    </td>
                    <td className="table-cell">
                      {c.location}
                      {c.site && <p className="text-xs text-ink-400">{c.site}</p>}
                    </td>
                    <td className="table-cell">
                      <CameraStatusBadge status={c.status} monitoring={c.monitoringEnabled} />
                    </td>
                    <td className="table-cell text-ink-300">{fmtRelative(c.lastConnectedAt)}</td>
                    <td className="table-cell text-xs text-ink-300">
                      {c.schedule?.enabled ? (
                        <span className={c.withinSchedule ? '' : 'text-amber-300'}>
                          {c.schedule.start}–{c.schedule.end} {c.withinSchedule ? '' : '(outside window)'}
                        </span>
                      ) : (
                        'Always'
                      )}
                      <p className="text-ink-400">{c.samplingFps} fps</p>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1.5">
                        {can('cameras:monitor') && c.isActive && (
                          c.monitoringEnabled ? (
                            <Button size="sm" variant="secondary" icon={<Square className="h-3.5 w-3.5" />} loading={busy === `${c.id}:stop`} onClick={() => void run(c, 'stop')}>
                              Stop
                            </Button>
                          ) : (
                            <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} loading={busy === `${c.id}:start`} onClick={() => void run(c, 'start')}>
                              Start
                            </Button>
                          )
                        )}
                        {can('cameras:manage') && (
                          <ActionsMenu open={menu === c.id} onToggle={() => setMenu(menu === c.id ? null : c.id)}>
                            {c.status === 'ERROR' && c.lastError && (
                              <MenuItem icon={<TriangleAlert className="h-4 w-4" />} onClick={() => { setMenu(null); setErrorCamera(c); }}>View error</MenuItem>
                            )}
                            {!isLocalCamera(c.cameraType) && (
                              <MenuItem icon={<PlugZap className="h-4 w-4" />} onClick={() => void run(c, 'test')}>Test connection</MenuItem>
                            )}
                            <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { setMenu(null); setEditing(c); }}>Edit</MenuItem>
                            <MenuItem icon={<Power className="h-4 w-4" />} onClick={() => void run(c, 'toggle')}>{c.isActive ? 'Deactivate' : 'Activate'}</MenuItem>
                            <MenuItem icon={<Trash2 className="h-4 w-4" />} danger onClick={() => { setMenu(null); setDeleting(c); }}>Delete</MenuItem>
                          </ActionsMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add camera' : `Edit ${editing?.cameraName ?? ''}`} size="lg">
        {editing !== null && <CameraForm camera={editing === 'new' ? undefined : editing} onSubmit={save} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal
        open={errorCamera !== null}
        onClose={() => setErrorCamera(null)}
        title={errorCamera ? `${errorCamera.cameraName} error` : 'Camera error'}
        footer={<Button variant="secondary" onClick={() => setErrorCamera(null)}>Close</Button>}
      >
        {errorCamera && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words text-sm text-red-200">{friendlyCameraError(errorCamera.lastError ?? '')}</p>
            {errorCamera.streamReference && <p className="break-all font-mono text-xs text-ink-400">{errorCamera.streamReference}</p>}
          </div>
        )}
      </Modal>
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Remove camera"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={Boolean(busy)}>
              Cancel
            </Button>
            {deleting?.isActive && (
              <Button
                variant="warning"
                loading={busy === `${deleting.id}:toggle`}
                onClick={() => void deactivateCamera(deleting)}
              >
                Deactivate
              </Button>
            )}
            <Button variant="danger" loading={busy?.endsWith(':delete')} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink-200">
          <p>
            Remove <strong>{deleting?.cameraName}</strong>?
          </p>
          <p className="text-ink-400">
            The camera is removed from monitoring. Recorded detections and evidence stay in the event history.
          </p>
        </div>
      </Modal>
    </>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-700 ${danger ? 'text-red-300' : 'text-ink-100'}`}>
      {icon}
      {children}
    </button>
  );
}

export default function CamerasPage() {
  return (
    <RequirePermission permission="cameras:view">
      <CamerasView />
    </RequirePermission>
  );
}
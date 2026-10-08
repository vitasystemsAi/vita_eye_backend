'use client';

import { Camera as CameraIcon, MoreHorizontal, Pencil, Play, Plus, Power, PlugZap, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CameraStatusBadge } from '@/components/badges';
import { CameraForm, type CameraPayload } from '@/components/cameras/CameraForm';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Input, LoadingBlock, Modal, PageHeader, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtRelative } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { Camera, CameraStatus } from '@/lib/types';

const TYPE_LABEL: Record<Camera['cameraType'], string> = { BROWSER: 'Browser', RTSP: 'RTSP', ONVIF: 'ONVIF', HTTP_MJPEG: 'MJPEG' };

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
        if (!r.tested) notify('info', 'Browser camera', r.message);
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

  async function remove() {
    if (!deleting) return;
    setBusy(`${deleting.id}:delete`);
    try {
      await api.delete(`/cameras/${deleting.id}`);
      notify('success', 'Camera deleted');
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
        description="Browser webcams stream from an operator device; RTSP/ONVIF/MJPEG cameras are ingested server-side."
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
          <EmptyState icon={<CameraIcon className="h-6 w-6" />} title="No cameras" description="Add a browser camera to monitor from this computer's webcam, or an IP camera on an approved network." />
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
                      {c.status === 'ERROR' && c.lastError && <p className="max-w-[260px] truncate text-xs text-red-300" title={c.lastError}>{c.lastError}</p>}
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
                          <div className="relative">
                            <Button size="sm" variant="ghost" aria-label="More actions" onClick={() => setMenu(menu === c.id ? null : c.id)} icon={<MoreHorizontal className="h-4 w-4" />} />
                            {menu === c.id && (
                              <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-xl" onMouseLeave={() => setMenu(null)}>
                                {c.cameraType !== 'BROWSER' && (
                                  <MenuItem icon={<PlugZap className="h-4 w-4" />} onClick={() => void run(c, 'test')}>Test connection</MenuItem>
                                )}
                                <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { setMenu(null); setEditing(c); }}>Edit</MenuItem>
                                <MenuItem icon={<Power className="h-4 w-4" />} onClick={() => void run(c, 'toggle')}>{c.isActive ? 'Deactivate' : 'Activate'}</MenuItem>
                                <MenuItem icon={<Trash2 className="h-4 w-4" />} danger onClick={() => { setMenu(null); setDeleting(c); }}>Delete</MenuItem>
                              </div>
                            )}
                          </div>
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
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete camera"
        confirmLabel="Delete"
        loading={busy?.endsWith(':delete')}
        onConfirm={() => void remove()}
        message={<p>Delete <strong>{deleting?.cameraName}</strong>? Cameras with recorded events cannot be deleted — deactivate them instead to preserve the audit trail.</p>}
      />
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
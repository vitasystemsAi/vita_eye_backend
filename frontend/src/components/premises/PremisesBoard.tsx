'use client';

import { BedDouble, Building2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '@/components/ui/primitives';
import { cn } from '@/components/ui/cn';
import { api, ApiError, errorMessage } from '@/lib/api';
import { BED_STATUS_LABELS, type BedStatus, type DepartmentRow, type EmployeeTypeRow, type PremisesBed, type PremisesFloor, type PremisesOverview, type PremisesRoom } from '@/lib/premises';

async function send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  if (method === 'DELETE') return api.delete<PremisesOverview>(path);
  if (method === 'PATCH') return api.patch<PremisesOverview>(path, body);
  return api.post<PremisesOverview>(path, body);
}

function failure(err: unknown) {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors();
    return { message: Object.keys(fields).length ? null : err.message, fields };
  }
  return { message: errorMessage(err), fields: {} as Record<string, string> };
}

function Meter({ used, capacity, unit, planned }: { used: number; capacity: number | null; unit: string; planned: number | null }) {
  const pct = capacity && capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500';
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-ink-300">
        <span>{used.toLocaleString()} {unit} in use{planned != null ? ` · ${planned.toLocaleString()} planned` : ''}</span>
        <span>{capacity == null ? 'No licensed limit' : `${capacity.toLocaleString()} licensed`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-800">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: capacity ? `${pct}%` : '0%' }} />
      </div>
    </div>
  );
}

function RowButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn('w-full rounded-lg border px-3 py-2 text-left transition', selected ? 'border-brand-500/40 bg-brand-500/10' : 'border-ink-800 hover:border-ink-600')}
    >
      {children}
    </div>
  );
}

export function PremisesBoard({ data, canManage, onUpdated }: { data: PremisesOverview; canManage: boolean; onUpdated: (next: PremisesOverview) => void }) {
  const { profile } = data;
  const places = profile.master === 'lodging' || profile.master === 'layout';
  const [floorId, setFloorId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const floor = data.floors.find((item) => item.id === floorId) ?? data.floors[0] ?? null;
  const rooms = data.rooms.filter((item) => item.floorId === floor?.id);
  const room = rooms.find((item) => item.id === roomId) ?? rooms[0] ?? null;
  const beds = data.beds.filter((item) => item.roomId === room?.id);

  return (
    <div className="space-y-6">
      <Card>
        <div className="space-y-4 p-5">
          <Meter used={data.usage.used} capacity={profile.capacity} unit={data.usage.unit} planned={data.usage.planned} />
          <p className="text-sm text-ink-300">{profile.description}</p>
        </div>
      </Card>
      {profile.master === 'none' && (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="No structured master data"
            description="Other organizations keep a people capacity only. Change the organization type to office, hostel, home, school or hospital when this site needs floors, beds or employee types."
          />
        </Card>
      )}
      {profile.master === 'workforce' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <EmployeeTypes data={data} canManage={canManage} onUpdated={onUpdated} />
          <Departments data={data} canManage={canManage} onUpdated={onUpdated} />
        </div>
      )}
      {places && (
        <div className={cn('grid grid-cols-1 gap-6', profile.master === 'lodging' ? 'xl:grid-cols-3' : 'xl:grid-cols-2')}>
          <Floors
            floors={data.floors}
            selectedId={floor?.id ?? null}
            canManage={canManage}
            placeHint={profile.code === 'SCHOOL' ? 'Block or floor, such as Block A or Ground' : 'Examples: Ground, First, Basement'}
            onSelect={(id) => { setFloorId(id); setRoomId(null); }}
            onUpdated={onUpdated}
          />
          <Rooms
            profile={profile}
            floor={floor}
            rooms={rooms}
            selectedId={room?.id ?? null}
            canManage={canManage}
            showBeds={profile.master === 'lodging'}
            onSelect={setRoomId}
            onUpdated={onUpdated}
          />
          {profile.master === 'lodging' && (
            <Beds room={room} beds={beds} statuses={data.bedStatuses} canManage={canManage} onUpdated={onUpdated} />
          )}
        </div>
      )}
    </div>
  );
}

function Floors({ floors, selectedId, canManage, placeHint, onSelect, onUpdated }: {
  floors: PremisesFloor[];
  selectedId: string | null;
  canManage: boolean;
  placeHint: string;
  onSelect: (id: string) => void;
  onUpdated: (next: PremisesOverview) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('POST', '/premises/floors', { name, code, sortOrder: Number(sortOrder || 0), notes });
      setName('');
      setCode('');
      setNotes('');
      setFields({});
      onUpdated(data);
    } catch (err) {
      const parsed = failure(err);
      setError(parsed.message);
      setFields(parsed.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Floors" description={placeHint} actions={<Building2 className="h-4 w-4 text-ink-400" />}>
      {canManage && (
        <form onSubmit={add} className="space-y-3 border-b border-ink-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
            <Field label="Code" error={fields.code}><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} placeholder="G" /></Field>
            <Field label="Level" hint="0 is ground. Negative is a basement." error={fields.sortOrder}><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
            <Field label="Notes" error={fields.notes}><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} /></Field>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <Button type="submit" size="sm" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>Add floor</Button>
        </form>
      )}
      <div className="space-y-2 p-4">
        {!floors.length && <p className="text-sm text-ink-400">No floors yet.</p>}
        {floors.map((floor) => (
          <div key={floor.id}>
            <RowButton selected={floor.id === selectedId} onClick={() => onSelect(floor.id)}>
              <span className="flex items-start justify-between gap-2">
                <span>
                  <span className="block text-sm font-medium text-ink-100">{floor.name}</span>
                  <span className="text-xs text-ink-400">{floor.code ? `${floor.code} · ` : ''}Level {floor.sortOrder} · {floor.roomCount} {floor.roomCount === 1 ? 'room' : 'rooms'}</span>
                </span>
                {canManage && (
                  <span className="flex gap-1">
                    <IconButton label="Edit floor" onClick={() => setEditing(editing === floor.id ? null : floor.id)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                    <Remove path={`/premises/floors/${floor.id}`} onUpdated={onUpdated} label="Delete floor" />
                  </span>
                )}
              </span>
            </RowButton>
            {editing === floor.id && <FloorEdit floor={floor} onClose={() => setEditing(null)} onUpdated={onUpdated} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function FloorEdit({ floor, onClose, onUpdated }: { floor: PremisesFloor; onClose: () => void; onUpdated: (next: PremisesOverview) => void }) {
  const [name, setName] = useState(floor.name);
  const [code, setCode] = useState(floor.code ?? '');
  const [sortOrder, setSortOrder] = useState(String(floor.sortOrder));
  const [notes, setNotes] = useState(floor.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('PATCH', `/premises/floors/${floor.id}`, { name, code, sortOrder: Number(sortOrder || 0), notes });
      onUpdated(data);
      onClose();
    } catch (err) {
      setError(failure(err).message ?? 'Could not save this floor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-2 space-y-3 rounded-lg border border-ink-700 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Level"><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}>Save floor</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function Rooms({ profile, floor, rooms, selectedId, canManage, showBeds, onSelect, onUpdated }: {
  profile: PremisesOverview['profile'];
  floor: PremisesFloor | null;
  rooms: PremisesRoom[];
  selectedId: string | null;
  canManage: boolean;
  showBeds: boolean;
  onSelect: (id: string) => void;
  onUpdated: (next: PremisesOverview) => void;
}) {
  const first = profile.roomTypes[0];
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState(first?.code ?? '');
  const [capacity, setCapacity] = useState(first ? String(first.defaultCapacity) : '1');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function chooseType(code: string) {
    const match = profile.roomTypes.find((item) => item.code === code);
    setRoomType(code);
    if (match) setCapacity(String(match.defaultCapacity));
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!floor) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('POST', '/premises/rooms', { floorId: floor.id, name, roomType, capacity: Number(capacity), notes });
      setName('');
      setNotes('');
      setFields({});
      onUpdated(data);
    } catch (err) {
      const parsed = failure(err);
      setError(parsed.message);
      setFields(parsed.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Rooms" description={floor ? `On ${floor.name}` : 'Select a floor first'} actions={<span className="text-xs text-ink-400">{profile.roomCapacityLabel}</span>}>
      {canManage && floor && (
        <form onSubmit={add} className="space-y-3 border-b border-ink-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room" error={fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="101" maxLength={80} /></Field>
            <Field label="Type" error={fields.roomType}>
              <Select value={roomType} onChange={(e) => chooseType(e.target.value)}>
                {profile.roomTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </Select>
            </Field>
            <Field label={profile.roomCapacityLabel ?? 'Capacity'} error={fields.capacity}><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
            <Field label="Notes" error={fields.notes}><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} /></Field>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <Button type="submit" size="sm" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>Add room</Button>
        </form>
      )}
      <div className="space-y-2 p-4">
        {!floor && <p className="text-sm text-ink-400">Add a floor before adding rooms.</p>}
        {floor && !rooms.length && <p className="text-sm text-ink-400">No rooms on this floor.</p>}
        {rooms.map((item) => {
          const typeLabel = profile.roomTypes.find((type) => type.code === item.roomType)?.label ?? item.roomType;
          return (
            <div key={item.id}>
              <RowButton selected={item.id === selectedId} onClick={() => onSelect(item.id)}>
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block text-sm font-medium text-ink-100">{item.name}</span>
                    <span className="text-xs text-ink-400">{typeLabel} · {item.capacity} {profile.roomCapacityLabel?.toLowerCase() ?? 'capacity'}{showBeds ? ` · ${item.bedCount} added` : ''}</span>
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      <IconButton label="Edit room" onClick={() => setEditing(editing === item.id ? null : item.id)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                      <Remove path={`/premises/rooms/${item.id}`} onUpdated={onUpdated} label="Delete room" />
                    </span>
                  )}
                </span>
              </RowButton>
              {editing === item.id && <RoomEdit room={item} profile={profile} onClose={() => setEditing(null)} onUpdated={onUpdated} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RoomEdit({ room, profile, onClose, onUpdated }: { room: PremisesRoom; profile: PremisesOverview['profile']; onClose: () => void; onUpdated: (next: PremisesOverview) => void }) {
  const [name, setName] = useState(room.name);
  const [roomType, setRoomType] = useState(room.roomType);
  const [capacity, setCapacity] = useState(String(room.capacity));
  const [notes, setNotes] = useState(room.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('PATCH', `/premises/rooms/${room.id}`, { name, roomType, capacity: Number(capacity), notes });
      onUpdated(data);
      onClose();
    } catch (err) {
      setError(failure(err).message ?? 'Could not save this room');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-2 space-y-3 rounded-lg border border-ink-700 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Room"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Type">
          <Select value={roomType} onChange={(e) => setRoomType(e.target.value)}>
            {!profile.roomTypes.some((item) => item.code === roomType) && <option value={roomType}>{roomType}</option>}
            {profile.roomTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </Select>
        </Field>
        <Field label={profile.roomCapacityLabel ?? 'Capacity'}><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}>Save room</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function Beds({ room, beds, statuses, canManage, onUpdated }: {
  room: PremisesRoom | null;
  beds: PremisesBed[];
  statuses: BedStatus[];
  canManage: boolean;
  onUpdated: (next: PremisesOverview) => void;
}) {
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<BedStatus>('AVAILABLE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('POST', '/premises/beds', { roomId: room.id, label, status });
      setLabel('');
      onUpdated(data);
    } catch (err) {
      setError(failure(err).message ?? 'Could not add this bed');
    } finally {
      setBusy(false);
    }
  }

  async function setBedStatus(bed: PremisesBed, next: BedStatus) {
    setError(null);
    try {
      const { data } = await send('PATCH', `/premises/beds/${bed.id}`, { status: next });
      onUpdated(data);
    } catch (err) {
      setError(failure(err).message ?? 'Could not update this bed');
    }
  }

  return (
    <Card title="Beds" description={room ? `${room.name} · ${beds.length} of ${room.capacity}` : 'Select a room first'} actions={<BedDouble className="h-4 w-4 text-ink-400" />}>
      {canManage && room && (
        <form onSubmit={add} className="space-y-3 border-b border-ink-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bed label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A" maxLength={40} /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as BedStatus)}>
                {statuses.map((item) => <option key={item} value={item}>{BED_STATUS_LABELS[item]}</option>)}
              </Select>
            </Field>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <Button type="submit" size="sm" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>Add bed</Button>
        </form>
      )}
      <div className="space-y-2 p-4">
        {!room && <p className="text-sm text-ink-400">Add a room before adding beds.</p>}
        {room && !beds.length && <p className="text-sm text-ink-400">No beds in this room.</p>}
        {beds.map((bed) => (
          <div key={bed.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-800 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-ink-100">{bed.label}</p>
              <p className="text-xs text-ink-400">{bed.floorName} · {bed.roomName}</p>
            </div>
            <div className="flex items-center gap-2">
              {canManage ? (
                <Select className="w-36" value={bed.status} onChange={(e) => void setBedStatus(bed, e.target.value as BedStatus)}>
                  {statuses.map((item) => <option key={item} value={item}>{BED_STATUS_LABELS[item]}</option>)}
                </Select>
              ) : (
                <Badge tone={bed.status === 'OCCUPIED' ? 'amber' : bed.status === 'MAINTENANCE' ? 'red' : 'neutral'}>{BED_STATUS_LABELS[bed.status]}</Badge>
              )}
              {canManage && <Remove path={`/premises/beds/${bed.id}`} onUpdated={onUpdated} label="Delete bed" />}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EmployeeTypes({ data, canManage, onUpdated }: { data: PremisesOverview; canManage: boolean; onUpdated: (next: PremisesOverview) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: next } = await send('POST', '/premises/employee-types', { name, code, description, sortOrder: (data.employeeTypes.length + 1) * 10, active: true });
      setName('');
      setCode('');
      setDescription('');
      setFields({});
      onUpdated(next);
    } catch (err) {
      const parsed = failure(err);
      setError(parsed.message);
      setFields(parsed.fields);
    } finally {
      setBusy(false);
    }
  }

  async function seed() {
    setBusy(true);
    setError(null);
    try {
      const { data: next } = await send('POST', '/premises/employee-types/defaults');
      onUpdated(next);
    } catch (err) {
      setError(failure(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: EmployeeTypeRow) {
    const { data: next } = await send('PATCH', `/premises/employee-types/${row.id}`, { active: !row.active });
    onUpdated(next);
  }

  return (
    <Card title="Employee types" description="How people in this office are classified." actions={canManage ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void seed()}>Add standard types</Button> : undefined}>
      {canManage && (
        <form onSubmit={add} className="space-y-3 border-b border-ink-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full-time" /></Field>
            <Field label="Code" error={fields.code}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="FT" maxLength={16} /></Field>
            <Field label="Description" error={fields.description}><Input className="col-span-2" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <Button type="submit" size="sm" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>Add employee type</Button>
        </form>
      )}
      <div className="space-y-2 p-4">
        {!data.employeeTypes.length && <EmptyState icon={<Users className="h-6 w-6" />} title="No employee types" description="Add the standard set, or create types that match this office." />}
        {data.employeeTypes.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-ink-100">{row.name} <span className="font-mono text-xs text-ink-400">{row.code}</span></p>
              {row.description && <p className="text-xs text-ink-400">{row.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={row.active ? 'green' : 'neutral'}>{row.active ? 'Active' : 'Inactive'}</Badge>
              {canManage && <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>{row.active ? 'Deactivate' : 'Activate'}</Button>}
              {canManage && <Remove path={`/premises/employee-types/${row.id}`} onUpdated={onUpdated} label="Delete employee type" />}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Departments({ data, canManage, onUpdated }: { data: PremisesOverview; canManage: boolean; onUpdated: (next: PremisesOverview) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [seatLimit, setSeatLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: next } = await send('POST', '/premises/departments', {
        name,
        code,
        description,
        seatLimit: seatLimit ? Number(seatLimit) : null,
      });
      setName('');
      setCode('');
      setDescription('');
      setSeatLimit('');
      setFields({});
      onUpdated(next);
    } catch (err) {
      const parsed = failure(err);
      setError(parsed.message);
      setFields(parsed.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Departments" description="Optional seat limits count toward the licensed headcount." actions={<Users className="h-4 w-4 text-ink-400" />}>
      {canManage && (
        <form onSubmit={add} className="space-y-3 border-b border-ink-800 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Security" /></Field>
            <Field label="Code" error={fields.code}><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SEC" maxLength={16} /></Field>
            <Field label="Seat limit" hint="Leave blank if this department is not capped" error={fields.seatLimit}><Input type="number" min={1} value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} /></Field>
            <Field label="Description" error={fields.description}><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <Button type="submit" size="sm" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>Add department</Button>
        </form>
      )}
      <div className="space-y-2 p-4">
        {!data.departments.length && <p className="text-sm text-ink-400">No departments yet.</p>}
        {data.departments.map((row: DepartmentRow) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-ink-100">{row.name} <span className="font-mono text-xs text-ink-400">{row.code}</span></p>
              <p className="text-xs text-ink-400">{row.seatLimit ? `${row.seatLimit.toLocaleString()} seats` : 'No seat limit'}{row.description ? ` · ${row.description}` : ''}</p>
            </div>
            {canManage && <Remove path={`/premises/departments/${row.id}`} onUpdated={onUpdated} label="Delete department" />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick(); }} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
      {children}
    </button>
  );
}

function Remove({ path, onUpdated, label }: { path: string; onUpdated: (next: PremisesOverview) => void; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(event: MouseEvent) {
    event.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await send('DELETE', path);
      onUpdated(data);
    } catch (err) {
      setError(failure(err).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" aria-label={label} title={error ?? label} disabled={busy} onClick={(event) => void remove(event)} className={cn('rounded-md p-1 hover:bg-ink-800', confirming ? 'text-red-300' : 'text-ink-400 hover:text-red-300')}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

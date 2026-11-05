import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import {
  BED_STATUSES,
  ORGANIZATION_TYPES,
  STANDARD_EMPLOYEE_TYPES,
  exceedsCapacity,
  isAllowedCapacity,
  organizationTypeOf,
  roomTypeOf,
  type BedStatus,
  type MasterKind,
  type OrganizationTypeCode,
  type OrganizationTypeDefinition,
} from '../config/organizationTypes';
import { Bed, Department, EmployeeType, Floor, Organization, Room, sequelize } from '../models';
import type { AuthContext } from '../types/auth';
import { AppError } from '../utils/errors';
import { audit } from './audit.service';

interface Actor {
  userId: string;
  ip: string | null;
}

function places(type: OrganizationTypeDefinition) {
  if (type.master !== 'lodging' && type.master !== 'layout') {
    throw AppError.conflict(`${type.label} organizations do not use floors and rooms.`);
  }
}

function bedsAllowed(type: OrganizationTypeDefinition) {
  if (type.master !== 'lodging') throw AppError.conflict(`${type.label} organizations do not track individual beds.`);
}

function workforce(type: OrganizationTypeDefinition) {
  if (type.master !== 'workforce') throw AppError.conflict(`${type.label} organizations do not use employee types or departments.`);
}

function overLimit(type: OrganizationTypeDefinition, capacity: number, used: number) {
  const remaining = Math.max(0, capacity - used);
  return `This exceeds the ${type.capacityLabel.toLowerCase()} of ${capacity}. ${remaining} ${type.capacityUnit} remaining.`;
}

async function load(ctx: AuthContext) {
  const org = await Organization.findByPk(ctx.organizationId);
  if (!org) throw AppError.notFound('Organization');
  return { org, type: organizationTypeOf(org.organizationType) };
}

async function allocatedRooms(organizationId: string, exceptRoomId?: string, transaction?: Transaction) {
  const rooms = await Room.findAll({ where: { organizationId }, attributes: ['id', 'capacity'], transaction });
  return rooms.filter((room) => room.id !== exceptRoomId).reduce((sum, room) => sum + room.capacity, 0);
}

async function allocatedSeats(organizationId: string, exceptId?: string, transaction?: Transaction) {
  const rows = await Department.findAll({ where: { organizationId }, attributes: ['id', 'seatLimit'], transaction });
  return rows.filter((row) => row.id !== exceptId).reduce((sum, row) => sum + (row.seatLimit ?? 0), 0);
}

async function committed(organizationId: string, master: MasterKind) {
  if (master === 'lodging') {
    const [beds, planned] = await Promise.all([Bed.count({ where: { organizationId } }), allocatedRooms(organizationId)]);
    return Math.max(beds, planned);
  }
  if (master === 'layout') return allocatedRooms(organizationId);
  if (master === 'workforce') return allocatedSeats(organizationId);
  return 0;
}

async function masterCount(organizationId: string, master: MasterKind) {
  if (master === 'lodging' || master === 'layout') return Floor.count({ where: { organizationId } });
  if (master === 'workforce') {
    const [types, departments] = await Promise.all([
      EmployeeType.count({ where: { organizationId } }),
      Department.count({ where: { organizationId } }),
    ]);
    return types + departments;
  }
  return 0;
}

/** Called inside the organization database. Blocks a type change that would orphan master data, and a capacity below what is already allocated. */
export async function assertProfileChange(organizationId: string, nextType: OrganizationTypeCode, nextCapacity: number | null) {
  const org = await Organization.findByPk(organizationId);
  if (!org) throw AppError.notFound('Organization');
  const from = organizationTypeOf(org.organizationType);
  const to = ORGANIZATION_TYPES[nextType];
  if (nextCapacity != null && !isAllowedCapacity(nextType, nextCapacity)) {
    throw AppError.validation([{ path: 'capacity', message: 'Choose a capacity listed for this organization type' }]);
  }
  if (from.code !== to.code && from.master !== 'none' && from.master !== to.master && (await masterCount(organizationId, from.master)) > 0) {
    throw AppError.conflict(`Remove the existing ${from.label.toLowerCase()} master data before changing the organization type to ${to.label}.`);
  }
  if (nextCapacity != null) {
    const used = await committed(organizationId, to.master);
    if (exceedsCapacity(nextCapacity, used)) {
      throw AppError.conflict(`Capacity cannot be ${nextCapacity} ${to.capacityUnit}. ${used} are already allocated.`);
    }
  }
}

async function findFloor(organizationId: string, id: string) {
  const floor = await Floor.findOne({ where: { id, organizationId } });
  if (!floor) throw AppError.notFound('Floor');
  return floor;
}

async function findRoom(organizationId: string, id: string) {
  const room = await Room.findOne({ where: { id, organizationId } });
  if (!room) throw AppError.notFound('Room');
  return room;
}

async function findBed(organizationId: string, id: string) {
  const bed = await Bed.findOne({ where: { id, organizationId } });
  if (!bed) throw AppError.notFound('Bed');
  return bed;
}

async function findEmployeeType(organizationId: string, id: string) {
  const row = await EmployeeType.findOne({ where: { id, organizationId } });
  if (!row) throw AppError.notFound('Employee type');
  return row;
}

async function findDepartment(organizationId: string, id: string) {
  const row = await Department.findOne({ where: { id, organizationId } });
  if (!row) throw AppError.notFound('Department');
  return row;
}

function requireCode(code: string | null | undefined) {
  if (!code) throw AppError.validation([{ path: 'code', message: 'Enter a code' }]);
  return code;
}

export async function overview(ctx: AuthContext) {
  const { org, type } = await load(ctx);
  const organizationId = org.id;
  const [floors, rooms, beds, employeeTypes, departments] = await Promise.all([
    Floor.findAll({ where: { organizationId }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
    Room.findAll({ where: { organizationId }, order: [['name', 'ASC']] }),
    Bed.findAll({ where: { organizationId }, order: [['label', 'ASC']] }),
    EmployeeType.findAll({ where: { organizationId }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
    Department.findAll({ where: { organizationId }, order: [['name', 'ASC']] }),
  ]);
  const floorName = new Map(floors.map((floor) => [floor.id, floor.name]));
  const roomCount = new Map<string, number>();
  const bedCount = new Map<string, number>();
  for (const room of rooms) roomCount.set(room.floorId, (roomCount.get(room.floorId) ?? 0) + 1);
  for (const bed of beds) bedCount.set(bed.roomId, (bedCount.get(bed.roomId) ?? 0) + 1);
  const roomName = new Map(rooms.map((room) => [room.id, room.name]));
  const roomFloor = new Map(rooms.map((room) => [room.id, room.floorId]));
  const planned = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const seats = departments.reduce((sum, row) => sum + (row.seatLimit ?? 0), 0);
  const used = type.master === 'lodging' ? beds.length : type.master === 'layout' ? planned : type.master === 'workforce' ? seats : 0;
  const capacity = org.capacity ?? null;
  return {
    profile: {
      code: type.code,
      label: type.label,
      description: type.description,
      capacityUnit: type.capacityUnit,
      capacityLabel: type.capacityLabel,
      capacities: [...type.capacities],
      master: type.master,
      capacity,
      roomCapacityLabel: type.roomCapacityLabel,
      roomTypes: type.roomTypes.map((room) => ({ code: room.code, label: room.label, defaultCapacity: room.defaultCapacity })),
    },
    usage: {
      used,
      remaining: capacity == null ? null : Math.max(0, capacity - used),
      unit: type.capacityUnit,
      planned: type.master === 'lodging' ? planned : null,
    },
    floors: floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      code: floor.code,
      sortOrder: floor.sortOrder,
      notes: floor.notes,
      roomCount: roomCount.get(floor.id) ?? 0,
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      floorId: room.floorId,
      floorName: floorName.get(room.floorId) ?? '',
      name: room.name,
      roomType: room.roomType,
      capacity: room.capacity,
      notes: room.notes,
      bedCount: bedCount.get(room.id) ?? 0,
    })),
    beds: beds.map((bed) => ({
      id: bed.id,
      roomId: bed.roomId,
      roomName: roomName.get(bed.roomId) ?? '',
      floorName: floorName.get(roomFloor.get(bed.roomId) ?? '') ?? '',
      label: bed.label,
      status: bed.status,
    })),
    employeeTypes: employeeTypes.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      sortOrder: row.sortOrder,
      active: row.active,
    })),
    departments: departments.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      seatLimit: row.seatLimit,
    })),
    bedStatuses: [...BED_STATUSES],
  };
}

async function record(ctx: AuthContext, actor: Actor, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await audit({
    organizationId: ctx.organizationId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    ipAddress: actor.ip,
    metadata,
  });
}

export async function createFloor(ctx: AuthContext, input: { name: string; code?: string | null; sortOrder: number; notes?: string | null }, actor: Actor) {
  const { org, type } = await load(ctx);
  places(type);
  if (input.code && (await Floor.findOne({ where: { organizationId: org.id, code: input.code } }))) {
    throw AppError.conflict('A floor with this code already exists');
  }
  if (await Floor.findOne({ where: { organizationId: org.id, name: input.name } })) throw AppError.conflict('A floor with this name already exists');
  const floor = await Floor.create({ organizationId: org.id, name: input.name, code: input.code ?? null, sortOrder: input.sortOrder, notes: input.notes ?? null });
  await record(ctx, actor, 'FLOOR_CREATED', 'floor', floor.id, { name: floor.name });
  return overview(ctx);
}

export async function updateFloor(
  ctx: AuthContext,
  id: string,
  input: { name?: string; code?: string | null; sortOrder?: number; notes?: string | null },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  places(type);
  const floor = await findFloor(org.id, id);
  if (input.name && input.name !== floor.name && (await Floor.findOne({ where: { organizationId: org.id, name: input.name } }))) {
    throw AppError.conflict('A floor with this name already exists');
  }
  if (input.code && input.code !== floor.code && (await Floor.findOne({ where: { organizationId: org.id, code: input.code } }))) {
    throw AppError.conflict('A floor with this code already exists');
  }
  await floor.update({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
  await record(ctx, actor, 'FLOOR_UPDATED', 'floor', floor.id, { name: floor.name });
  return overview(ctx);
}

export async function deleteFloor(ctx: AuthContext, id: string, actor: Actor) {
  const { org, type } = await load(ctx);
  places(type);
  const floor = await findFloor(org.id, id);
  if (await Room.count({ where: { floorId: floor.id } })) throw AppError.conflict('Delete the rooms on this floor first.');
  await floor.destroy();
  await record(ctx, actor, 'FLOOR_DELETED', 'floor', id, { name: floor.name });
  return overview(ctx);
}

async function assertRoomFits(org: Organization, type: OrganizationTypeDefinition, capacity: number, exceptRoomId?: string, transaction?: Transaction) {
  if (org.capacity == null) return;
  const used = await allocatedRooms(org.id, exceptRoomId, transaction);
  if (exceedsCapacity(org.capacity, used, capacity)) throw AppError.conflict(overLimit(type, org.capacity, used));
}

export async function createRoom(
  ctx: AuthContext,
  input: { floorId: string; name: string; roomType: string; capacity: number; notes?: string | null },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  places(type);
  if (!roomTypeOf(type.code, input.roomType)) throw AppError.validation([{ path: 'roomType', message: 'Choose a room type for this organization' }]);
  const floor = await Floor.findOne({ where: { id: input.floorId, organizationId: org.id } });
  if (!floor) throw AppError.validation([{ path: 'floorId', message: 'Choose a floor in this organization' }]);
  if (await Room.findOne({ where: { floorId: floor.id, name: input.name } })) throw AppError.conflict('A room with this name already exists on that floor');
  const room = await sequelize.transaction(async (transaction) => {
    await assertRoomFits(org, type, input.capacity, undefined, transaction);
    return Room.create(
      { organizationId: org.id, floorId: floor.id, name: input.name, roomType: input.roomType, capacity: input.capacity, notes: input.notes ?? null },
      { transaction },
    );
  });
  await record(ctx, actor, 'ROOM_CREATED', 'room', room.id, { name: room.name, floorId: floor.id });
  return overview(ctx);
}

export async function updateRoom(
  ctx: AuthContext,
  id: string,
  input: { floorId?: string; name?: string; roomType?: string; capacity?: number; notes?: string | null },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  places(type);
  const room = await findRoom(org.id, id);
  if (input.roomType && !roomTypeOf(type.code, input.roomType)) {
    throw AppError.validation([{ path: 'roomType', message: 'Choose a room type for this organization' }]);
  }
  const floorId = input.floorId ?? room.floorId;
  if (input.floorId) {
    const floor = await Floor.findOne({ where: { id: input.floorId, organizationId: org.id } });
    if (!floor) throw AppError.validation([{ path: 'floorId', message: 'Choose a floor in this organization' }]);
  }
  const nextName = input.name ?? room.name;
  if (input.name || input.floorId) {
    const clash = await Room.findOne({ where: { floorId, name: nextName, id: { [Op.ne]: room.id } } });
    if (clash) throw AppError.conflict('A room with this name already exists on that floor');
  }
  const nextCapacity = input.capacity ?? room.capacity;
  if (type.master === 'lodging') {
    const beds = await Bed.count({ where: { roomId: room.id } });
    if (nextCapacity < beds) throw AppError.conflict(`This room already has ${beds} beds. Remove beds before lowering its capacity.`);
  }
  await sequelize.transaction(async (transaction) => {
    await assertRoomFits(org, type, nextCapacity, room.id, transaction);
    await room.update(
      {
        ...(input.floorId !== undefined ? { floorId: input.floorId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      { transaction },
    );
  });
  await record(ctx, actor, 'ROOM_UPDATED', 'room', room.id, { name: room.name });
  return overview(ctx);
}

export async function deleteRoom(ctx: AuthContext, id: string, actor: Actor) {
  const { org, type } = await load(ctx);
  places(type);
  const room = await findRoom(org.id, id);
  if (await Bed.count({ where: { roomId: room.id } })) throw AppError.conflict('Delete the beds in this room first.');
  await room.destroy();
  await record(ctx, actor, 'ROOM_DELETED', 'room', id, { name: room.name });
  return overview(ctx);
}

export async function createBed(ctx: AuthContext, input: { roomId: string; label: string; status: BedStatus }, actor: Actor) {
  const { org, type } = await load(ctx);
  bedsAllowed(type);
  const room = await findRoom(org.id, input.roomId);
  if (await Bed.findOne({ where: { roomId: room.id, label: input.label } })) throw AppError.conflict('This room already has a bed with that label');
  const bed = await sequelize.transaction(async (transaction) => {
    const inRoom = await Bed.count({ where: { roomId: room.id }, transaction });
    if (inRoom >= room.capacity) {
      throw AppError.conflict(`This room holds ${room.capacity} ${room.capacity === 1 ? 'bed' : 'beds'}. Raise the room capacity or remove a bed first.`);
    }
    const total = await Bed.count({ where: { organizationId: org.id }, transaction });
    if (org.capacity != null && exceedsCapacity(org.capacity, total, 1)) throw AppError.conflict(overLimit(type, org.capacity, total));
    return Bed.create({ organizationId: org.id, roomId: room.id, label: input.label, status: input.status }, { transaction });
  });
  await record(ctx, actor, 'BED_CREATED', 'bed', bed.id, { label: bed.label, roomId: room.id });
  return overview(ctx);
}

export async function updateBed(ctx: AuthContext, id: string, input: { label?: string; status?: BedStatus }, actor: Actor) {
  const { org, type } = await load(ctx);
  bedsAllowed(type);
  const bed = await findBed(org.id, id);
  if (input.label && input.label !== bed.label && (await Bed.findOne({ where: { roomId: bed.roomId, label: input.label } }))) {
    throw AppError.conflict('This room already has a bed with that label');
  }
  await bed.update({
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  });
  await record(ctx, actor, 'BED_UPDATED', 'bed', bed.id, { label: bed.label, status: bed.status });
  return overview(ctx);
}

export async function deleteBed(ctx: AuthContext, id: string, actor: Actor) {
  const { org, type } = await load(ctx);
  bedsAllowed(type);
  const bed = await findBed(org.id, id);
  await bed.destroy();
  await record(ctx, actor, 'BED_DELETED', 'bed', id, { label: bed.label });
  return overview(ctx);
}

async function assertSeats(org: Organization, type: OrganizationTypeDefinition, seatLimit: number | null, exceptId?: string, transaction?: Transaction) {
  if (org.capacity == null || !seatLimit) return;
  const used = await allocatedSeats(org.id, exceptId, transaction);
  if (exceedsCapacity(org.capacity, used, seatLimit)) throw AppError.conflict(overLimit(type, org.capacity, used));
}

export async function createEmployeeType(
  ctx: AuthContext,
  input: { name: string; code?: string | null; description?: string | null; sortOrder: number; active: boolean },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  workforce(type);
  const code = requireCode(input.code);
  if (await EmployeeType.findOne({ where: { organizationId: org.id, code } })) throw AppError.conflict('An employee type with this code already exists');
  if (await EmployeeType.findOne({ where: { organizationId: org.id, name: input.name } })) throw AppError.conflict('An employee type with this name already exists');
  const row = await EmployeeType.create({
    organizationId: org.id,
    name: input.name,
    code,
    description: input.description ?? null,
    sortOrder: input.sortOrder,
    active: input.active,
  });
  await record(ctx, actor, 'EMPLOYEE_TYPE_CREATED', 'employee_type', row.id, { name: row.name, code });
  return overview(ctx);
}

export async function updateEmployeeType(
  ctx: AuthContext,
  id: string,
  input: { name?: string; code?: string | null; description?: string | null; sortOrder?: number; active?: boolean },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  workforce(type);
  const row = await findEmployeeType(org.id, id);
  const code = input.code === undefined ? undefined : requireCode(input.code);
  if (code && code !== row.code && (await EmployeeType.findOne({ where: { organizationId: org.id, code } }))) {
    throw AppError.conflict('An employee type with this code already exists');
  }
  if (input.name && input.name !== row.name && (await EmployeeType.findOne({ where: { organizationId: org.id, name: input.name } }))) {
    throw AppError.conflict('An employee type with this name already exists');
  }
  await row.update({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  });
  await record(ctx, actor, 'EMPLOYEE_TYPE_UPDATED', 'employee_type', row.id, { name: row.name });
  return overview(ctx);
}

export async function deleteEmployeeType(ctx: AuthContext, id: string, actor: Actor) {
  const { org, type } = await load(ctx);
  workforce(type);
  const row = await findEmployeeType(org.id, id);
  await row.destroy();
  await record(ctx, actor, 'EMPLOYEE_TYPE_DELETED', 'employee_type', id, { name: row.name });
  return overview(ctx);
}

export async function addDefaultEmployeeTypes(ctx: AuthContext, actor: Actor) {
  const { org, type } = await load(ctx);
  workforce(type);
  const existing = await EmployeeType.findAll({ where: { organizationId: org.id }, attributes: ['code', 'name'] });
  const codes = new Set(existing.map((row) => row.code));
  const names = new Set(existing.map((row) => row.name.toLowerCase()));
  const created: string[] = [];
  for (const item of STANDARD_EMPLOYEE_TYPES) {
    if (codes.has(item.code) || names.has(item.name.toLowerCase())) continue;
    const row = await EmployeeType.create({ organizationId: org.id, ...item, active: true });
    created.push(row.code);
  }
  if (created.length) await record(ctx, actor, 'EMPLOYEE_TYPES_SEEDED', 'employee_type', org.id, { codes: created });
  return overview(ctx);
}

export async function createDepartment(
  ctx: AuthContext,
  input: { name: string; code?: string | null; description?: string | null; seatLimit: number | null },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  workforce(type);
  const code = requireCode(input.code);
  if (await Department.findOne({ where: { organizationId: org.id, code } })) throw AppError.conflict('A department with this code already exists');
  if (await Department.findOne({ where: { organizationId: org.id, name: input.name } })) throw AppError.conflict('A department with this name already exists');
  const row = await sequelize.transaction(async (transaction) => {
    await assertSeats(org, type, input.seatLimit, undefined, transaction);
    return Department.create(
      { organizationId: org.id, name: input.name, code, description: input.description ?? null, seatLimit: input.seatLimit },
      { transaction },
    );
  });
  await record(ctx, actor, 'DEPARTMENT_CREATED', 'department', row.id, { name: row.name, seatLimit: row.seatLimit });
  return overview(ctx);
}

export async function updateDepartment(
  ctx: AuthContext,
  id: string,
  input: { name?: string; code?: string | null; description?: string | null; seatLimit?: number | null },
  actor: Actor,
) {
  const { org, type } = await load(ctx);
  workforce(type);
  const row = await findDepartment(org.id, id);
  const code = input.code === undefined ? undefined : requireCode(input.code);
  if (code && code !== row.code && (await Department.findOne({ where: { organizationId: org.id, code } }))) {
    throw AppError.conflict('A department with this code already exists');
  }
  if (input.name && input.name !== row.name && (await Department.findOne({ where: { organizationId: org.id, name: input.name } }))) {
    throw AppError.conflict('A department with this name already exists');
  }
  const nextLimit = input.seatLimit === undefined ? row.seatLimit : input.seatLimit;
  await sequelize.transaction(async (transaction) => {
    await assertSeats(org, type, nextLimit, row.id, transaction);
    await row.update(
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.seatLimit !== undefined ? { seatLimit: input.seatLimit } : {}),
      },
      { transaction },
    );
  });
  await record(ctx, actor, 'DEPARTMENT_UPDATED', 'department', row.id, { name: row.name });
  return overview(ctx);
}

export async function deleteDepartment(ctx: AuthContext, id: string, actor: Actor) {
  const { org, type } = await load(ctx);
  workforce(type);
  const row = await findDepartment(org.id, id);
  await row.destroy();
  await record(ctx, actor, 'DEPARTMENT_DELETED', 'department', id, { name: row.name });
  return overview(ctx);
}

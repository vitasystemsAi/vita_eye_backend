import type { Transaction } from 'sequelize';
import { organizationTypeOf } from '../config/organizationTypes';
import { Bed, Floor, Organization, Room, sequelize } from '../models';
import type { AuthContext } from '../types/auth';
import { AppError } from '../utils/errors';
import { audit } from './audit.service';
import { overview } from './premises.service';
import {
  buildPremisesTemplate,
  describeImportSummary,
  planPremisesImport,
  readPremisesWorkbook,
  resolvePremisesImport,
  type ImportIssue,
  type ImportSummaryCounts,
} from './premisesWorkbook';

interface Actor {
  userId: string;
  ip: string | null;
}

function reject(issues: ImportIssue[]): never {
  const shown = issues.slice(0, 30);
  if (issues.length > 30) shown.push({ path: 'File', message: `${issues.length - 30} more problems are in the sheet.` });
  throw AppError.validation(shown, 'Fix the spreadsheet and import it again. Nothing was saved.');
}

async function loadOrg(ctx: AuthContext) {
  const org = await Organization.findByPk(ctx.organizationId);
  if (!org) throw AppError.notFound('Organization');
  const type = organizationTypeOf(org.organizationType);
  if (type.master !== 'lodging' && type.master !== 'layout') {
    throw AppError.conflict(`${type.label} organizations do not use floors and rooms.`);
  }
  return { org, type };
}

export async function templateFor(ctx: AuthContext) {
  const { org, type } = await loadOrg(ctx);
  return buildPremisesTemplate({ organizationName: org.name, type, capacity: org.capacity ?? null });
}

export async function importPremises(ctx: AuthContext, buffer: Buffer, filename: string, actor: Actor) {
  const { org, type } = await loadOrg(ctx);
  const read = await readPremisesWorkbook(buffer, filename);
  if (read.tooMany) reject([{ path: 'File', message: 'This sheet is too large. Split it into files of 2,000 rows or fewer.' }]);
  const planned = planPremisesImport(read.matrix, type);
  if (read.exampleOnly && (!planned.plan || planned.plan.floors.length === 0)) {
    reject([{ path: 'Premises', message: 'The Premises sheet is empty. The Example sheet is only a sample and is not imported. Copy your rows onto Premises.' }]);
  }
  if (planned.issues.length || !planned.plan) {
    reject(planned.issues.length ? planned.issues : [{ path: 'Premises', message: 'Add at least one floor or room below the header row.' }]);
  }
  const plan = planned.plan;

  const summary = await sequelize.transaction(async (transaction) => {
    const floors = await Floor.findAll({ where: { organizationId: org.id }, transaction, lock: transaction.LOCK.UPDATE });
    const rooms = await Room.findAll({ where: { organizationId: org.id }, transaction, lock: transaction.LOCK.UPDATE });
    const beds = type.master === 'lodging'
      ? await Bed.findAll({ where: { organizationId: org.id }, transaction, lock: transaction.LOCK.UPDATE })
      : [];
    const resolved = resolvePremisesImport(
      plan,
      {
        floors: floors.map((floor) => ({ id: floor.id, name: floor.name, code: floor.code, sortOrder: floor.sortOrder, notes: floor.notes })),
        rooms: rooms.map((room) => ({ id: room.id, floorId: room.floorId, name: room.name, roomType: room.roomType, capacity: room.capacity, notes: room.notes })),
        beds: beds.map((bed) => ({ roomId: bed.roomId, label: bed.label })),
      },
      type,
      org.capacity ?? null,
    );
    if (resolved.issues.length) reject(resolved.issues);
    await applyImport(org.id, resolved.actions, floors, rooms, transaction);
    return resolved.summary;
  });

  await audit({
    organizationId: ctx.organizationId,
    userId: actor.userId,
    action: 'PREMISES_IMPORTED',
    entityType: 'organization',
    entityId: org.id,
    ipAddress: actor.ip,
    metadata: { ...summary },
  });
  return { overview: await overview(ctx), summary: { ...summary, message: describeImportSummary(summary) } };
}

function recordKey(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function applyImport(
  organizationId: string,
  actions: ReturnType<typeof resolvePremisesImport>['actions'],
  floors: Floor[],
  rooms: Room[],
  transaction: Transaction,
) {
  const floorIds = new Map(floors.map((floor) => [recordKey(floor.name), floor.id]));
  for (const floor of actions.createFloors) {
    const created = await Floor.create(
      { organizationId, name: floor.name, code: floor.code, sortOrder: floor.sortOrder, notes: floor.notes },
      { transaction },
    );
    floorIds.set(floor.key, created.id);
  }
  for (const update of actions.updateFloors) {
    const floor = floors.find((item) => item.id === update.id);
    if (!floor) continue;
    await floor.update(
      {
        ...(update.code !== undefined ? { code: update.code } : {}),
        ...(update.notes !== undefined ? { notes: update.notes } : {}),
      },
      { transaction },
    );
    if (update.code) floorIds.set(recordKey(floor.name), floor.id);
  }
  const roomIds = new Map(rooms.map((room) => [`${room.floorId}:${recordKey(room.name)}`, room.id]));
  for (const room of actions.createRooms) {
    const floorId = floorIds.get(room.floorKey);
    if (!floorId) throw AppError.conflict(`Could not place room ${room.name} because its floor was not saved.`);
    const created = await Room.create(
      { organizationId, floorId, name: room.name, roomType: room.roomType, capacity: room.capacity, notes: room.notes },
      { transaction },
    );
    roomIds.set(`${floorId}:${recordKey(room.name)}`, created.id);
  }
  for (const update of actions.updateRooms) {
    const room = rooms.find((item) => item.id === update.id);
    if (room) await room.update({ notes: update.notes }, { transaction });
  }
  for (const bed of actions.createBeds) {
    const floorId = floorIds.get(bed.floorKey);
    const roomId = floorId ? roomIds.get(`${floorId}:${recordKey(bed.roomName)}`) : undefined;
    if (!roomId) throw AppError.conflict(`Could not place bed ${bed.label} because its room was not saved.`);
    await Bed.create({ organizationId, roomId, label: bed.label, status: bed.status }, { transaction });
  }
}

export type { ImportSummaryCounts };

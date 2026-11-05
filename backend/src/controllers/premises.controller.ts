import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as premises from '../services/premises.service';
import { parse } from '../utils/errors';
import { clientIp, ok } from '../utils/http';
import {
  createBedSchema,
  createDepartmentSchema,
  createEmployeeTypeSchema,
  createFloorSchema,
  createRoomSchema,
  idParam,
  updateBedSchema,
  updateDepartmentSchema,
  updateEmployeeTypeSchema,
  updateFloorSchema,
  updateRoomSchema,
} from '../validators/premises.validators';

const actor = (req: Request) => ({ userId: authOf(req).userId, ip: clientIp(req) });
const idOf = (req: Request) => parse(idParam, req.params).id;

export async function overview(req: Request, res: Response) {
  ok(res, await premises.overview(authOf(req)));
}

export async function createFloor(req: Request, res: Response) {
  ok(res, await premises.createFloor(authOf(req), parse(createFloorSchema, req.body), actor(req)));
}

export async function updateFloor(req: Request, res: Response) {
  ok(res, await premises.updateFloor(authOf(req), idOf(req), parse(updateFloorSchema, req.body), actor(req)));
}

export async function deleteFloor(req: Request, res: Response) {
  ok(res, await premises.deleteFloor(authOf(req), idOf(req), actor(req)));
}

export async function createRoom(req: Request, res: Response) {
  ok(res, await premises.createRoom(authOf(req), parse(createRoomSchema, req.body), actor(req)));
}

export async function updateRoom(req: Request, res: Response) {
  ok(res, await premises.updateRoom(authOf(req), idOf(req), parse(updateRoomSchema, req.body), actor(req)));
}

export async function deleteRoom(req: Request, res: Response) {
  ok(res, await premises.deleteRoom(authOf(req), idOf(req), actor(req)));
}

export async function createBed(req: Request, res: Response) {
  ok(res, await premises.createBed(authOf(req), parse(createBedSchema, req.body), actor(req)));
}

export async function updateBed(req: Request, res: Response) {
  ok(res, await premises.updateBed(authOf(req), idOf(req), parse(updateBedSchema, req.body), actor(req)));
}

export async function deleteBed(req: Request, res: Response) {
  ok(res, await premises.deleteBed(authOf(req), idOf(req), actor(req)));
}

export async function createEmployeeType(req: Request, res: Response) {
  ok(res, await premises.createEmployeeType(authOf(req), parse(createEmployeeTypeSchema, req.body), actor(req)));
}

export async function updateEmployeeType(req: Request, res: Response) {
  ok(res, await premises.updateEmployeeType(authOf(req), idOf(req), parse(updateEmployeeTypeSchema, req.body), actor(req)));
}

export async function deleteEmployeeType(req: Request, res: Response) {
  ok(res, await premises.deleteEmployeeType(authOf(req), idOf(req), actor(req)));
}

export async function seedEmployeeTypes(req: Request, res: Response) {
  ok(res, await premises.addDefaultEmployeeTypes(authOf(req), actor(req)));
}

export async function createDepartment(req: Request, res: Response) {
  ok(res, await premises.createDepartment(authOf(req), parse(createDepartmentSchema, req.body), actor(req)));
}

export async function updateDepartment(req: Request, res: Response) {
  ok(res, await premises.updateDepartment(authOf(req), idOf(req), parse(updateDepartmentSchema, req.body), actor(req)));
}

export async function deleteDepartment(req: Request, res: Response) {
  ok(res, await premises.deleteDepartment(authOf(req), idOf(req), actor(req)));
}

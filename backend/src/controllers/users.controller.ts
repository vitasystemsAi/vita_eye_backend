import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as users from '../services/users.service';
import { listRoles } from '../services/rbac.service';
import { parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { createUserSchema, idParam, listUsersSchema, updateUserSchema } from '../validators/users.validators';
import { PERMISSIONS } from '../config/rbac';

export async function list(req: Request, res: Response) {
  const { items, meta } = await users.listUsers(authOf(req), parse(listUsersSchema, req.query));
  ok(res, items, meta);
}

export async function create(req: Request, res: Response) {
  created(res, await users.createUser(authOf(req), parse(createUserSchema, req.body), clientIp(req)));
}

export async function update(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  ok(res, await users.updateUser(authOf(req), id, parse(updateUserSchema, req.body), clientIp(req)));
}

export async function roles(_req: Request, res: Response) {
  const list = await listRoles();
  ok(res, {
    roles: list.map((r) => ({ id: r.id, name: r.name, permissions: [...r.permissions].sort() })),
    permissions: Object.entries(PERMISSIONS).map(([name, description]) => ({ name, description })),
  });
}

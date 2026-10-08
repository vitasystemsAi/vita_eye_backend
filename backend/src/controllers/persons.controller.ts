import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as persons from '../services/persons.service';
import { parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { idParam } from '../validators/users.validators';
import { createPersonSchema, enrollSchema, listPersonsSchema, updatePersonSchema } from '../validators/persons.validators';

export async function list(req: Request, res: Response) {
  const { items, meta } = await persons.listPersons(authOf(req), parse(listPersonsSchema, req.query));
  ok(res, items, meta);
}

export async function get(req: Request, res: Response) {
  ok(res, await persons.getPerson(authOf(req), parse(idParam, req.params).id));
}

export async function create(req: Request, res: Response) {
  created(res, await persons.createPerson(authOf(req), parse(createPersonSchema, req.body), clientIp(req)));
}

export async function update(req: Request, res: Response) {
  ok(res, await persons.updatePerson(authOf(req), parse(idParam, req.params).id, parse(updatePersonSchema, req.body), clientIp(req)));
}

export async function enroll(req: Request, res: Response) {
  const consent = parse(enrollSchema, req.body);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  ok(
    res,
    await persons.enroll(
      authOf(req),
      parse(idParam, req.params).id,
      files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname })),
      consent,
      clientIp(req),
    ),
  );
}

export async function deactivate(req: Request, res: Response) {
  ok(res, await persons.setActive(authOf(req), parse(idParam, req.params).id, false, clientIp(req)));
}

export async function activate(req: Request, res: Response) {
  ok(res, await persons.setActive(authOf(req), parse(idParam, req.params).id, true, clientIp(req)));
}

export async function remove(req: Request, res: Response) {
  ok(res, await persons.deletePerson(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

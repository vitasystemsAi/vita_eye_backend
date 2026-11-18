import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as persons from '../services/persons.service';
import { guidePose, type PoseTarget } from '../services/ai.client';
import { AppError, parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { z } from 'zod';
import { idParam } from '../validators/users.validators';
import { createPersonSchema, enrollSchema, listPersonsSchema, poseTargetSchema, setStatusSchema, updatePersonSchema } from '../validators/persons.validators';

export async function list(req: Request, res: Response) {
  const { items, meta } = await persons.listPersons(authOf(req), parse(listPersonsSchema, req.query));
  ok(res, items, meta);
}

export async function get(req: Request, res: Response) {
  ok(res, await persons.getPerson(authOf(req), parse(idParam, req.params).id));
}

export async function facePhoto(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  const { templateId } = parse(z.object({ templateId: z.string().uuid() }), req.params);
  const photo = await persons.readFacePhoto(authOf(req), id, templateId);
  res.setHeader('Content-Type', photo.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(photo.data);
}

export async function create(req: Request, res: Response) {
  created(res, await persons.createPerson(authOf(req), parse(createPersonSchema, req.body), clientIp(req)));
}

export async function update(req: Request, res: Response) {
  ok(res, await persons.updatePerson(authOf(req), parse(idParam, req.params).id, parse(updatePersonSchema, req.body), clientIp(req)));
}

export async function poseGuide(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw AppError.badRequest('Image is required');
  const { target } = parse(poseTargetSchema, req.body);
  ok(res, await guidePose(file.buffer, file.mimetype || 'image/jpeg', target as PoseTarget));
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

export async function changeStatus(req: Request, res: Response) {
  const body = parse(setStatusSchema, req.body);
  ok(res, await persons.setStatus(authOf(req), parse(idParam, req.params).id, body.status, clientIp(req)));
}

export async function deactivate(req: Request, res: Response) {
  ok(res, await persons.setActive(authOf(req), parse(idParam, req.params).id, false, clientIp(req)));
}

export async function activate(req: Request, res: Response) {
  ok(res, await persons.setActive(authOf(req), parse(idParam, req.params).id, true, clientIp(req)));
}

export async function cancel(req: Request, res: Response) {
  ok(res, await persons.cancelRegistration(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

export async function remove(req: Request, res: Response) {
  ok(res, await persons.deletePerson(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

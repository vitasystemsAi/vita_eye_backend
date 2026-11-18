import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as cameras from '../services/cameras.service';
import { parse } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { idParam } from '../validators/users.validators';
import { createCameraSchema, listCamerasSchema, testDraftSchema, updateCameraSchema } from '../validators/cameras.validators';

export async function list(req: Request, res: Response) {
  const { items, meta, sites } = await cameras.listCameras(authOf(req), parse(listCamerasSchema, req.query));
  res.json({ success: true, data: items, meta, sites });
}

export async function get(req: Request, res: Response) {
  ok(res, await cameras.getCamera(authOf(req), parse(idParam, req.params).id));
}

export async function create(req: Request, res: Response) {
  created(res, await cameras.createCamera(authOf(req), parse(createCameraSchema, req.body), clientIp(req)));
}

export async function update(req: Request, res: Response) {
  ok(res, await cameras.updateCamera(authOf(req), parse(idParam, req.params).id, parse(updateCameraSchema, req.body), clientIp(req)));
}

export async function remove(req: Request, res: Response) {
  ok(res, await cameras.deleteCamera(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

export async function test(req: Request, res: Response) {
  ok(res, await cameras.testConnection(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

export async function testDraft(req: Request, res: Response) {
  ok(res, await cameras.testDraftConnection(authOf(req), parse(testDraftSchema, req.body), clientIp(req)));
}

export async function discover(req: Request, res: Response) {
  ok(res, await cameras.discoverLanPorts());
}

export async function start(req: Request, res: Response) {
  ok(res, await cameras.startMonitoring(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

export async function stop(req: Request, res: Response) {
  ok(res, await cameras.stopMonitoring(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

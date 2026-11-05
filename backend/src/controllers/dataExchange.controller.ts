import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import * as exchange from '../services/dataExchange.service';
import { AppError, parse } from '../utils/errors';
import { clientIp, ok } from '../utils/http';
import { faceExportSchema, faceImportSchema, peopleExportSchema, peopleImportSchema, photoImportSchema } from '../validators/dataExchange.validators';

function sendFile(res: Response, file: { body: Buffer; contentType: string; fileName: string }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}

function actor(req: Request) {
  const ctx = authOf(req);
  return { userId: ctx.userId, ip: clientIp(req) };
}

export async function downloadPeopleTemplate(req: Request, res: Response) {
  sendFile(res, await exchange.peopleTemplate(authOf(req)));
}

export async function exportPeople(req: Request, res: Response) {
  sendFile(res, await exchange.exportPeople(authOf(req), parse(peopleExportSchema, req.query), actor(req)));
}

export async function importPeople(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw AppError.badRequest('Choose a spreadsheet to import');
  ok(res, await exchange.importPeople(authOf(req), file.buffer, file.originalname || 'people.xlsx', parse(peopleImportSchema, req.body), actor(req)));
}

export async function exportFaces(req: Request, res: Response) {
  sendFile(res, await exchange.exportFaces(authOf(req), parse(faceExportSchema, req.body), actor(req)));
}

export async function importFaces(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw AppError.badRequest('Choose a facial package to import');
  ok(res, await exchange.importFaces(authOf(req), file.buffer, parse(faceImportSchema, req.body), actor(req)));
}

export async function importFacePhotos(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw AppError.badRequest('Choose a ZIP of face photos');
  ok(res, await exchange.importFacePhotos(authOf(req), file.buffer, parse(photoImportSchema, req.body), actor(req)));
}

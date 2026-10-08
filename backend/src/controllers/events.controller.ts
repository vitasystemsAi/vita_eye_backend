import type { Request, Response } from 'express';
import { z } from 'zod';
import { authOf } from '../middleware/auth';
import * as detections from '../services/detections.service';
import * as eventExport from '../services/eventExport.service';
import * as evidence from '../services/evidence.service';
import { parse } from '../utils/errors';
import { clientIp, ok } from '../utils/http';
import { idParam } from '../validators/users.validators';
import { exportEventsSchema, listEventsSchema, noteSchema, resolveSchema } from '../validators/events.validators';

export async function list(req: Request, res: Response) {
  const { items, meta } = await detections.listEvents(authOf(req), parse(listEventsSchema, req.query));
  ok(res, items, meta);
}

export async function exportEvents(req: Request, res: Response) {
  const { format, images, tzOffset, ...filters } = parse(exportEventsSchema, req.query);
  const file = await eventExport.exportEvents(authOf(req), filters, { format, images, tzOffset }, clientIp(req));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}

export async function get(req: Request, res: Response) {
  ok(res, await detections.getEvent(authOf(req), parse(idParam, req.params).id));
}

const optionalNote = z.object({ note: z.string().trim().max(2000).optional() });

export async function acknowledge(req: Request, res: Response) {
  const { note } = parse(optionalNote, req.body ?? {});
  ok(res, await detections.review(authOf(req), parse(idParam, req.params).id, 'acknowledge', { note }, clientIp(req)));
}

export async function investigate(req: Request, res: Response) {
  const { note } = parse(optionalNote, req.body ?? {});
  ok(res, await detections.review(authOf(req), parse(idParam, req.params).id, 'investigate', { note }, clientIp(req)));
}

export async function resolve(req: Request, res: Response) {
  const body = parse(resolveSchema, req.body);
  ok(res, await detections.review(authOf(req), parse(idParam, req.params).id, 'resolve', body, clientIp(req)));
}

export async function reopen(req: Request, res: Response) {
  const { note } = parse(optionalNote, req.body ?? {});
  ok(res, await detections.review(authOf(req), parse(idParam, req.params).id, 'reopen', { note }, clientIp(req)));
}

export async function addNote(req: Request, res: Response) {
  ok(res, await detections.addNote(authOf(req), parse(idParam, req.params).id, parse(noteSchema, req.body).note, clientIp(req)));
}

export async function evidenceUrl(req: Request, res: Response) {
  ok(res, await evidence.issueEvidenceUrl(authOf(req), parse(idParam, req.params).id, clientIp(req)));
}

const evidenceIdsQuery = z.object({
  ids: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((v) => v.trim()).filter(Boolean))])
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
});

export async function evidenceUrls(req: Request, res: Response) {
  ok(res, await evidence.issueEvidenceUrls(authOf(req), parse(evidenceIdsQuery, req.query).ids, clientIp(req)));
}

export async function evidenceDownload(req: Request, res: Response) {
  const { token } = parse(z.object({ token: z.string().min(10).max(2000) }), req.query);
  const file = await evidence.readEvidence(authOf(req), token, clientIp(req));
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.send(file.data);
}

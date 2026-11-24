import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth';
import { runInTenant } from '../services/tenancy.service';
import { acceptConnectorFrame, connectorAssignments, issueConnectorKey, organizationIdForConnectorKey, requireConnectorOrganization } from '../services/siteConnector.service';
import { AppError } from '../utils/errors';
import { clientIp, created, ok } from '../utils/http';
import { idParam } from '../validators/users.validators';
import { parse } from '../utils/errors';

function connectorKey(req: Request): string {
  const key = req.get('x-connector-key');
  if (!key) throw AppError.unauthenticated('Site connector key was not accepted');
  return key;
}

export async function issue(req: Request, res: Response) {
  created(res, await issueConnectorKey(authOf(req), clientIp(req)));
}

export async function assignments(req: Request, res: Response) {
  const organizationId = requireConnectorOrganization(await organizationIdForConnectorKey(connectorKey(req)));
  ok(res, await runInTenant(organizationId, () => connectorAssignments(organizationId)));
}

export async function frame(req: Request, res: Response) {
  const organizationId = requireConnectorOrganization(await organizationIdForConnectorKey(connectorKey(req)));
  const { id } = parse(idParam, req.params);
  if (!Buffer.isBuffer(req.body)) throw AppError.badRequest('Send the frame as image/jpeg');
  ok(res, await runInTenant(organizationId, () => acceptConnectorFrame(organizationId, id, req.body as Buffer)));
}

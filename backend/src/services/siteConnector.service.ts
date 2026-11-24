import { Op } from 'sequelize';
import { Camera, Organization } from '../models';
import type { AuthContext } from '../types/auth';
import { randomToken, sha256 } from '../utils/crypto';
import { cipher, credentialsAad } from '../utils/cipher';
import { AppError } from '../utils/errors';
import { describeCameraReachability, withCredentials } from '../utils/network';
import { audit } from './audit.service';
import { NETWORK_TYPES, handleBrowserFrame } from './ingestion.service';
import { runInPrimaryDatabase } from '../db/tenantContext';

function connectorContext(organizationId: string): AuthContext {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    organizationId,
    name: 'Site connector',
    email: 'connector@local',
    role: 'SECURITY_ADMIN',
    permissions: new Set(['cameras:monitor', 'persons:view']),
    features: new Set(),
    siteScope: null,
    sessionId: null,
    impersonatedBy: null,
  } as AuthContext;
}

export async function issueConnectorKey(ctx: AuthContext, ip: string | null) {
  const key = randomToken(32);
  await runInPrimaryDatabase(() =>
    Organization.update({ connectorKeyHash: sha256(key) }, { where: { id: ctx.organizationId } }),
  );
  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'CONNECTOR_KEY_ISSUED',
    entityType: 'organization',
    entityId: ctx.organizationId,
    ipAddress: ip,
  });
  return { key };
}

export async function organizationIdForConnectorKey(key: string): Promise<string | null> {
  if (key.length < 20) return null;
  const org = await runInPrimaryDatabase(() =>
    Organization.scope('withConnectorKey').findOne({ where: { connectorKeyHash: sha256(key) }, attributes: ['id', 'connectorKeyHash'] }),
  );
  return org?.id ?? null;
}

/** Cameras this server cannot open. The connector at the client opens these and posts frames. */
export async function connectorAssignments(organizationId: string) {
  const cameras = await Camera.scope('withCredentials').findAll({
    where: {
      organizationId,
      isActive: true,
      monitoringEnabled: true,
      cameraType: { [Op.in]: [...NETWORK_TYPES] },
    },
  });
  const assigned = [];
  for (const cam of cameras) {
    if (!cam.streamReference) continue;
    let parsed: URL;
    try {
      parsed = new URL(cam.streamReference);
    } catch {
      continue;
    }
    if ((await describeCameraReachability(parsed)).open) continue;
    let creds: { username?: string; password?: string } | null = null;
    if (cam.encryptedCredentials) {
      try {
        creds = JSON.parse(cipher.decryptString(cam.encryptedCredentials, credentialsAad(cam.id))) as { username?: string; password?: string };
      } catch {
        continue;
      }
    }
    assigned.push({
      id: cam.id,
      name: cam.cameraName,
      samplingFps: cam.samplingFps,
      streamUrl: withCredentials(cam.streamReference, creds),
    });
  }
  return assigned;
}

export async function acceptConnectorFrame(organizationId: string, cameraId: string, jpeg: Buffer) {
  return handleBrowserFrame(connectorContext(organizationId), cameraId, jpeg, undefined, 'connector');
}

export function requireConnectorOrganization(organizationId: string | null): string {
  if (!organizationId) throw AppError.unauthenticated('Site connector key was not accepted');
  return organizationId;
}

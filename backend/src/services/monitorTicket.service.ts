import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const AUDIENCE = 'vita-eye-monitor';
const TTL_SECONDS = 7 * 86400;

export interface MonitorTicketClaims {
  sub: string;
  org: string;
  cam: string;
  jti: string;
  exp: number;
}

/**
 * Device ticket for one browser camera. It authorizes only frame ingest and stopping that camera,
 * survives logout, and is revoked when monitoring stops (cameras.monitor_ticket_id is cleared).
 * Connected devices receive a renewed ticket periodically so it never lapses while running.
 */
export function signMonitorTicket(t: { userId: string; organizationId: string; cameraId: string; ticketId: string }): string {
  return jwt.sign({ org: t.organizationId, cam: t.cameraId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
    issuer: 'vita-eye',
    audience: AUDIENCE,
    subject: t.userId,
    jwtid: t.ticketId,
  });
}

export function verifyMonitorTicket(token: string): MonitorTicketClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'vita-eye', audience: AUDIENCE }) as MonitorTicketClaims;
}

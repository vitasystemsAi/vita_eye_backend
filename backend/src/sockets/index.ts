import type http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { COOKIE_ACCESS } from '../middleware/auth';
import { Camera } from '../models';
import { buildAuthContext, verifyAccessToken } from '../services/auth.service';
import { stopMonitoring } from '../services/cameras.service';
import { handleBrowserFrame } from '../services/ingestion.service';
import { signMonitorTicket, verifyMonitorTicket, type MonitorTicketClaims } from '../services/monitorTicket.service';
import { runInTenant } from '../services/tenancy.service';
import type { AuthContext } from '../types/auth';
import { rooms, setIo } from './emitter';

const CONTEXT_REFRESH_MS = 60_000;
const TICKET_RENEW_MS = 6 * 3600_000;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

interface SocketData {
  ctx: AuthContext;
  ctxLoadedAt: number;
  exp: number;
  /** Present on monitoring-device sockets, which authenticate with a camera ticket instead of a login. */
  ticket?: MonitorTicketClaims;
}

type Ack = (r: unknown) => void;

function parseFrame(payload: { cameraId?: unknown; image?: unknown }) {
  const cameraId = typeof payload?.cameraId === 'string' && /^[0-9a-f-]{36}$/i.test(payload.cameraId) ? payload.cameraId : null;
  const image = Buffer.isBuffer(payload?.image) ? payload.image : payload?.image instanceof ArrayBuffer ? Buffer.from(payload.image) : null;
  return { cameraId, image };
}

async function authenticateTicket(token: string): Promise<SocketData | Error> {
  let claims: MonitorTicketClaims;
  try {
    claims = verifyMonitorTicket(token);
  } catch {
    return new Error('TICKET_INVALID');
  }
  return runInTenant(claims.org, async () => {
    const camera = await Camera.findByPk(claims.cam, { attributes: ['id', 'monitorTicketId'] });
    if (!camera || camera.monitorTicketId !== claims.jti) return new Error('TICKET_REVOKED');
    const ctx = await buildAuthContext(claims.sub, null);
    if (!ctx || ctx.organizationId !== claims.org) return new Error('TICKET_INVALID');
    return { ctx, ctxLoadedAt: Date.now(), exp: claims.exp, ticket: claims };
  });
}

export function createSocketServer(server: http.Server) {
  const io = new Server(server, {
    cors: { origin: env.frontendOrigins, credentials: true },
    maxHttpBufferSize: 3 * 1024 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !env.frontendOrigins.includes(origin)) return next(new Error('ORIGIN_NOT_ALLOWED'));
      const ticket = (socket.handshake.auth as { monitorTicket?: unknown } | undefined)?.monitorTicket;
      if (typeof ticket === 'string') {
        const result = await authenticateTicket(ticket);
        if (result instanceof Error) return next(result);
        (socket.data as SocketData) = result;
        return next();
      }
      const token = parseCookies(socket.handshake.headers.cookie)[COOKIE_ACCESS];
      if (!token) return next(new Error('UNAUTHENTICATED'));
      const claims = verifyAccessToken(token) as ReturnType<typeof verifyAccessToken> & { exp: number };
      const ctx = await runInTenant(claims.org, () => buildAuthContext(claims.sub, claims.sid, { impersonatedBy: claims.imp ?? null }), {
        impersonatedBy: claims.imp ?? null,
      });
      if (!ctx || ctx.organizationId !== claims.org) return next(new Error('UNAUTHENTICATED'));
      (socket.data as SocketData) = { ctx, ctxLoadedAt: Date.now(), exp: claims.exp };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    /** Socket events do not inherit async context: every handler re-enters the organization's database. */
    const inTenant = <T>(fn: () => Promise<T>) => runInTenant(data.ctx.organizationId, fn, { impersonatedBy: data.ctx.impersonatedBy });

    async function freshContext(): Promise<AuthContext | null> {
      if (Date.now() - data.ctxLoadedAt < CONTEXT_REFRESH_MS) return data.ctx;
      const ctx = await buildAuthContext(data.ctx.userId, data.ctx.sessionId, { impersonatedBy: data.ctx.impersonatedBy });
      if (!ctx) return null;
      data.ctx = ctx;
      data.ctxLoadedAt = Date.now();
      return ctx;
    }

    function onFrame(payload: { cameraId?: unknown; image?: unknown }, ack: Ack | undefined, ticket?: MonitorTicketClaims) {
      return inTenant(() => processFrame(payload, ack, ticket));
    }

    async function processFrame(payload: { cameraId?: unknown; image?: unknown }, ack: Ack | undefined, ticket?: MonitorTicketClaims) {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        const ctx = await freshContext();
        if (!ctx) {
          reply({ ok: false, error: 'UNAUTHENTICATED' });
          socket.disconnect(true);
          return;
        }
        const { cameraId, image } = parseFrame(payload);
        if (!cameraId || !image) return reply({ ok: false, error: 'INVALID_PAYLOAD' });
        if (ticket && cameraId !== ticket.cam) return reply({ ok: false, error: 'CAMERA_NOT_FOUND' });
        reply(await handleBrowserFrame(ctx, cameraId, image, ticket?.jti));
      } catch (err) {
        logger.error({ err }, 'Socket frame handler failed');
        reply({ ok: false, error: 'INTERNAL_ERROR' });
      }
    }

    if (data.ticket) {
      const ticket = data.ticket;
      const renew = () => {
        socket.emit('monitor:ticket', signMonitorTicket({ userId: ticket.sub, organizationId: ticket.org, cameraId: ticket.cam, ticketId: ticket.jti }));
      };
      renew();
      const renewTimer = setInterval(renew, TICKET_RENEW_MS);

      socket.on('frame', (payload, ack?: Ack) => void onFrame(payload, ack, ticket));
      socket.on('monitor:stop', (_payload: unknown, ack?: Ack) =>
        inTenant(async () => {
          const reply = typeof ack === 'function' ? ack : () => undefined;
          try {
            const camera = await Camera.findByPk(ticket.cam, { attributes: ['id', 'monitorTicketId'] });
            if (camera?.monitorTicketId === ticket.jti) await stopMonitoring(data.ctx, ticket.cam, socket.handshake.address ?? null, 'monitor-device');
            reply({ ok: true });
            socket.disconnect(true);
          } catch (err) {
            logger.warn({ err: (err as Error).message, cameraId: ticket.cam }, 'Device stop-monitoring failed');
            reply({ ok: false, error: 'STOP_FAILED' });
          }
        }),
      );
      socket.on('disconnect', () => clearInterval(renewTimer));
      return;
    }

    socket.join(rooms.org(data.ctx.organizationId));
    socket.join(rooms.user(data.ctx.userId));

    // Force re-authentication when the access token expires; the client refreshes and reconnects.
    const ttl = Math.max(1000, data.exp * 1000 - Date.now());
    const expiry = setTimeout(() => {
      socket.emit('session:expired');
      socket.disconnect(true);
    }, ttl);

    socket.on('frame', (payload, ack?: Ack) => void onFrame(payload, ack));
    socket.on('disconnect', () => clearTimeout(expiry));
  });

  setIo(io);
  return io;
}

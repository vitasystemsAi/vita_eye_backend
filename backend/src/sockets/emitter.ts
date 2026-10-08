import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export const rooms = {
  org: (orgId: string) => `org:${orgId}`,
  user: (userId: string) => `user:${userId}`,
};

export function emitToOrg(orgId: string, event: string, payload: unknown) {
  io?.to(rooms.org(orgId)).emit(event, payload);
}

/** Drops every live socket for an organization (hold, forced sign-out). */
export function disconnectOrg(orgId: string) {
  io?.in(rooms.org(orgId)).disconnectSockets(true);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(rooms.user(userId)).emit(event, payload);
}

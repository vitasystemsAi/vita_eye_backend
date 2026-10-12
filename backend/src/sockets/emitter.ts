import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export const rooms = {
  org: (orgId: string) => `org:${orgId}`,
  user: (userId: string) => `user:${userId}`,
  /** Logged-in viewers watching one camera's live picture. A socket may join several of these. */
  preview: (cameraId: string) => `preview:${cameraId}`,
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

export function previewWatcherCount(cameraId: string): number {
  return io?.sockets.adapter.rooms.get(rooms.preview(cameraId))?.size ?? 0;
}

/** Live JPEG for viewers of one camera. Skipped entirely when nobody is watching. */
export function emitToPreview(cameraId: string, event: string, payload: unknown, opts?: { volatile?: boolean }) {
  if (!io || previewWatcherCount(cameraId) === 0) return;
  const target = opts?.volatile ? io.to(rooms.preview(cameraId)).volatile : io.to(rooms.preview(cameraId));
  target.emit(event, payload);
}

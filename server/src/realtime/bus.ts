import { Server as SocketServer } from 'socket.io';
import type { SocketEventName } from '../config/constants';
import { logger } from '../config/logger';

/**
 * Thin broadcast bus. Services emit domain events through this module instead of
 * importing Socket.IO directly, which keeps the domain layer transport-agnostic
 * and free of circular imports.
 */
let io: SocketServer | null = null;

export function attachBus(server: SocketServer): void {
  io = server;
}

export function getBus(): SocketServer | null {
  return io;
}

export function emitEvent(event: SocketEventName, payload: unknown, room?: string): void {
  if (!io) {
    logger.debug(`[bus] dropped ${event} — realtime layer not attached yet`);
    return;
  }
  if (room) io.to(room).emit(event, payload);
  else io.emit(event, payload);
}

export function emitMany(event: SocketEventName, payload: unknown, rooms: string[]): void {
  for (const room of rooms) emitEvent(event, payload, room);
}

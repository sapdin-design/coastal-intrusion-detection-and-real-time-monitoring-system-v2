import { io, type Socket } from 'socket.io-client';

/**
 * Socket.IO client singleton.
 *
 * One connection per tab, shared by every page — the live map, the alert console
 * and the incident board all subscribe to the same socket through
 * `RealtimeProvider`, so switching pages never re-handshakes or drops frames.
 */
let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected && socket.auth && (socket.auth as { token?: string }).token === token) {
    return socket;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io({
    // Same-origin by default: the Vite dev server proxies /socket.io to the API.
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 6000,
    timeout: 12_000,
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

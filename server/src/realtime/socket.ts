import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '../config/constants';
import { authService } from '../services/auth.service';
import { getStore } from '../repositories';
import { geofenceEngine } from '../services/geofence.service';
import { simulationEngine } from '../services/simulation.service';
import { attachBus } from './bus';

interface SocketData {
  userId: string;
  name: string;
  role: string;
}

/**
 * Realtime layer.
 *
 * Every mutation that matters is broadcast on a named channel so the dashboard
 * never needs to poll — and never needs a refresh. Rooms let a client narrow its
 * subscription: the live map joins `monitoring`, the alert console joins `alerts`,
 * the incident board joins `incidents`.
 *
 * The handshake is authenticated with the same JWT as the REST API, so an
 * unauthenticated socket is rejected before it can observe any vessel movement.
 */
export function initRealtime(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    path: '/socket.io',
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);

    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    try {
      const payload = authService.verifyToken(token);
      (socket.data as SocketData) = {
        userId: payload.sub,
        name: payload.name,
        role: payload.role,
      };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const principal = socket.data as SocketData;
    logger.debug(`socket ${socket.id} connected (${principal.name}/${principal.role})`);

    // Default subscription: everything the monitoring dashboard needs.
    void socket.join([SOCKET_ROOMS.MONITORING, SOCKET_ROOMS.ALERTS, SOCKET_ROOMS.INCIDENTS]);

    // Immediate snapshot so a freshly opened tab renders populated, not empty.
    void (async () => {
      try {
        const [vessels, zones, alerts, incidents] = await Promise.all([
          getStore().vessels.list(),
          getStore().zones.list(),
          getStore().alerts.list(),
          getStore().incidents.list(),
        ]);
        socket.emit('snapshot', {
          vessels,
          zones,
          alerts: alerts.slice(0, 100),
          incidents: incidents.slice(0, 100),
          simulation: await simulationEngine.snapshot(),
          geofencePairs: geofenceEngine.snapshotSize(),
          serverTime: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn(`snapshot failed for socket ${socket.id}: ${(error as Error).message}`);
      }
    })();

    socket.on('subscribe', (rooms: string[]) => {
      const allowed = Object.values(SOCKET_ROOMS) as string[];
      for (const room of rooms.filter((r) => allowed.includes(r))) void socket.join(room);
    });

    socket.on('unsubscribe', (rooms: string[]) => {
      for (const room of rooms) void socket.leave(room);
    });

    socket.on('ping:server', (ack?: (payload: unknown) => void) => {
      if (typeof ack === 'function') {
        ack({ ok: true, serverTime: new Date().toISOString(), uptime: process.uptime() });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.debug(`socket ${socket.id} disconnected (${reason})`);
    });
  });

  attachBus(io);
  logger.info(`realtime layer ready on path /socket.io (origins: ${env.clientOrigins.join(', ')})`);

  // Periodic stats push keeps the dashboard tiles live even when nothing moves.
  const statsTimer = setInterval(() => {
    void (async () => {
      try {
        if (!io.sockets.sockets.size) return;
        const { analyticsService } = await import('../services/analytics.service');
        io.emit(SOCKET_EVENTS.STATS_UPDATED, await analyticsService.liveStats());
      } catch {
        /* stats are best-effort */
      }
    })();
  }, 5000);
  statsTimer.unref?.();

  return io;
}

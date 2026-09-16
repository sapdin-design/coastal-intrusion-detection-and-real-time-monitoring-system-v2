import compression from 'compression';
import cors from 'cors';
import express, { type Application } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { apiLimiter } from './middleware/rateLimit';
import { ApiError, errorHandler, notFoundHandler } from './middleware/error';
import { requestLogger } from './middleware/requestLogger';
import { apiRouter } from './routes';

/**
 * Express application factory.
 *
 * Hardening applied here: Helmet security headers, an explicit CORS allow-list
 * (never `*` with credentials), a global rate limiter, a 1 MB JSON ceiling and a
 * single terminal error handler. The app is exported separately from the HTTP
 * listener so it can be driven by supertest in an automated test suite.
 */
export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The dashboard is a separate origin; Leaflet tiles and Socket.IO need
      // cross-origin access, so the strict defaults are relaxed deliberately.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin/server tools (no Origin header) and the allow-list.
        // The allow-list already includes loopback aliases, so localhost and
        // 127.0.0.1 both work without extra configuration.
        if (!origin || env.clientOrigins.includes(origin)) return callback(null, true);
        // A rejected origin is a client problem, not a server crash — surfacing
        // it as a 500 would hide the real cause behind "Internal Server Error".
        return callback(ApiError.forbidden(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-device-key'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.get('/', (_req, res) => {
    res.json({
      name: 'CIDRTM API',
      description: 'Coastal Intrusion Detection & Real-Time Monitoring System',
      version: '1.0.0',
      docs: '/api/v1/health',
      realtime: 'socket.io (path: /socket.io)',
    });
  });

  app.use('/api/v1', apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

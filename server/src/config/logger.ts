import winston from 'winston';
import { env } from './env';

const { combine, timestamp, printf, colorize, errors, splat } = winston.format;

const line = printf((info) => {
  const { level, message, timestamp: ts, stack, ...meta } = info as Record<string, unknown> & {
    level: string;
    message: unknown;
    timestamp?: string;
    stack?: string;
  };
  const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${String(message)}${rest}${stack ? `\n${stack}` : ''}`;
});

export const logger = winston.createLogger({
  level: env.logLevel,
  format: combine(
    errors({ stack: true }),
    splat(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    env.isProd ? winston.format.json() : combine(colorize({ all: false, level: true }), line),
  ),
  transports: [new winston.transports.Console()],
  exitOnError: false,
});

/** Winston level used by the express request logger. */
export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'debug';

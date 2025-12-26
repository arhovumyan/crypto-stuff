/**
 * Logger utility for infra-signal-bot
 */

import Pino from 'pino';

// Handle both ESM and CJS pino exports
const pino = (Pino as any).default || Pino;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname,context',
      messageFormat: '{context} | {msg}',
      singleLine: false,
    },
  },
});

export function createLogger(context: string) {
  return {
    info: (msg: string, data?: object) => logger.info({ context, ...data }, msg),
    warn: (msg: string, data?: object) => logger.warn({ context, ...data }, msg),
    error: (msg: string, data?: object) => logger.error({ context, ...data }, msg),
    debug: (msg: string, data?: object) => logger.debug({ context, ...data }, msg),
  };
}

export { logger };


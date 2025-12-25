import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';

// Create logs directory
const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'trades.log');

export const logger = pino(
  {
    level: config.LOG_LEVEL,
  },
  config.NODE_ENV === 'development'
    ? pino.multistream([
        {
          level: 'info',
          stream: pino.transport({
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname,context',
              messageFormat: '{context} | {msg}',
              singleLine: false,
            },
          }),
        },
        {
          level: 'info',
          stream: pino.destination({
            dest: logFile,
            sync: false,
          }),
        },
      ])
    : pino.destination(logFile)
);

// Helper to create child loggers with context
export function createLogger(context: string) {
  return logger.child({ context });
}

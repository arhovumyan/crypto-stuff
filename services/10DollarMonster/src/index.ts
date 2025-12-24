/**
 * 10 Dollar Monster Service Entry Point
 */

import { TenDollarMonster } from './ten-dollar-monster.js';
import pino from 'pino';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss Z',
      ignore: 'pid,hostname',
      messageFormat: '{context} | {msg}',
    },
  },
});

const monster = new TenDollarMonster();

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info({ context: 'Received SIGINT, shutting down gracefully' });
  monster.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info({ context: 'Received SIGTERM, shutting down gracefully' });
  monster.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({
    context: 'Uncaught exception',
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({
    context: 'Unhandled rejection',
    reason,
    promise,
  });
});

// Start the service
monster.start().catch((error) => {
  logger.error({
    context: 'Failed to start 10DollarMonster',
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

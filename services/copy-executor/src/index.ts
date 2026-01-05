/**
 * Copy Executor Service Entry Point
 */

import { CopyExecutor } from './copy-executor.js';
import pino from 'pino';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname,context',
      messageFormat: '{context} | {msg}',
      singleLine: false,
    },
  })
);

const log = logger.child({ context: 'main' });

const executor = new CopyExecutor();

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('⚠️  Received SIGINT, shutting down gracefully');
  executor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('⚠️  Received SIGTERM, shutting down gracefully');
  executor.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log.error(`❌ Uncaught exception | ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error(`❌ Unhandled rejection | ${String(reason)}`);
});

// Start the service
executor.start().catch((error) => {
  log.error(`❌ Failed to start | ${error.message}`);
  process.exit(1);
});

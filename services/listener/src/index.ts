#!/usr/bin/env node
import { ListenerService } from './listener-service.js';
import { createLogger } from '@copytrader/shared';

const logger = createLogger('main');

async function main() {
  const service = new ListenerService();

  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n⚠️  Received SIGINT (Ctrl+C)');
    await service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\n⚠️  Received SIGTERM');
    await service.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error({ error }, '❌ Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, '❌ Unhandled promise rejection');
    process.exit(1);
  });

  // Start the service
  try {
    await service.start();
  } catch (error) {
    logger.error({ error }, '❌ Failed to start service');
    process.exit(1);
  }
}

main();

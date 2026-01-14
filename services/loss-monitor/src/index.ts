#!/usr/bin/env node
/**
 * Loss Monitor Service
 * 
 * Tracks all tokens in the wallet every second and automatically sells
 * any token that has a loss of 5% or more from its purchase price.
 */

import { LossMonitor } from './loss-monitor.js';
import { createLogger } from '@copytrader/shared';

const logger = createLogger('loss-monitor-main');

async function main() {
  const monitor = new LossMonitor();

  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n⚠️  Received SIGINT (Ctrl+C)');
    await monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\n⚠️  Received SIGTERM');
    await monitor.stop();
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

  // Start the monitor
  try {
    await monitor.start();
  } catch (error) {
    logger.error({ error }, '❌ Failed to start loss monitor');
    process.exit(1);
  }
}

main();


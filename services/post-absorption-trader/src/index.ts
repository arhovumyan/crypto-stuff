import { PostAbsorptionTrader } from './postAbsorptionTrader';
import logger from './logger';

/**
 * Main entry point for the Post-Absorption Trading Bot
 */
async function main() {
  const trader = new PostAbsorptionTrader();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n[Main] Received SIGINT - shutting down gracefully...');
    await trader.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\n[Main] Received SIGTERM - shutting down gracefully...');
    await trader.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('[Main] Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[Main] Unhandled rejection at:', promise, 'reason:', reason);
  });

  // Start the trader
  try {
    await trader.start();
  } catch (error) {
    logger.error('[Main] Failed to start trader:', error);
    process.exit(1);
  }
}

main();

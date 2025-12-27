import { InfraWalletDiscovery } from './infraWalletDiscovery';
import logger from './logger';

/**
 * Main entry point for Infrastructure Wallet Discovery
 */
async function main() {
  const discovery = new InfraWalletDiscovery();
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('\n[Main] Received SIGINT - shutting down gracefully...');
    await discovery.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('\n[Main] Received SIGTERM - shutting down gracefully...');
    await discovery.stop();
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
  
  // Start discovery
  try {
    await discovery.start();
  } catch (error) {
    logger.error('[Main] Failed to start discovery system:', error);
    process.exit(1);
  }
}

main();

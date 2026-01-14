import { DeathShotBot } from './orchestrator';
import { logger } from './logger';
import { Connection } from '@solana/web3.js';
import { loadTokensFromEnv } from './utils/poolDiscovery';
import { config } from './config';

// Main entry point
async function main() {
  const bot = new DeathShotBot();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection');
  });

  try {
    // Start the bot
    await bot.start();

    // Auto-discover and add tokens from .env TOKENS variable
    logger.info('Loading tokens from .env TOKENS variable...');
    const connection = new Connection(config.rpc.httpUrl);
    const pools = await loadTokensFromEnv(connection);
    
    if (pools.length === 0) {
      logger.warn('⚠️  No pools discovered!');
      logger.warn('Add token mint addresses to TOKENS in .env file');
      logger.warn('Example: TOKENS=TokenMint1...,TokenMint2...,TokenMint3...');
      logger.warn('Bot is running but not monitoring any markets.');
    } else {
      logger.info({ count: pools.length }, '✅ Discovered pools, adding to live monitor');
      
      for (const pool of pools) {
        try {
          await bot.addMarket(
            pool.mint,
            pool.poolAddress,
            pool.baseVault,
            pool.quoteVault
          );
          logger.info({ 
            mint: pool.mint, 
            poolType: pool.poolType,
            poolAddress: pool.poolAddress 
          }, '📡 Now monitoring token LIVE via WebSocket');
        } catch (error) {
          logger.error({ error, pool }, 'Failed to add market');
        }
      }
      
      logger.info('🎯 DeathShot is LIVE! Monitoring for dip-buy opportunities...');
    }

    logger.info('DeathShot bot is now running. Press Ctrl+C to stop.');

    // Keep process alive
    await new Promise(() => {});
  } catch (err) {
    logger.error({ err }, 'Fatal error during startup');
    await bot.stop();
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

export { DeathShotBot };

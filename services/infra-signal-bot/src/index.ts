/**
 * Infrastructure Signal Bot - Entry Point
 * Confirmation-based trading using infra trader behavior as signals
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { InfraSignalBot } from './infra-signal-bot.js';
import type { InfraSignalConfig } from './types.js';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const log = createLogger('main');

// Build configuration from environment variables
function buildConfig(): Partial<InfraSignalConfig> {
  return {
    // RPC Configuration
    rpcUrl: process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.HELIUS_WS_URL || 'wss://mainnet.helius-rpc.com',
    heliusApiKey: process.env.HELIUS_API_KEY,

    // Sell Detection
    minSellLiquidityPct: parseFloat(process.env.MIN_SELL_LIQUIDITY_PCT || '1'),
    maxSellLiquidityPct: parseFloat(process.env.MAX_SELL_LIQUIDITY_PCT || '3'),
    sellDetectionWindowMs: parseInt(process.env.SELL_DETECTION_WINDOW_MS || '60000'),

    // Absorption Detection
    absorptionWindowMs: parseInt(process.env.ABSORPTION_WINDOW_MS || '30000'),
    minAbsorptionRatio: parseFloat(process.env.MIN_ABSORPTION_RATIO || '0.5'),

    // Stabilization
    stabilizationTimeframeMs: parseInt(process.env.STABILIZATION_TIMEFRAME_MS || '300000'),
    minHigherLows: parseInt(process.env.MIN_HIGHER_LOWS || '2'),
    priceStabilizationPct: parseFloat(process.env.PRICE_STABILIZATION_PCT || '5'),

    // Entry Configuration
    entryAboveDefensePct: parseFloat(process.env.ENTRY_ABOVE_DEFENSE_PCT || '1'),
    minSignalStrength: parseInt(process.env.MIN_SIGNAL_STRENGTH || '60'),
    maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS || '3'),
    buyAmountSOL: parseFloat(process.env.BUY_AMOUNT_SOL || '0.1'),

    // Exit Configuration
    takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT || '15'),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '8'),
    trailingStopPct: process.env.TRAILING_STOP_PCT ? parseFloat(process.env.TRAILING_STOP_PCT) : undefined,
    infraExitCheckMs: parseInt(process.env.INFRA_EXIT_CHECK_MS || '10000'),

    // Trading Mode
    enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
    paperTradingMode: process.env.PAPER_TRADING_MODE !== 'false', // Default to true

    // Known Infra Wallets (load from Known_Infra_Wallets_1, Known_Infra_Wallets_2, etc.)
    knownInfraWallets: loadKnownInfraWallets(),
  };
}

// Load known infra wallets from environment variables
function loadKnownInfraWallets(): string[] {
  const wallets: string[] = [];
  let index = 1;
  
  // Load from Known_Infra_Wallets_1, Known_Infra_Wallets_2, etc.
  while (true) {
    const key = `Known_Infra_Wallets_${index}`;
    const wallet = process.env[key];
    
    if (!wallet || wallet.trim() === '') {
      break; // No more wallets
    }
    
    const trimmedWallet = wallet.trim();
    if (trimmedWallet.length > 0) {
      wallets.push(trimmedWallet);
    }
    
    index++;
  }
  
  if (wallets.length > 0) {
    log.info(`Loaded ${wallets.length} known infra wallets from environment`, {
      wallets: wallets.map(w => w.slice(0, 8) + '...'),
    });
  }
  
  return wallets;
}

// Validate required environment variables
function validateEnvironment(): void {
  const required = [
    'DATABASE_URL',
    'HELIUS_RPC_URL',
    'COPY_WALLET_SEED_PHRASE',
  ];

  // COPY_WALLET_SEED_PHREASE is a legacy typo we also support
  const hasSeedPhrase = process.env.COPY_WALLET_SEED_PHRASE || process.env.COPY_WALLET_SEED_PHREASE;

  const missing: string[] = [];
  
  for (const key of required) {
    if (key === 'COPY_WALLET_SEED_PHRASE') {
      if (!hasSeedPhrase) missing.push(key);
    } else if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    log.error('Missing required environment variables:', { missing: missing.join(', ') });
    process.exit(1);
  }

  // Check for HELIUS_API_KEY (required for WebSocket)
  if (!process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEY.trim() === '') {
    log.error('HELIUS_API_KEY is required for WebSocket streaming!');
    log.error('Please add HELIUS_API_KEY=your_key to your .env file');
    log.error('Get a free API key at: https://helius.dev');
    process.exit(1);
  }

  if (!process.env.JUPITER_API_KEY && process.env.ENABLE_LIVE_TRADING === 'true') {
    log.warn('JUPITER_API_KEY not set - Live trading may not work');
  }
}

// Main entry point
async function main(): Promise<void> {
  log.info('Starting Infrastructure Signal Bot...');

  // Validate environment
  validateEnvironment();

  // Build configuration
  const config = buildConfig();
  const dbConnectionString = process.env.DATABASE_URL!;

  // Create and start bot
  const bot = new InfraSignalBot(config, dbConnectionString);

  // Handle graceful shutdown
  const shutdown = async () => {
    log.info('Received shutdown signal...');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error(`Unhandled rejection: ${String(reason)}`);
  });

  // Start the bot
  try {
    await bot.start();
  } catch (error) {
    log.error(`Failed to start bot: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export for testing
export { InfraSignalBot };


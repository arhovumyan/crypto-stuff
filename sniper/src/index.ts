/**
 * Sniper Entry Point
 * Loads configuration and starts the sniper bot
 */

import dotenv from 'dotenv';
import { SniperBot, SniperConfig } from './sniper-bot.js';
import { createLogger } from '@copytrader/shared';

// Load environment variables
dotenv.config();

// Suppress 429 error spam from axios/RPC clients
// These errors are handled by our rate limiter, no need to spam console
const originalConsoleError = console.error;
const originalConsoleLog = console.log;
let last429LogTime = 0;

console.error = (...args: any[]) => {
  const message = args.join(' ');
  if (message.includes('429') || message.includes('Too Many Requests')) {
    // Only log 429 errors every 10 seconds to reduce spam
    const now = Date.now();
    if (now - last429LogTime > 10000) {
      originalConsoleError('[Rate Limited] Too many requests - throttling automatically...');
      last429LogTime = now;
    }
    return; // Suppress the spam
  }
  originalConsoleError(...args);
};

console.log = (...args: any[]) => {
  const message = args.join(' ');
  if (message.includes('Server responded with 429') || 
      message.includes('Retrying after') && message.includes('delay')) {
    return; // Suppress retry spam
  }
  originalConsoleLog(...args);
};

const log = createLogger('sniper-main');

/**
 * Load configuration from environment
 */
function loadConfig(): SniperConfig {
  // Validate required env vars
  const required = ['HELIUS_API_KEY', 'HELIUS_RPC_URL', 'COPY_WALLET_SEED_PHRASE'];
  const missing = required.filter(key => !process.env[key] && !process.env[key.replace('PHRASE', 'PHREASE')]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const config: SniperConfig = {
    // RPC
    rpcUrl: process.env.HELIUS_RPC_URL!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
    
    // Trading
    buyAmountSOL: parseFloat(process.env.SNIPER_BUY_AMOUNT_SOL || '0.2'),
    enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
    
    // Gate configuration
    gates: {
      minLiquiditySOL: parseFloat(process.env.MIN_LIQUIDITY_SOL || '75'),
      liquidityStabilitySeconds: 20,
      maxPriceImpactPct: parseFloat(process.env.MAX_PRICE_IMPACT_PCT || '6'),
      maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '300'),
      maxRouteHops: parseInt(process.env.MAX_ROUTE_HOPS || '2'),
      maxRoundTripLossPct: parseFloat(process.env.MAX_ROUND_TRIP_LOSS_PCT || '8'),
      minEarlySwaps: parseInt(process.env.MIN_EARLY_SWAPS || '10'),
      minUniqueWallets: parseInt(process.env.MIN_UNIQUE_WALLETS || '7'),
      maxWalletDominance: parseFloat(process.env.MAX_WALLET_DOMINANCE || '0.35'),
      maxTopHolderPct: parseInt(process.env.MAX_TOP_HOLDER_PCT || '20'),
      maxTop5HolderPct: parseInt(process.env.MAX_TOP5_HOLDER_PCT || '45'),
      maxTop10HolderPct: parseInt(process.env.MAX_TOP10_HOLDER_PCT || '60'),
      // Gate B configuration (mint authority check)
      enableGateB: process.env.ENABLE_GATE_B !== 'false', // Default: true (enabled)
      gateBMode: (process.env.GATE_B_MODE || 'strict') as 'strict' | 'warning' | 'disabled',
      // Options:
      // - 'strict': Reject tokens with mint authority (default, safest)
      // - 'warning': Log warning but allow tokens with mint authority
      // - 'disabled': Skip Gate B entirely (most permissive)
      
      // Gate C configuration (freeze authority check)
      enableGateC: process.env.ENABLE_GATE_C !== 'false', // Default: true (enabled)
      gateCMode: (process.env.GATE_C_MODE || 'strict') as 'strict' | 'warning' | 'disabled',
      // Options:
      // - 'strict': Reject tokens with freeze authority (default, safest)
      // - 'warning': Log warning but allow tokens with freeze authority
      // - 'disabled': Skip Gate C entirely (most permissive)
      
      // Gate D configuration (Jupiter route check)
      // Raydium AMM pools take 30-60+ seconds for Jupiter to index
      gateDRetries: parseInt(process.env.GATE_D_RETRIES || '12'), // Retry up to 12 times
      gateDRetryDelayMs: parseInt(process.env.GATE_D_RETRY_DELAY_MS || '5000'), // 5s between retries (60s total)
    },
    
    // Execution configuration
    // Jito bundles give you guaranteed block inclusion + MEV protection
    execution: {
      enableJitoBundle: process.env.ENABLE_JITO_BUNDLE === 'true',
      jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf',
      jitoTipAccount: process.env.JITO_TIP_ACCOUNT,
      // Tip amount in lamports (100000 = 0.0001 SOL, recommended for good inclusion)
      jitoTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || '100000'),
      entryPriorityLevel: (process.env.ENTRY_PRIORITY_LEVEL as any) || 'veryHigh',
      exitPriorityLevel: (process.env.EXIT_PRIORITY_LEVEL as any) || 'high',
      maxRetries: 2,
    },
    
    // Position management
    positions: {
      takeProfit1Pct: parseInt(process.env.TAKE_PROFIT_1_PCT || '40'),
      takeProfit1At: parseInt(process.env.TAKE_PROFIT_1_AT || '40'),
      takeProfit2Pct: parseInt(process.env.TAKE_PROFIT_2_PCT || '30'),
      takeProfit2At: parseInt(process.env.TAKE_PROFIT_2_AT || '80'),
      stopLossPct: parseInt(process.env.STOP_LOSS_PCT || '20'),
      timeStopMinutes: parseInt(process.env.TIME_STOP_MINUTES || '3'),
      timeStopMinGainPct: parseInt(process.env.TIME_STOP_MIN_GAIN_PCT || '15'),
    },
    
    // Stats reporting interval
    statsIntervalSeconds: 300, // Every 5 minutes
  };

  return config;
}

/**
 * Main function
 */
async function main() {
  try {
    log.info('🚀 Starting Strict Solana Token Sniper...');
    
    // Load configuration
    const config = loadConfig();
    
    // Create and start bot
    const sniper = new SniperBot(config);
    
    // Handle graceful shutdown
    let isShuttingDown = false;
    
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      
      log.info(`\n${signal} received, shutting down gracefully...`);
      await sniper.stop();
      process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Start the bot
    await sniper.start();
    
  } catch (error) {
    log.error('Fatal error starting sniper', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

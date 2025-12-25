/**
 * Pump Scalper Service - Entry Point
 */

import { PumpScalper } from './pump-scalper.js';
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

// Configuration
const config = {
  buyAmountSOL: parseFloat(process.env.SCALPER_BUY_AMOUNT_SOL || '0.05'),
  profitTargetPercent: parseFloat(process.env.SCALPER_PROFIT_TARGET || '3'),
  stopLossPercent: parseFloat(process.env.SCALPER_STOP_LOSS || '2'),
  maxPositions: parseInt(process.env.SCALPER_MAX_POSITIONS || '3'),
  enableLiveTrading: process.env.SCALPER_ENABLE_LIVE_TRADING === 'true',
};

// Support criteria
const supportCriteria = {
  minUniqueBuyers: parseInt(process.env.SCALPER_MIN_BUYERS || '10'),
  minBuyersInTimeframe: parseInt(process.env.SCALPER_TIMEFRAME || '60'),
  minVolumeUSD: parseFloat(process.env.SCALPER_MIN_VOLUME || '1000'),
  minLiquidityUSD: parseFloat(process.env.SCALPER_MIN_LIQUIDITY || '5000'),
  minMarketCapUSD: parseFloat(process.env.SCALPER_MIN_MCAP || '10000'),
  maxMarketCapUSD: parseFloat(process.env.SCALPER_MAX_MCAP || '500000'),
};

// Initialize scalper
const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || '';
const scalper = new PumpScalper(rpcUrl, config, supportCriteria);

// Handle graceful shutdown
process.on('SIGINT', () => {
  log.info('⚠️  Received SIGINT, shutting down gracefully');
  scalper.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('⚠️  Received SIGTERM, shutting down gracefully');
  scalper.stop();
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
scalper.start().catch((error) => {
  log.error(`❌ Failed to start | ${error.message}`);
  process.exit(1);
});

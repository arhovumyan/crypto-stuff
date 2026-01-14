import dotenv from 'dotenv';
import { Config } from './types';
import path from 'path';

// Load .env from workspace root (3 levels up from dist/config.js)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export function loadConfig(): Config {
  const requiredEnvVars = [
    'HELIUS_RPC_URL',
    'HELIUS_WS_URL',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    rpc: {
      httpUrl: process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL!,
      wsUrl: process.env.HELIUS_WS_URL!,
      fallbackUrls: process.env.QUICKNODE_RPC_URL ? [process.env.QUICKNODE_RPC_URL] : [],
    },
    database: {
      url: process.env.DATABASE_URL || 'postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader',
    },
    wallet: {
      privateKey: process.env.COPY_WALLET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '',
    },
    risk: {
      maxSolPerTrade: parseFloat(process.env.MAX_SOL_PER_TRADE || '5.0'),
      maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS || '10'),
      maxExposurePerToken: parseFloat(process.env.MAX_EXPOSURE_PER_TOKEN || '10.0'),
      maxDailyLossSol: parseFloat(process.env.MAX_DAILY_LOSS_SOL || '20.0'),
      maxHourlyTrades: parseInt(process.env.MAX_HOURLY_TRADES || '50'),
    },
    signal: {
      thresholdPct: parseFloat(process.env.DIP_THRESHOLD_PCT || '5.0'),
      minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL || '1000.0'),
      maxSlippagePct: parseFloat(process.env.MAX_SLIPPAGE_PCT || '3.0'),
      minVolumeProxy: parseFloat(process.env.MIN_VOLUME_PROXY || '100.0'),
      cooldownDurationMs: parseInt(process.env.COOLDOWN_SECONDS || '300') * 1000,
    },
    exit: {
      takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT || '3.0'),
      stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '2.0'),
      timeStopSeconds: parseInt(process.env.TIME_STOP_SECONDS || '300'),
    },
    trading: {
      enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
      paperTrading: process.env.PAPER_TRADING !== 'false', // Default to true for safety
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };
}

export const config = loadConfig();

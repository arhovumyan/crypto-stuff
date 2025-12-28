/**
 * Configuration Module
 * Loads all settings from .env file
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export const config = {
  // RPC Configuration
  heliusApiKey: getEnvVar('HELIUS_API_KEY'),
  heliusRpcUrl: getEnvVar('HELIUS_RPC_URL'),
  solanaRpcUrl: getEnvVar('SOLANA_RPC_URL'),
  
  // Wallet Configuration
  walletSeedPhrase: getEnvVar('COPY_WALLET_SEED_PHRASE'),
  
  // Trading Criteria (Your Specific Requirements)
  maxCoinAgeHours: 24,                    // 0-24 hours old
  minMarketCapUsd: 20000,                 // Must hit 20K within 60 min
  marketCapWindowMinutes: 60,             // 60 minutes after launch
  requiredDrawdownPercent: 50,            // 50% drop from ATH
  maxHolderConcentrationPercent: 30,      // Max 30% liquidity in one wallet
  requiredBondingCurveProgress: 100,      // Must be 100%
  
  // Trading Parameters
  buyAmountSol: getEnvNumber('FIXED_BUY_AMOUNT_SOL', 0.1),
  profitTargetMultiplier: 2.0,            // 2x (100% profit)
  maxSlippageBps: getEnvNumber('MAX_SLIPPAGE_BPS', 100),
  
  // Monitoring
  positionCheckIntervalMs: 1000,          // Check every second
  tokenCheckIntervalMs: 10000,            // Check tokens every 10 seconds
  
  // APIs
  dexScreenerApiUrl: 'https://api.dexscreener.com/latest',
  jupiterApiUrl: getEnvVar('JUPITER_API_URL', 'https://quote-api.jup.ag/v6'),
  pumpfunProgramId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  
  // Live Trading
  enableLiveTrading: getEnvBoolean('SCALPER_ENABLE_LIVE_TRADING', false),
  
  // Priority Fee
  priorityFeeLamports: getEnvNumber('JITO_TIP_LAMPORTS', 100000),
};

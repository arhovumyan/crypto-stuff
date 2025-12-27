/**
 * Configuration Management
 * Loads and validates all required environment variables
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

export interface Config {
  // RPC & WebSocket
  heliusApiKey: string;
  heliusRpcUrl: string;
  heliusWsUrl: string;
  
  // Trading Wallet
  copyWalletSeedPhrase: string;
  
  // Trading Parameters
  buyAmountSol: number;
  slippageBps: number;
  priorityFeeLamports: number;
  
  // Pump.fun Detection
  pumpfunProgramId: string;
  
  // DexScreener
  dexscreenerApiUrl: string;
  dexscreenerWaitTimeoutMs: number;
  
  // Trading Criteria
  minMarketCapUsd: number;
  requiredDrawdownPercent: number;
  maxHolderConcentrationPercent: number;
  tokenLifetimeMinutes: number;
  athWindowMinutes: number;
  
  // Position Management
  profitTargetMultiplier: number;
  pollIntervalMs: number;
  
  // Jupiter
  jupiterApiUrl: string;
  
  // Logging
  logLevel: string;
  enableLiveTrading: boolean;
}

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

export const config: Config = {
  // RPC & WebSocket
  heliusApiKey: getEnvVar('HELIUS_API_KEY'),
  heliusRpcUrl: getEnvVar('HELIUS_RPC_URL'),
  heliusWsUrl: getEnvVar('HELIUS_WS_URL'),
  
  // Trading Wallet
  copyWalletSeedPhrase: getEnvVar('COPY_WALLET_SEED_PHRASE'),
  
  // Trading Parameters
  buyAmountSol: getEnvNumber('FIXED_BUY_AMOUNT_SOL', 0.1),
  slippageBps: getEnvNumber('MAX_SLIPPAGE_BPS', 100),
  priorityFeeLamports: getEnvNumber('JITO_TIP_LAMPORTS', 100000),
  
  // Pump.fun
  pumpfunProgramId: getEnvVar('PUMPFUN_PROGRAM', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  
  // DexScreener
  dexscreenerApiUrl: getEnvVar('DEXSCREENER_API_URL', 'https://api.dexscreener.com/latest'),
  dexscreenerWaitTimeoutMs: getEnvNumber('DEXSCREENER_TIMEOUT_MS', 300000), // 5 minutes
  
  // Trading Criteria
  minMarketCapUsd: getEnvNumber('PUMP_MIN_MCAP_USD', 20000),
  requiredDrawdownPercent: getEnvNumber('PUMP_DRAWDOWN_PERCENT', 40),
  maxHolderConcentrationPercent: getEnvNumber('PUMP_MAX_HOLDER_PERCENT', 30),
  tokenLifetimeMinutes: getEnvNumber('PUMP_TOKEN_LIFETIME_MIN', 60),
  athWindowMinutes: getEnvNumber('PUMP_ATH_WINDOW_MIN', 60),
  
  // Position Management
  profitTargetMultiplier: getEnvNumber('PUMP_PROFIT_TARGET_MULTIPLIER', 2.0),
  pollIntervalMs: getEnvNumber('PUMP_POLL_INTERVAL_MS', 1000),
  
  // Jupiter
  jupiterApiUrl: getEnvVar('JUPITER_API_URL', 'https://quote-api.jup.ag/v6'),
  
  // Logging
  logLevel: getEnvVar('LOG_LEVEL', 'debug'),
  enableLiveTrading: getEnvBoolean('SCALPER_ENABLE_LIVE_TRADING', false),
};

// Validate configuration on load
console.log('✅ Configuration loaded successfully');
console.log(`📊 Live Trading: ${config.enableLiveTrading ? '🟢 ENABLED' : '🔴 DISABLED (PAPER TRADING)'}`);
console.log(`💰 Buy Amount: ${config.buyAmountSol} SOL`);
console.log(`🎯 Profit Target: ${config.profitTargetMultiplier}x`);
console.log(`📈 Min Market Cap: $${config.minMarketCapUsd.toLocaleString()}`);
console.log(`📉 Required Drawdown: ${config.requiredDrawdownPercent}%`);

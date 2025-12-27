import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

export const config = {
  // Solana RPC
  heliusApiKey: process.env.HELIUS_API_KEY!,
  rpcUrl: process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL!,
  wsUrl: process.env.HELIUS_WS_URL!,
  
  // Database
  databaseUrl: process.env.DATABASE_URL!,
  
  // Known Infrastructure Wallets (the wallets that absorb sell pressure)
  infraWallets: [
    process.env.KNOWN_INFRA_WALLET_1,
    process.env.KNOWN_INFRA_WALLET_2,
    process.env.KNOWN_INFRA_WALLET_3,
    process.env.KNOWN_INFRA_WALLET_4,
    process.env.KNOWN_INFRA_WALLET_5,
    process.env.KNOWN_INFRA_WALLET_6,
  ].filter(Boolean) as string[],
  
  // Your Trading Wallet
  myWalletAddress: process.env.MY_WALLET_ADDRESS!,
  copyWalletPrivateKey: process.env.COPY_WALLET_SEED_PHRASE!,
  
  // Post-Absorption Trading Parameters
  absorption: {
    // Minimum sell volume that qualifies as "large sell pressure" (in USD)
    minSellVolumeUsd: parseFloat(process.env.ABSORPTION_MIN_SELL_VOLUME_USD || '1000'),
    
    // Minimum infra wallet buy volume to consider it "absorption" (in SOL)
    minInfraBuyVolumeSol: parseFloat(process.env.ABSORPTION_MIN_INFRA_BUY_SOL || '0.3'),
    
    // Minimum infra wallet buy volume to consider it "absorption" (in USD) - DEPRECATED, use SOL
    minInfraBuyVolumeUsd: parseFloat(process.env.ABSORPTION_MIN_INFRA_BUY_USD || '50'),
    
    // Ratio: infra buy volume / sell volume (e.g., 0.5 = absorbed 50% of sells)
    minAbsorptionRatio: parseFloat(process.env.ABSORPTION_MIN_RATIO || '0.2'),
    
    // Minimum price drop to consider it an absorption opportunity (%)
    minPriceDropPercent: parseFloat(process.env.ABSORPTION_MIN_PRICE_DROP || '3'),
    
    // Time window to look for sell pressure before infra wallet buy (seconds)
    sellPressureWindowSec: parseInt(process.env.ABSORPTION_SELL_WINDOW_SEC || '120'),
    
    // Time window to wait for absorption after large sell (seconds)
    absorptionWindowSec: parseInt(process.env.ABSORPTION_WINDOW_SEC || '300'),
  },
  
  // Stabilization Confirmation Parameters
  stabilization: {
    // How long to monitor for stability after absorption (seconds)
    monitorDurationSec: parseInt(process.env.STABILIZATION_MONITOR_SEC || '60'),
    
    // Maximum price volatility allowed during stabilization (%)
    maxVolatilityPercent: parseFloat(process.env.STABILIZATION_MAX_VOLATILITY || '10'),
    
    // Minimum number of price samples required
    minPriceSamples: parseInt(process.env.STABILIZATION_MIN_SAMPLES || '2'),
    
    // Price must be above this % of the absorption price to enter
    minPriceRecoveryPercent: parseFloat(process.env.STABILIZATION_MIN_RECOVERY || '-5'),
    
    // Maximum price deviation from moving average (%)
    maxPriceDeviationPercent: parseFloat(process.env.STABILIZATION_MAX_DEVIATION || '8'),
  },
  
  // Entry Parameters
  entry: {
    // Fixed buy amount per position (in SOL)
    buyAmountSol: parseFloat(process.env.ABSORPTION_BUY_AMOUNT_SOL || '0.1'),
    
    // Maximum slippage tolerance (basis points, 100 = 1%)
    maxSlippageBps: parseInt(process.env.ABSORPTION_MAX_SLIPPAGE_BPS || '100'),
    
    // Minimum liquidity required to enter (in USD)
    minLiquidityUsd: parseFloat(process.env.ABSORPTION_MIN_LIQUIDITY_USD || '5000'),
    
    // Maximum concurrent positions
    maxPositions: parseInt(process.env.ABSORPTION_MAX_POSITIONS || '5'),
    
    // Cooldown between trades on same token (seconds)
    tokenCooldownSec: parseInt(process.env.ABSORPTION_TOKEN_COOLDOWN_SEC || '300'),
  },
  
  // Exit Strategy Parameters
  // TIERED EXIT STRATEGY:
  // - 50% profit → sell 100%
  // - 30% profit → sell 50%
  // - 20% loss → sell 100%
  exit: {
    // Full exit profit target (%)
    fullExitProfitPercent: parseFloat(process.env.ABSORPTION_FULL_EXIT_PROFIT || '50'),
    
    // Partial exit profit target (%)
    partialExitProfitPercent: parseFloat(process.env.ABSORPTION_PARTIAL_EXIT_PROFIT || '30'),
    
    // Partial exit sell percentage
    partialExitSellPercent: parseFloat(process.env.ABSORPTION_PARTIAL_SELL_PERCENT || '50'),
    
    // Stop loss (%)
    stopLossPercent: parseFloat(process.env.ABSORPTION_STOP_LOSS || '20'),
    
    // Legacy - kept for compatibility
    profitTargetPercent: parseFloat(process.env.ABSORPTION_PROFIT_TARGET || '50'),
    trailingStopActivationPercent: parseFloat(process.env.ABSORPTION_TRAILING_ACTIVATION || '30'),
    trailingStopDistancePercent: parseFloat(process.env.ABSORPTION_TRAILING_DISTANCE || '10'),
    
    // Maximum position hold time (seconds)
    maxHoldTimeSec: parseInt(process.env.ABSORPTION_MAX_HOLD_TIME_SEC || '86400'), // 24 hours
    
    // Time-based exit: if no movement, exit after this time (seconds)
    idleExitTimeSec: parseInt(process.env.ABSORPTION_IDLE_EXIT_TIME_SEC || '7200'), // 2 hours
  },
  
  // Risk Management
  risk: {
    // Maximum daily loss (in USD)
    maxDailyLossUsd: parseFloat(process.env.MAX_DAILY_LOSS_USD || '100'),
    
    // Maximum exposure per token (in USD)
    maxTokenExposureUsd: parseFloat(process.env.MAX_TOKEN_EXPOSURE_USD || '150'),
    
    // Maximum total portfolio exposure (in USD)
    maxPortfolioExposureUsd: parseFloat(process.env.ABSORPTION_MAX_PORTFOLIO_USD || '500'),
  },
  
  // System Settings
  enableLiveTrading: process.env.ABSORPTION_ENABLE_LIVE_TRADING === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Jupiter API
  jupiterApiUrl: process.env.JUPITER_API_URL || 'https://api.jup.ag',
  jupiterApiKey: process.env.JUPITER_API_KEY || '',
};

// Validation
if (config.infraWallets.length === 0) {
  throw new Error('No infrastructure wallets configured. Set KNOWN_INFRA_WALLET_* in .env');
}

if (!config.myWalletAddress) {
  throw new Error('MY_WALLET_ADDRESS is required in .env');
}

console.log(`[Config] Loaded configuration:`);
console.log(`  - Infrastructure Wallets: ${config.infraWallets.length}`);
console.log(`  - Live Trading: ${config.enableLiveTrading ? 'ENABLED' : 'DISABLED'}`);
console.log(`  - Buy Amount: ${config.entry.buyAmountSol} SOL`);
console.log(`  - Max Positions: ${config.entry.maxPositions}`);
console.log(`  - Profit Target: ${config.exit.profitTargetPercent}%`);
console.log(`  - Stop Loss: ${config.exit.stopLossPercent}%`);

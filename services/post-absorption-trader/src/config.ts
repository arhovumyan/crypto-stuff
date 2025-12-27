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
    // How long to monitor for stability after absorption (seconds) - TIGHTENED from 60s
    monitorDurationSec: parseInt(process.env.STABILIZATION_MONITOR_SEC || '90'),
    
    // How often to sample price during stabilization (seconds) - TIGHTENED from 15s
    sampleIntervalSec: parseInt(process.env.STABILIZATION_SAMPLE_INTERVAL_SEC || '10'),
    
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
    // Fixed buy amount per position (in SOL) - REDUCED from 0.1 for safer start
    buyAmountSol: parseFloat(process.env.ABSORPTION_BUY_AMOUNT_SOL || '0.05'),
    
    // Maximum slippage tolerance (basis points, 100 = 1%)
    maxSlippageBps: parseInt(process.env.ABSORPTION_MAX_SLIPPAGE_BPS || '100'),
    
    // Maximum price impact allowed (basis points, 300 = 3%)
    maxPriceImpactBps: parseInt(process.env.ABSORPTION_MAX_PRICE_IMPACT_BPS || '300'),
    
    // Maximum quote age before rejecting (seconds)
    maxQuoteAgeSec: parseInt(process.env.ABSORPTION_MAX_QUOTE_AGE_SEC || '5'),
    
    // Maximum price movement since signal before aborting (%)
    maxPriceMovementPercent: parseFloat(process.env.ABSORPTION_MAX_PRICE_MOVEMENT || '2'),
    
    // Number of retry attempts for failed executions
    maxRetryAttempts: parseInt(process.env.ABSORPTION_MAX_RETRIES || '2'),
    
    // Minimum liquidity required to enter (in USD)
    minLiquidityUsd: parseFloat(process.env.ABSORPTION_MIN_LIQUIDITY_USD || '5000'),
    
    // Maximum concurrent positions - REDUCED from 5 for safer start
    maxPositions: parseInt(process.env.ABSORPTION_MAX_POSITIONS || '1'),
    
    // Cooldown between trades on same token (seconds)
    tokenCooldownSec: parseInt(process.env.ABSORPTION_TOKEN_COOLDOWN_SEC || '300'),
  },
  
  // Exit Strategy Parameters
  // TIERED EXIT STRATEGY (TIGHTENED FOR SAFER START):
  // - 40% profit → sell 100%
  // - 20% profit → sell 50%
  // - 15% loss → sell 100%
  exit: {
    // Full exit profit target (%) - TIGHTENED from 50%
    fullExitProfitPercent: parseFloat(process.env.ABSORPTION_FULL_EXIT_PROFIT || '40'),
    
    // Partial exit profit target (%) - TIGHTENED from 30%
    partialExitProfitPercent: parseFloat(process.env.ABSORPTION_PARTIAL_EXIT_PROFIT || '20'),
    
    // Partial exit sell percentage
    partialExitSellPercent: parseFloat(process.env.ABSORPTION_PARTIAL_SELL_PERCENT || '50'),
    
    // Stop loss (%) - TIGHTENED from 20%
    stopLossPercent: parseFloat(process.env.ABSORPTION_STOP_LOSS || '15'),
    
    // Legacy - kept for compatibility
    profitTargetPercent: parseFloat(process.env.ABSORPTION_PROFIT_TARGET || '50'),
    trailingStopActivationPercent: parseFloat(process.env.ABSORPTION_TRAILING_ACTIVATION || '30'),
    trailingStopDistancePercent: parseFloat(process.env.ABSORPTION_TRAILING_DISTANCE || '10'),
    
    // Maximum position hold time (seconds) - TIGHTENED from 24 hours
    maxHoldTimeSec: parseInt(process.env.ABSORPTION_MAX_HOLD_TIME_SEC || '14400'), // 4 hours
    
    // Time-based exit: if no movement, exit after this time (seconds)
    idleExitTimeSec: parseInt(process.env.ABSORPTION_IDLE_EXIT_TIME_SEC || '7200'), // 2 hours
  },
  
  // Risk Management
  risk: {
    // Maximum daily loss (in USD) - TIGHTENED from 100
    maxDailyLossUsd: parseFloat(process.env.MAX_DAILY_LOSS_USD || '50'),
    
    // Maximum exposure per token (in USD)
    maxTokenExposureUsd: parseFloat(process.env.MAX_TOKEN_EXPOSURE_USD || '50'),
    
    // Maximum total portfolio exposure (in USD) - TIGHTENED from 500
    maxPortfolioExposureUsd: parseFloat(process.env.ABSORPTION_MAX_PORTFOLIO_USD || '50'),
  },
  
  // Wallet Confidence Scoring
  walletConfidence: {
    // Initial confidence score for new wallets
    initialScore: parseFloat(process.env.WALLET_CONFIDENCE_INITIAL || '0.5'),
    
    // Minimum confidence to trade signals
    minScore: parseFloat(process.env.WALLET_CONFIDENCE_MIN || '0.3'),
    
    // Score decay per day (confidence fades over time)
    dailyDecay: parseFloat(process.env.WALLET_CONFIDENCE_DECAY || '0.02'),
    
    // Lookback window for performance calculation (trades)
    performanceWindow: parseInt(process.env.WALLET_CONFIDENCE_WINDOW || '20'),
  },
  
  // Regime Filter
  regime: {
    // Block entries after this many failed stabilizations in window
    maxFailedStabilizations: parseInt(process.env.REGIME_MAX_FAILED_STABILIZATIONS || '3'),
    
    // Time window for counting failures (seconds)
    failureWindowSec: parseInt(process.env.REGIME_FAILURE_WINDOW_SEC || '3600'), // 1 hour
    
    // Block entries if daily loss exceeds this % of max
    maxDailyLossThresholdPercent: parseFloat(process.env.REGIME_MAX_DAILY_LOSS_THRESHOLD || '50'),
  },
  
  // Token Safety
  tokenSafety: {
    // Minimum token age (seconds)
    minTokenAgeSec: parseInt(process.env.TOKEN_SAFETY_MIN_AGE_SEC || '3600'), // 1 hour
    
    // Minimum transaction count
    minTxCount: parseInt(process.env.TOKEN_SAFETY_MIN_TX_COUNT || '100'),
    
    // Maximum top holder concentration (%)
    maxTopHolderPercent: parseFloat(process.env.TOKEN_SAFETY_MAX_TOP_HOLDER || '40'),
    
    // Require freeze authority revoked
    requireNoFreezeAuthority: process.env.TOKEN_SAFETY_REQUIRE_NO_FREEZE !== 'false',
    
    // Require mint authority revoked or reasonable supply cap
    requireNoMintAuthority: process.env.TOKEN_SAFETY_REQUIRE_NO_MINT !== 'false',
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

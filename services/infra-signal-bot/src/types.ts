/**
 * Infra Signal Bot Types
 * Type definitions for the infrastructure signal trading system
 */

// ============================================================================
// Trade Feed Types
// ============================================================================

export interface RawTrade {
  signature: string;
  slot: number;
  blockTime: number;
  poolAddress: string;
  programId?: string; // DEX program ID
  tokenMint: string;
  
  // Trade direction
  type: 'buy' | 'sell';
  
  // Amounts
  amountToken: number;
  amountSOL: number;
  amountIn?: number; // Amount of input token
  amountOut?: number; // Amount of output token
  amountUSD?: number;
  
  // Transaction ordering (for replay determinism)
  txIndex?: number;
  logIndex?: number;
  innerIndex?: number;
  
  // Trader info
  traderWallet: string;
  
  // Price info
  priceUSD?: number;
  priceSOL?: number;
  
  // Liquidity info (optional, for recording)
  liquidityUSD?: number;
}

export interface PoolState {
  poolAddress: string;
  tokenMint: string;
  liquiditySOL: number;
  liquidityToken: number;
  liquidityUSD?: number;
  priceUSD?: number;
  priceSOL?: number;
  lastUpdated: Date;
}

// ============================================================================
// Sell Detection Types
// ============================================================================

export interface LargeSellEvent {
  id?: number;
  signature: string;
  poolAddress: string;
  tokenMint: string;
  sellerWallet: string;
  
  // Sell size
  sellAmountToken: number;
  sellAmountSOL: number;
  sellAmountUSD?: number;
  liquidityPct: number; // % of pool this represents
  
  // Price impact
  priceBefore?: number;
  priceAfter?: number;
  priceImpactPct?: number;
  
  // Timing
  detectedAt: Date;
  
  // Absorption tracking
  wasAbsorbed: boolean;
  absorptionAmountSOL?: number;
  absorptionWallet?: string;
  absorptionDelayMs?: number;
  
  status: 'pending' | 'absorbed' | 'not_absorbed' | 'expired';
}

// ============================================================================
// Infra Classification Types
// ============================================================================

export type InfraBehaviorType = 
  | 'defensive'   // Consistently defends price levels
  | 'cyclical'    // Trades in cycles, predictable patterns
  | 'aggressive'  // Fast, large trades, market-making
  | 'passive'     // Slow, small trades
  | 'unknown';    // Not enough data

export interface InfraWallet {
  id?: number;
  address: string;
  behaviorType: InfraBehaviorType;
  confidenceScore: number; // 0-100
  
  // Behavior metrics
  totalDefenses: number;
  totalAbsorptions: number;
  avgDefenseSizeSOL: number;
  avgResponseTimeMs: number;
  winRate: number; // % of defenses that held
  
  // Distribution behavior
  distributionFrequency: number; // sells per hour
  avgDistributionSizePct: number; // avg sell size as % of position
  
  // Activity
  firstSeenAt: Date;
  lastSeenAt: Date;
  totalTrades: number;
  
  isBlacklisted: boolean;
}

export interface WalletClassification {
  wallet: string;
  behaviorType: InfraBehaviorType;
  confidence: number;
  reasons: string[];
  metrics: {
    tradeCount: number;
    buyRatio: number;
    avgTradeSize: number;
    avgResponseTime: number;
    defensiveScore: number;
  };
}

// ============================================================================
// Stabilization Types
// ============================================================================

export interface PriceCandle {
  tokenMint: string;
  timeframe: '1m' | '5m';
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  startTime: Date;
  endTime: Date;
}

export interface StabilizationResult {
  isStabilized: boolean;
  higherLowFormed: boolean;
  stabilizationTimeMs: number;
  defendedLevel: number;
  currentPrice: number;
  lowestLow: number;
  recentHigh: number;
  reasons: string[];
}

// ============================================================================
// Signal Types
// ============================================================================

export type SignalType = 
  | 'absorption'        // Infra absorbed a large sell
  | 'defense'           // Infra defended a price level
  | 'accumulation'      // Infra accumulating at levels
  | 'distribution_pause'; // Infra stopped distributing

export interface InfraSignal {
  id?: number;
  tokenMint: string;
  poolAddress: string;
  
  signalType: SignalType;
  strength: number; // 0-100
  
  // Related events
  sellEventId?: number;
  infraWallet?: string;
  infraWalletType?: InfraBehaviorType;
  
  // Price context
  priceAtSignal: number;
  defendedLevel: number;
  
  // Stabilization
  stabilizationConfirmed: boolean;
  stabilizationTimeMs?: number;
  higherLowFormed: boolean;
  
  // Outcome
  status: 'active' | 'confirmed' | 'invalidated' | 'expired';
  entryPrice?: number;
  exitPrice?: number;
  pnlPct?: number;
  
  createdAt: Date;
  confirmedAt?: Date;
  invalidatedAt?: Date;
}

// ============================================================================
// Position Types
// ============================================================================

export interface InfraPosition {
  id?: number;
  tokenMint: string;
  signalId: number;
  
  // Entry
  entryPrice: number;
  entryAmountSOL: number;
  entryAmountToken: number;
  entrySignature?: string;
  entryTime: Date;
  
  // Current state
  currentPrice: number;
  unrealizedPnlPct: number;
  unrealizedPnlSOL: number;
  
  // Exit targets
  takeProfitPrice: number;
  stopLossPrice: number;
  
  // Related infra wallet tracking
  infraWallet?: string;
  lastInfraActivity?: Date;
  
  // Status
  status: 'open' | 'closed' | 'stopped_out' | 'take_profit';
  
  // Exit (if closed)
  exitPrice?: number;
  exitAmountSOL?: number;
  exitSignature?: string;
  exitTime?: Date;
  exitReason?: string;
  realizedPnlPct?: number;
  realizedPnlSOL?: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface InfraSignalConfig {
  // RPC
  rpcUrl: string;
  wsUrl: string;
  heliusApiKey?: string;
  
  // Sell detection thresholds
  minSellLiquidityPct: number; // Minimum sell size as % of pool (default: 1%)
  maxSellLiquidityPct: number; // Maximum sell size as % of pool (default: 3%)
  sellDetectionWindowMs: number; // Time window to track sells (default: 60000)
  
  // Absorption detection
  absorptionWindowMs: number; // Time to wait for absorption (default: 30000)
  minAbsorptionRatio: number; // Min ratio of absorption to sell (default: 0.5)
  
  // Stabilization
  stabilizationTimeframeMs: number; // Time to check for stabilization (default: 300000 = 5min)
  minHigherLows: number; // Min higher lows needed (default: 2)
  priceStabilizationPct: number; // Max price deviation for stable (default: 5%)
  
  // Entry
  entryAboveDefensePct: number; // Entry offset above defended level (default: 1%)
  minSignalStrength: number; // Min signal strength to enter (default: 60)
  maxConcurrentPositions: number; // Max positions at once (default: 3)
  buyAmountSOL: number; // Amount to buy per trade
  
  // Exit
  takeProfitPct: number; // Take profit target (default: 15%)
  stopLossPct: number; // Stop loss (default: 8%)
  trailingStopPct?: number; // Trailing stop (optional)
  infraExitCheckMs: number; // Check for infra exit signals every X ms
  
  // Trading mode
  enableLiveTrading: boolean;
  paperTradingMode: boolean;
  
  // Infra wallet list (optional manual list)
  knownInfraWallets?: string[];
}

export const DEFAULT_CONFIG: Partial<InfraSignalConfig> = {
  minSellLiquidityPct: 1,
  maxSellLiquidityPct: 3,
  sellDetectionWindowMs: 60000,
  absorptionWindowMs: 30000,
  minAbsorptionRatio: 0.5,
  stabilizationTimeframeMs: 300000,
  minHigherLows: 2,
  priceStabilizationPct: 5,
  entryAboveDefensePct: 1,
  minSignalStrength: 60,
  maxConcurrentPositions: 3,
  buyAmountSOL: 0.1,
  takeProfitPct: 15,
  stopLossPct: 8,
  infraExitCheckMs: 10000,
  enableLiveTrading: false,
  paperTradingMode: true,
};


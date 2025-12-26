/**
 * Sandbox/Simulation Types
 * Data structures for the replay simulation system
 */

export interface HistoricalSwapEvent {
  // Transaction metadata
  slot: number;
  signature: string;
  blockTime: number;
  programId: string;
  
  // Transaction ordering (CRITICAL for deterministic replay)
  txIndex: number; // Transaction index within the slot
  logIndex?: number; // Log index within the transaction (optional)
  innerIndex?: number; // Inner instruction index (optional)
  
  // Pool & token info
  poolAddress: string;
  tokenMint: string;
  baseMint: string; // SOL or USDC
  
  // Trade details
  trader: string;
  side: 'buy' | 'sell';
  amountIn: number;  // In base units (SOL/USDC)
  amountOut: number; // In token units
  amountInSOL: number; // Normalized to SOL
  amountOutSOL: number; // Normalized to SOL
  
  // Pool state snapshot (CRITICAL - from on-chain)
  poolState: PoolStateSnapshot;
}

export interface PoolStateSnapshot {
  slot: number;
  poolAddress: string;
  reserveSOL: number;
  reserveToken: number;
  priceSOL: number; // Computed from reserves
  liquidityUSD?: number; // Optional, for reporting
}

export interface ExecutionConfig {
  mode: 'idealized' | 'realistic' | 'stress';
  latencySlots: number;
  slippageModel: 'constant' | 'reserves' | 'none';
  slippageBps: number;
  quoteStaleProbability: number;
  routeFailProbability: number;
  partialFillProbability: number;
  partialFillRatio: number;
  lpFeeBps: number;
  priorityFeeSOL: number;
}

export interface FillResult {
  success: boolean;
  fillPrice: number; // SOL per token
  slippageBps: number;
  feesSOL: number;
  latencySlots: number;
  failureReason?: 'quote_stale' | 'route_fail' | 'slippage_exceeded' | 'partial_fill';
  partialFillRatio?: number;
  executedAmountSOL?: number; // May be less than requested if partial
}

export interface VirtualPortfolio {
  startingCapitalSOL: number;
  currentCapitalSOL: number;
  peakCapitalSOL: number;
  realizedPnLSOL: number;
  unrealizedPnLSOL: number;
  maxDrawdownSOL: number;
  maxDrawdownPct: number;
  openPositions: VirtualPosition[];
  closedPositions: VirtualPosition[];
  dailyPnL: Map<string, number>; // date -> PnL
  weeklyPnL: Map<string, number>; // week -> PnL
}

export interface VirtualPosition {
  positionId: string;
  tokenMint: string;
  poolAddress: string;
  entrySlot: number;
  entryPrice: number; // SOL per token
  entryAmountSOL: number;
  entryAmountTokens: number;
  currentPrice?: number;
  currentValueSOL?: number;
  unrealizedPnLSOL?: number;
  unrealizedPnLPct?: number;
  exitSlot?: number;
  exitPrice?: number;
  exitReason?: string;
  pnlSOL?: number;
  pnlPct?: number;
  mae?: number; // Maximum Adverse Excursion
  mfe?: number; // Maximum Favorable Excursion
  maePct?: number;
  mfePct?: number;
  holdingTimeSlots?: number;
}

export interface SimulatedTrade {
  // Identification
  tradeId: string;
  tokenMint: string;
  poolAddress: string;
  
  // Entry
  entrySlot: number;
  entryTime: Date;
  entryPrice: number;
  entryAmountSOL: number;
  entryAmountTokens: number;
  entrySlippageBps: number;
  entryFeesSOL: number;
  
  // Context
  infraWallets: string[];
  absorptionEvent?: {
    sellSignature: string;
    absorptionAmountSOL: number;
    absorptionRatio: number;
    responseTimeSlots: number;
  };
  stabilizationMetrics?: {
    higherLowsCount: number;
    volatilityDecay: number;
    defendedLevel: number;
    stabilizationScore: number;
  };
  signalStrength: number;
  regimeState: string;
  
  // Exit
  exitSlot?: number;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  exitSlippageBps?: number;
  exitFeesSOL?: number;
  
  // Performance
  pnlSOL: number;
  pnlPct: number;
  netPnLSOL: number; // After fees
  mae: number;
  mfe: number;
  maePct: number;
  mfePct: number;
  holdingTimeSlots: number;
  holdingTimeMs: number;
  
  // Execution
  totalFeesSOL: number;
  fillSuccess: boolean;
  fillFailureReason?: string;
}

export interface WalletAnalytics {
  address: string;
  behaviorType: 'defensive' | 'cyclical' | 'aggressive' | 'passive' | 'unknown';
  
  // Discovery
  discoveredAt: Date;
  discoveryMethod: 'manual' | 'automatic';
  
  // Activity
  totalAbsorptions: number;
  totalDefenses: number;
  successfulDefenses: number;
  defenseSuccessRate: number;
  averageResponseTimeSlots: number;
  
  // Confidence
  initialConfidence: number;
  finalConfidence: number;
  confidenceHistory: Array<{
    slot: number;
    confidence: number;
    reason: string;
  }>;
  confidenceDecayEvents: number;
  
  // Performance
  tradesInvolved: number;
  totalPnLContribution: number; // Sum of PnL from trades involving this wallet
  averagePnLPerTrade: number;
  winRate: number; // % of trades that were profitable
  
  // Status
  isBlacklisted: boolean;
  blacklistedAt?: Date;
  blacklistReason?: string;
}

export interface SimulationReport {
  // Metadata
  runId: string;
  datasetPath: string;
  datasetHash: string;
  configHash: string;
  startTime: Date;
  endTime: Date;
  durationDays: number;
  
  // Summary
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnLSOL: number;
    netPnLSOL: number; // After fees
    totalFeesSOL: number;
    maxDrawdownSOL: number;
    maxDrawdownPct: number;
    avgHoldingTimeMs: number;
    expectancy: number;
    sharpeRatio: number;
  };
  
  // Market coverage
  marketCoverage: {
    totalEvents: number;
    totalSwaps: number;
    uniqueTokens: number;
    uniqueTraders: number;
    largeSellsDetected: number;
    absorptionsConfirmed: number;
    stabilizationsConfirmed: number;
    signalsGenerated: number;
  };
  
  // Detailed data
  trades: SimulatedTrade[];
  walletAnalytics: WalletAnalytics[];
  
  // Charts data
  equityCurve: Array<{ time: Date; capital: number }>;
  drawdownCurve: Array<{ time: Date; drawdown: number }>;
}

export interface ScenarioConfig {
  // Module toggles
  enableStabilization: boolean;
  enableRegimeFilter: boolean;
  enableConfidenceDecay: boolean;
  enableDistributionDetection: boolean;
  enableCapitalGovernor: boolean;
  
  // Parameter overrides
  minSellPct?: number;
  maxSellPct?: number;
  minAbsorptionRatio?: number;
  absorptionWindowSlots?: number;
  stabilizationWindowSlots?: number;
  minSignalStrength?: number;
  
  // Execution mode
  executionMode: 'idealized' | 'realistic' | 'stress';
}

export interface ReplayConfig {
  // Input
  datasetPath: string;
  startSlot?: number;
  endSlot?: number;
  startTime?: Date;
  endTime?: Date;
  
  // Replay options
  speed: '1x' | '10x' | '100x' | 'max';
  
  // Strategy options
  scenario: ScenarioConfig;
  
  // Execution options
  execution: ExecutionConfig;
  
  // Capital options
  startingCapitalSOL: number;
  maxPositionSizeSOL: number;
  maxConcurrentPositions: number;
  riskPerTradePct: number;
  
  // Output
  outputDir: string;
  enableDetailedLogging: boolean;
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: 'realistic',
  latencySlots: 2,
  slippageModel: 'constant',
  slippageBps: 50, // 0.5%
  quoteStaleProbability: 0.05, // 5%
  routeFailProbability: 0.02, // 2%
  partialFillProbability: 0.01, // 1%
  partialFillRatio: 0.5, // 50%
  lpFeeBps: 30, // 0.3%
  priorityFeeSOL: 0.0001,
};

export const DEFAULT_SCENARIO_CONFIG: ScenarioConfig = {
  enableStabilization: true,
  enableRegimeFilter: true,
  enableConfidenceDecay: true,
  enableDistributionDetection: true,
  enableCapitalGovernor: true,
  executionMode: 'realistic',
};

export const IDEALIZED_EXECUTION_CONFIG: ExecutionConfig = {
  mode: 'idealized',
  latencySlots: 0,
  slippageModel: 'none',
  slippageBps: 0,
  quoteStaleProbability: 0,
  routeFailProbability: 0,
  partialFillProbability: 0,
  partialFillRatio: 1,
  lpFeeBps: 0,
  priorityFeeSOL: 0,
};

export const STRESS_EXECUTION_CONFIG: ExecutionConfig = {
  mode: 'stress',
  latencySlots: 5,
  slippageModel: 'reserves',
  slippageBps: 150, // 1.5%
  quoteStaleProbability: 0.15, // 15%
  routeFailProbability: 0.10, // 10%
  partialFillProbability: 0.05, // 5%
  partialFillRatio: 0.3, // 30%
  lpFeeBps: 50, // 0.5%
  priorityFeeSOL: 0.001,
};


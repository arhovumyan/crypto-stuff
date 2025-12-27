import { PublicKey } from '@solana/web3.js';

/**
 * Swap transaction data
 */
export interface SwapTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  tokenMint: string;
  poolAddress: string;
  traderWallet: string;
  isBuy: boolean;
  amountIn: number;
  amountOut: number;
  priceImpact: number;
  derivedPrice: number;
  poolReservesToken: number;
  poolReservesQuote: number;
  dexProgram: 'raydium' | 'pumpfun' | 'pumpswap';
}

/**
 * Large sell event that triggers observation
 */
export interface LargeSellEvent {
  id: string;
  tokenMint: string;
  poolAddress: string;
  slot: number;
  timestamp: number;
  sellAmount: number;
  sellAmountUsd: number;
  percentOfPool: number;
  sellerWallet: string;
  preEventPrice: number;
  postEventPrice: number;
  observationWindowEndTime: number;
  status: 'observing' | 'analyzing' | 'validated' | 'invalidated';
}

/**
 * Absorption candidate - wallet that bought during sell event
 */
export interface AbsorptionCandidate {
  wallet: string;
  eventId: string;
  tokenMint: string;
  totalBuyAmount: number;
  totalBuyAmountUsd: number;
  buyCount: number;
  absorptionPercent: number;
  responseLatencySlots: number;
  avgPriceImpact: number;
  firstBuySlot: number;
  lastBuySlot: number;
  boughtDuringRedCandle: boolean;
}

/**
 * Price stabilization analysis result
 */
export interface StabilizationResult {
  eventId: string;
  tokenMint: string;
  stabilized: boolean;
  priceRecoveryPercent: number;
  newLowMade: boolean;
  volumeContractionPercent: number;
  defenseLevel: number;
  defenseHoldTime: number;
  additionalSellsPressure: number;
  confidenceScore: number; // 0-100
}

/**
 * Wallet behavior metrics tracked over time
 */
export interface WalletBehavior {
  wallet: string;
  firstSeen: number;
  lastSeen: number;
  
  // Event tracking
  totalAbsorptions: number;
  successfulAbsorptions: number;
  failedAbsorptions: number;
  uniqueTokens: Set<string>;
  
  // Performance metrics
  stabilizationSuccessRate: number;
  avgAbsorptionPercent: number;
  avgResponseLatency: number;
  sizeConsistency: number; // 0-100
  
  // Behavior patterns
  exitBehavior: 'immediate' | 'gradual' | 'holder' | 'unknown';
  activityPattern: 'consistent' | 'cyclical' | 'opportunistic';
  
  // Confidence & classification
  confidenceScore: number; // 0-100
  classification: 'defensive-infra' | 'aggressive-infra' | 'cyclical' | 'opportunistic' | 'noise' | 'candidate';
  status: 'active' | 'decaying' | 'deprecated';
  
  // Evidence
  evidenceLog: AbsorptionEvidence[];
  lastConfidenceUpdate: number;
}

/**
 * Evidence of absorption event
 */
export interface AbsorptionEvidence {
  eventId: string;
  tokenMint: string;
  timestamp: number;
  slot: number;
  absorptionPercent: number;
  stabilized: boolean;
  priceImpact: number;
  responseLatency: number;
  outcome: 'success' | 'failed' | 'pending';
}

/**
 * Infra wallet classification output
 */
export interface InfraWallet {
  wallet: string;
  classification: string;
  confidenceScore: number;
  status: string;
  
  // Metrics
  totalAbsorptions: number;
  successfulAbsorptions: number;
  stabilizationRate: number;
  uniqueTokens: number;
  avgAbsorptionPercent: number;
  avgResponseLatency: number;
  
  // Timing
  firstSeen: number;
  lastSeen: number;
  lastUpdate: number;
  
  // Evidence summary
  recentEvents: string[]; // eventIds
  evidenceCount: number;
}

/**
 * System statistics
 */
export interface SystemStats {
  monitoringStartTime: number;
  totalSwapsProcessed: number;
  totalLargeSellEvents: number;
  totalCandidatesIdentified: number;
  totalWalletsTracked: number;
  confirmedInfraWallets: number;
  
  // Classification breakdown
  defensiveInfraCount: number;
  aggressiveInfraCount: number;
  cyclicalCount: number;
  opportunisticCount: number;
  noiseCount: number;
  
  // Performance
  avgProcessingTimeMs: number;
  lastSaveTime: number;
}

/**
 * Pool state for reserve tracking
 */
export interface PoolState {
  poolAddress: string;
  tokenMint: string;
  tokenReserve: number;
  quoteReserve: number;
  lastUpdate: number;
  lastSlot: number;
}

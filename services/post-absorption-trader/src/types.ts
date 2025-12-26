export interface Transaction {
  signature: string;
  blockTime: number;
  slot: number;
  wallet: string;
  token: string;
  tokenSymbol?: string;
  type: 'buy' | 'sell';
  amountToken: number;
  amountSol: number;
  amountUsd: number;
  price: number;
  priceUsd: number;
}

export interface SellPressureEvent {
  token: string;
  tokenSymbol?: string;
  totalSellVolumeUsd: number;
  totalSellVolumeSol: number;
  sellTransactions: Transaction[];
  startTime: number;
  endTime: number;
  averagePrice: number;
}

export interface AbsorptionEvent {
  id: string;
  token: string;
  tokenSymbol?: string;
  
  // Sell pressure data
  sellPressure: SellPressureEvent;
  
  // Infrastructure wallet absorption
  infraWalletBuys: Transaction[];
  totalInfraBuyVolumeUsd: number;
  totalInfraBuyVolumeSol: number;
  absorptionRatio: number; // infra buy / sell volume
  
  // Timing
  detectedAt: number;
  absorptionStartTime: number;
  absorptionEndTime: number;
  absorptionDurationSec: number;
  
  // Price data
  priceBeforeSell: number;
  priceAtAbsorption: number;
  priceAfterAbsorption?: number;
  priceImpactPercent: number;
  
  // Status
  status: 'detected' | 'monitoring' | 'stabilized' | 'entered' | 'expired' | 'rejected';
  rejectionReason?: string;
}

export interface StabilizationAnalysis {
  token: string;
  isStable: boolean;
  
  // Price analysis
  currentPrice: number;
  averagePrice: number;
  priceVolatilityPercent: number;
  priceRecoveryPercent: number; // % recovery from absorption price
  priceDeviationPercent: number; // deviation from moving average
  
  // Sample data
  priceSamples: Array<{ timestamp: number; price: number }>;
  sampleCount: number;
  monitorDurationSec: number;
  
  // Volume analysis
  buyVolume: number;
  sellVolume: number;
  volumeRatio: number; // buy/sell
  
  // Liquidity
  liquidityUsd: number;
  
  // Result
  passedChecks: string[];
  failedChecks: string[];
  score: number; // 0-100
}

export interface Position {
  id: string;
  token: string;
  tokenSymbol?: string;
  
  // Entry
  entryTime: number;
  entryPrice: number;
  entryAmountSol: number;
  entryAmountToken: number;
  entrySignature: string;
  
  // Exit
  exitTime?: number;
  exitPrice?: number;
  exitAmountSol?: number;
  exitSignature?: string;
  exitReason?: string;
  
  // P&L
  currentPrice?: number;
  unrealizedPnlPercent?: number;
  unrealizedPnlSol?: number;
  realizedPnlPercent?: number;
  realizedPnlSol?: number;
  
  // Tracking
  highestPrice: number;
  lowestPrice: number;
  trailingStopPrice?: number;
  
  // Associated data
  absorptionEventId: string;
  
  // Status
  status: 'open' | 'closed';
}

export interface MarketData {
  token: string;
  price: number;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPercent: number;
  timestamp: number;
}

export interface RiskMetrics {
  dailyPnlUsd: number;
  dailyTradeCount: number;
  openPositions: number;
  totalExposureUsd: number;
  tokenExposures: Map<string, number>; // token -> exposure USD
  isRiskLimitReached: boolean;
  limitReasons: string[];
}

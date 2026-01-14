import { PublicKey } from '@solana/web3.js';

// ============================================================================
// MARKET DATA TYPES
// ============================================================================

export interface PricePoint {
  timestamp: number; // Unix timestamp in milliseconds
  price: number;
  baseReserve: bigint;
  quoteReserve: bigint;
  slot: number;
}

export interface MarketUpdate {
  id: string;
  window: PriceWindow;
  baseReserve: bigint;
  quoteReserve: bigint;
  liquiditySol: number;
  volumeProxy: number;
  lastUpdate: number;
}

export interface PriceWindow {
  data: PricePoint[];
  capacity: number;
}

export interface MarketAccounts {
  poolAddress: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  poolState?: PublicKey;
}

export interface MarketHealth {
  lastUpdate: number;
  consecutiveFailures: number;
  isHealthy: boolean;
}

// ============================================================================
// SIGNAL ENGINE TYPES
// ============================================================================

export enum Side {
  Buy = 'BUY',
  Sell = 'SELL',
}

export interface TradeIntent {
  intentId: string;
  timestamp: Date;
  marketId: string;
  side: Side;
  sizeSol: number;
  referencePrice: number;
  currentPrice: number;
  dropPct: number;
  liquiditySol: number;
  estimatedSlippage: number;
  reasonCodes: string[];
}

export interface DipDetectorConfig {
  thresholdPct: number;
  minLiquiditySol: number;
  maxSlippagePct: number;
  minVolumeProxy: number;
  cooldownDurationMs: number;
}

// ============================================================================
// RISK MANAGER TYPES
// ============================================================================

export interface RiskConfig {
  maxSolPerTrade: number;
  maxConcurrentPositions: number;
  maxExposurePerToken: number;
  maxDailyLossSol: number;
  maxHourlyTrades: number;
}

export interface RiskState {
  openPositions: Map<string, Position>;
  dailyPnlSol: number;
  dailyPnlResetTime: Date;
  hourlyTradeCount: Date[];
}

export type RiskDecision =
  | { type: 'APPROVED'; intent: TradeIntent }
  | { type: 'REJECTED'; intent: TradeIntent; reasons: string[] };

// ============================================================================
// EXECUTION ENGINE TYPES
// ============================================================================

export interface ApprovedIntent extends TradeIntent {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amountLamports: bigint;
  slippageTolerance: number;
  priorityFee: number;
}

export type ExecutionResult =
  | {
      status: 'SUCCESS';
      signature: string;
      fillPrice: number;
      fillAmount: number;
      executionLatencyMs: number;
    }
  | {
      status: 'FAILED';
      reason: string;
      signature?: string;
      details?: any;
    };

export interface FillEvent {
  positionId: string;
  signature: string;
  price: number;
  amount: number;
  timestamp: Date;
  exitReason?: ExitReason;
}

// ============================================================================
// POSITION TRACKER TYPES
// ============================================================================

export enum PositionStateType {
  PendingOpen = 'PENDING_OPEN',
  Open = 'OPEN',
  PendingClose = 'PENDING_CLOSE',
  Closed = 'CLOSED',
  Failed = 'FAILED',
}

export type PositionState =
  | { type: PositionStateType.PendingOpen; txSignature: string }
  | {
      type: PositionStateType.Open;
      entryPrice: number;
      entryAmount: number;
      entryTime: Date;
    }
  | { type: PositionStateType.PendingClose; txSignature: string }
  | {
      type: PositionStateType.Closed;
      exitPrice: number;
      realizedPnlSol: number;
      exitReason: ExitReason;
    }
  | { type: PositionStateType.Failed; reason: string };

export enum ExitReason {
  TakeProfit = 'TAKE_PROFIT',
  StopLoss = 'STOP_LOSS',
  TimeStop = 'TIME_STOP',
  LiquidityCollapse = 'LIQUIDITY_COLLAPSE',
  EmergencyExit = 'EMERGENCY_EXIT',
}

export interface Position {
  id: string;
  intentId: string;
  marketId: string;
  state: PositionState;
  metadata: Record<string, any>;
}

export interface ExitConfig {
  takeProfitPct: number;
  stopLossPct: number;
  timeStopSeconds: number;
  trailingStopPct?: number;
}

export interface ExitIntent {
  positionId: string;
  marketId: string;
  exitReason: ExitReason;
  currentPrice: number;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface Config {
  rpc: {
    httpUrl: string;
    wsUrl: string;
    fallbackUrls?: string[];
  };
  database: {
    url: string;
  };
  wallet: {
    privateKey: string;
  };
  risk: RiskConfig;
  signal: DipDetectorConfig;
  exit: ExitConfig;
  trading: {
    enableLiveTrading: boolean;
    paperTrading: boolean;
  };
  logging: {
    level: string;
  };
}

// ============================================================================
// DATABASE TYPES
// ============================================================================

export interface MarketSnapshotRow {
  time: Date;
  marketId: string;
  price: number;
  baseReserve: string;
  quoteReserve: string;
  liquidityEstimate: number;
  volumeProxy: number;
}

export interface TradeIntentRow {
  intentId: string;
  createdAt: Date;
  marketId: string;
  side: string;
  sizeSol: number;
  referencePrice: number;
  currentPrice: number;
  dropPct: number;
  liquidity: number;
  estimatedSlippage: number;
  reasonCodes: string;
  riskDecision: string;
  rejectionReason?: string;
}

export interface PositionRow {
  positionId: string;
  intentId: string;
  marketId: string;
  state: string;
  entryTxSig?: string;
  entryPrice?: number;
  entryAmount?: number;
  entryTime?: Date;
  exitTxSig?: string;
  exitPrice?: number;
  exitTime?: Date;
  realizedPnlSol?: number;
  exitReason?: string;
  metadata: string;
}

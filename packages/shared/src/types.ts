import { PublicKey } from '@solana/web3.js';

// ============================================================================
// Leader Trade Types
// ============================================================================

export interface TokenDelta {
  mint: string;
  symbol?: string;
  amount: number; // positive = received, negative = sent
  decimals: number;
  uiAmount: number;
}

export interface DetectedSwap {
  signature: string;
  slot: number;
  blockTime: number;
  leaderWallet: string;
  
  tokenIn: TokenDelta;
  tokenOut: TokenDelta;
  
  dexProgram?: string;
  rawTransaction?: any;
}

export interface LeaderTrade {
  id: number;
  leaderWallet: string;
  signature: string;
  slot: number;
  blockTime: Date;
  
  tokenInMint: string;
  tokenInSymbol?: string;
  tokenOutMint: string;
  tokenOutSymbol?: string;
  amountIn: number;
  amountOut: number;
  
  dexProgram?: string;
  detectedAt: Date;
}

// ============================================================================
// Wallet Types
// ============================================================================

export interface FollowedWallet {
  id: number;
  address: string;
  enabled: boolean;
  config: Record<string, any>;
  score: number;
  lastTradeAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Copy Attempt Types
// ============================================================================

export type CopyAttemptStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface CopyAttempt {
  id: number;
  leaderTradeId: number;
  status: CopyAttemptStatus;
  reason?: string;
  riskChecks?: Record<string, any>;
  quoteJson?: Record<string, any>;
  ourSignature?: string;
  amountIn?: number;
  amountOut?: number;
  expectedOut?: number;
  slippage?: number;
  fees?: number;
  createdAt: Date;
  executedAt?: Date;
  confirmedAt?: Date;
}

// ============================================================================
// Position Types
// ============================================================================

export interface Position {
  tokenMint: string;
  tokenSymbol?: string;
  size: number;
  avgCost?: number;
  realizedPnl: number;
  unrealizedPnl: number;
  firstTradeAt?: Date;
  lastTradeAt?: Date;
  tradeCount: number;
  updatedAt: Date;
}

// ============================================================================
// Risk Event Types
// ============================================================================

export type RiskEventType = 
  | 'daily_loss_limit'
  | 'suspicious_wallet'
  | 'token_blacklisted'
  | 'low_liquidity'
  | 'high_slippage'
  | 'execution_failure'
  | 'websocket_disconnect';

export type RiskSeverity = 'info' | 'warning' | 'critical';

export interface RiskEvent {
  id: number;
  eventType: RiskEventType;
  severity: RiskSeverity;
  walletAddress?: string;
  tokenMint?: string;
  tradeSignature?: string;
  details: Record<string, any>;
  createdAt: Date;
}

// ============================================================================
// WebSocket Message Types (Solana)
// ============================================================================

export interface AccountSubscriptionResult {
  result: number; // subscription ID
}

export interface AccountNotification {
  jsonrpc: string;
  method: string;
  params: {
    result: {
      context: {
        slot: number;
      };
      value: {
        lamports: number;
        owner: string;
        data: string[];
        executable: boolean;
        rentEpoch: number;
      };
    };
    subscription: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function shortenAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

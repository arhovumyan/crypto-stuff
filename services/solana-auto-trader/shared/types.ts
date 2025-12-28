// Shared types for the automated trading system

export interface Token {
  address: string;
  mintTime: Date;
  discoveryTime: Date;
  
  // Market data
  marketCap?: number;
  athMarketCap?: number;
  currentPrice?: number;
  athPrice?: number;
  liquidity?: number;
  volume24h?: number;
  
  // Validation criteria
  reachedMcapTarget?: boolean;           // Did it hit 20K mcap within 60min?
  mcapTargetTime?: Date;                 // When did it hit 20K?
  hasDropped50Percent?: boolean;         // Has it dropped 50% from ATH?
  passesLiquidityCheck?: boolean;        // <30% held by one wallet?
  hasBondingCurveProgress?: boolean;     // 100% bonding curve?
  
  // Status flags
  meetsCriteria: boolean;
  validated: boolean;
  
  // Rejection reasons
  rejectionReasons?: string[];
  
  // Metadata
  name?: string;
  symbol?: string;
  decimals?: number;
  
  // Top holders check
  topHolderPercentage?: number;
  
  // Last update time
  lastChecked?: Date;
}

export interface Position {
  tokenAddress: string;
  entryPrice: number;
  entryTime: Date;
  solAmount: number;
  tokenAmount: number;
  currentPrice?: number;
  currentValue?: number;
  profitPercent?: number;
  exitPrice?: number;
  exitTime?: Date;
  status: 'active' | 'closed';
}

export interface ValidationResult {
  passes: boolean;
  reasons: string[];
  token: Token;
}

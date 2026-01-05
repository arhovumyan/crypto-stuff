import { logger } from './logger';
import { WalletTransaction } from './database';

interface TokenTransfer {
  mint: string;
  fromUserAccount?: string;
  toUserAccount?: string;
  fromTokenAccount?: string;
  toTokenAccount?: string;
  tokenAmount: number;
}

export interface ParsedTrade {
  type: 'BUY' | 'SELL' | 'TRANSFER' | 'SWAP' | 'UNKNOWN';
  tokenMint: string;
  tokenAmount: number;
  solAmount: number;
  dexProgram?: string;
  dexName?: string;
  pricePerToken: number;
}

export class TransactionParser {
  // Known DEX program IDs
  private readonly DEX_PROGRAMS: Record<string, string> = {
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter v4',
    'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo': 'Jupiter v2',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
    'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S': 'Raydium CLMM',
    '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv': 'Raydium Stable',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
    'pSwApxJYXvS5KX7sKvVVRCh4VNxEQFhN9pN3sJ4Dvgz': 'Pumpswap',
  };
  
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  
  constructor() {
    logger.info('TransactionParser initialized');
  }
  
  /**
   * Parse a Helius transaction into trade details
   */
  parseTrade(tx: any, walletAddress: string): ParsedTrade | null {
    try {
      // Identify DEX program
      const dexProgram = this.identifyDexProgram(tx);
      const dexName = dexProgram ? this.DEX_PROGRAMS[dexProgram] : 'Unknown';
      
      // Extract token transfers
      const tokenTransfers = tx.tokenTransfers || [];
      
      if (tokenTransfers.length === 0) {
        return null;
      }
      
      // Analyze token flows
      const result = this.analyzeTokenFlows(tokenTransfers, tx.nativeTransfers || [], walletAddress);
      
      if (!result) {
        return null;
      }
      
      return {
        ...result,
        dexProgram,
        dexName
      };
    } catch (error: any) {
      logger.error('Error parsing trade', {
        signature: tx.signature,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Identify which DEX was used
   */
  private identifyDexProgram(tx: any): string | undefined {
    const accountData = tx.accountData || [];
    
    for (const account of accountData) {
      if (this.DEX_PROGRAMS[account.account]) {
        return account.account;
      }
    }
    
    // Check instructions
    if (tx.instructions) {
      for (const instruction of tx.instructions) {
        if (instruction.programId && this.DEX_PROGRAMS[instruction.programId]) {
          return instruction.programId;
        }
      }
    }
    
    return undefined;
  }
  
  /**
   * Analyze token flows to determine trade type and details
   */
  private analyzeTokenFlows(
    tokenTransfers: any[],
    nativeTransfers: any[],
    walletAddress: string
  ): Omit<ParsedTrade, 'dexProgram' | 'dexName'> | null {
    // Separate incoming and outgoing token transfers
    const incoming: any[] = [];
    const outgoing: any[] = [];
    
    for (const transfer of tokenTransfers) {
      const toUser = transfer.toUserAccount || transfer.toTokenAccount;
      const fromUser = transfer.fromUserAccount || transfer.fromTokenAccount;
      
      // Check if this is relevant to our wallet
      const isReceiving = toUser === walletAddress;
      const isSending = fromUser === walletAddress;
      
      if (isReceiving) {
        incoming.push(transfer);
      }
      
      if (isSending) {
        outgoing.push(transfer);
      }
    }
    
    // Calculate SOL amount from native transfers
    let solAmount = 0;
    for (const transfer of nativeTransfers) {
      if (transfer.fromUserAccount === walletAddress) {
        solAmount -= transfer.amount || 0;
      }
      if (transfer.toUserAccount === walletAddress) {
        solAmount += transfer.amount || 0;
      }
    }
    solAmount = Math.abs(solAmount) / 1e9; // Convert lamports to SOL
    
    // Determine trade type
    let type: 'BUY' | 'SELL' | 'TRANSFER' | 'SWAP' | 'UNKNOWN' = 'UNKNOWN';
    let tokenMint = '';
    let tokenAmount = 0;
    
    // BUY: Wallet receives token, sends SOL
    if (incoming.length > 0 && solAmount > 0) {
      type = 'BUY';
      const mainTransfer = incoming[0]; // Take the largest or first transfer
      tokenMint = mainTransfer.mint;
      tokenAmount = mainTransfer.tokenAmount;
    }
    // SELL: Wallet sends token, receives SOL
    else if (outgoing.length > 0 && solAmount > 0) {
      type = 'SELL';
      const mainTransfer = outgoing[0];
      tokenMint = mainTransfer.mint;
      tokenAmount = mainTransfer.tokenAmount;
    }
    // SWAP: Token for token
    else if (incoming.length > 0 && outgoing.length > 0) {
      type = 'SWAP';
      // For now, focus on the received token
      const mainTransfer = incoming[0];
      tokenMint = mainTransfer.mint;
      tokenAmount = mainTransfer.tokenAmount;
    }
    // TRANSFER: Just token movement
    else if (incoming.length > 0 || outgoing.length > 0) {
      type = 'TRANSFER';
      const mainTransfer = (incoming[0] || outgoing[0]);
      tokenMint = mainTransfer.mint;
      tokenAmount = Math.abs(mainTransfer.tokenAmount);
    }
    
    if (!tokenMint) {
      return null;
    }
    
    const pricePerToken = tokenAmount > 0 ? solAmount / tokenAmount : 0;
    
    return {
      type,
      tokenMint,
      tokenAmount: Math.abs(tokenAmount),
      solAmount,
      pricePerToken
    };
  }
  
  /**
   * Classify transaction for database storage
   */
  classifyTransaction(tx: any, walletAddress: string): string {
    const trade = this.parseTrade(tx, walletAddress);
    
    if (!trade) {
      return 'UNKNOWN';
    }
    
    return trade.type;
  }
  
  /**
   * Extract all relevant details for database insertion
   */
  extractTransactionDetails(
    tx: any,
    walletAddress: string,
    walletId: number
  ): WalletTransaction | null {
    const trade = this.parseTrade(tx, walletAddress);
    
    if (!trade) {
      return null;
    }
    
    const blockTime = new Date((tx.timestamp || 0) * 1000);
    
    return {
      walletId,
      signature: tx.signature,
      blockTime,
      slot: tx.slot || 0,
      transactionType: trade.type,
      tokenMint: trade.tokenMint,
      tokenSymbol: undefined, // Will be enriched later
      tokenName: undefined,
      tokenDecimals: undefined,
      solAmount: trade.solAmount,
      tokenAmount: trade.tokenAmount,
      pricePerTokenSol: trade.pricePerToken,
      pricePerTokenUsd: 0, // Will be enriched later
      dexProgram: trade.dexProgram,
      dexName: trade.dexName,
      feeLamports: tx.fee || 0,
      success: true,
      rawTransaction: tx
    };
  }
  
  /**
   * Batch parse multiple transactions
   */
  parseTransactions(
    transactions: any[],
    walletAddress: string,
    walletId: number
  ): WalletTransaction[] {
    const parsed: WalletTransaction[] = [];
    
    for (const tx of transactions) {
      const details = this.extractTransactionDetails(tx, walletAddress, walletId);
      
      if (details) {
        parsed.push(details);
      }
    }
    
    logger.info('Parsed transactions', {
      total: transactions.length,
      parsed: parsed.length,
      walletAddress
    });
    
    return parsed;
  }
}

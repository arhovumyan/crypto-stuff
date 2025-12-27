import { Connection, PublicKey, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js';
import { config } from './config';
import logger from './logger';
import { SwapTransaction, PoolState } from './types';
import BN from 'bn.js';

/**
 * SwapMonitor - Monitors DEX transactions and extracts swap data
 * Tracks Raydium AMM, PumpFun, and PumpSwap
 */
export class SwapMonitor {
  private connection: Connection;
  private poolStates: Map<string, PoolState>;
  private isMonitoring: boolean;
  private subscriptionIds: number[];
  
  // DEX program IDs
  private readonly RAYDIUM_AMM = new PublicKey(config.dexPrograms.raydiumAMM);
  private readonly PUMPFUN = new PublicKey(config.dexPrograms.pumpFun);
  private readonly PUMPSWAP = new PublicKey(config.dexPrograms.pumpSwap);
  
  constructor() {
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.wsUrl,
    });
    this.poolStates = new Map();
    this.isMonitoring = false;
    this.subscriptionIds = [];
  }
  
  /**
   * Start monitoring DEX programs
   */
  async start(onSwap: (swap: SwapTransaction) => void): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('[SwapMonitor] Already monitoring');
      return;
    }
    
    this.isMonitoring = true;
    logger.info('[SwapMonitor] Starting swap monitor...');
    
    // Subscribe to Raydium AMM
    const raydiumSubId = this.connection.onLogs(
      this.RAYDIUM_AMM,
      async (logs) => {
        try {
          const swap = await this.parseRaydiumTransaction(logs.signature);
          if (swap) {
            onSwap(swap);
          }
        } catch (error) {
          logger.error('[SwapMonitor] Error parsing Raydium tx:', error);
        }
      },
      'confirmed'
    );
    this.subscriptionIds.push(raydiumSubId);
    logger.info('[SwapMonitor] Subscribed to Raydium AMM');
    
    // Subscribe to PumpFun
    const pumpFunSubId = this.connection.onLogs(
      this.PUMPFUN,
      async (logs) => {
        try {
          const swap = await this.parsePumpFunTransaction(logs.signature);
          if (swap) {
            onSwap(swap);
          }
        } catch (error) {
          logger.error('[SwapMonitor] Error parsing PumpFun tx:', error);
        }
      },
      'confirmed'
    );
    this.subscriptionIds.push(pumpFunSubId);
    logger.info('[SwapMonitor] Subscribed to PumpFun');
    
    // Subscribe to PumpSwap
    const pumpSwapSubId = this.connection.onLogs(
      this.PUMPSWAP,
      async (logs) => {
        try {
          const swap = await this.parsePumpSwapTransaction(logs.signature);
          if (swap) {
            onSwap(swap);
          }
        } catch (error) {
          logger.error('[SwapMonitor] Error parsing PumpSwap tx:', error);
        }
      },
      'confirmed'
    );
    this.subscriptionIds.push(pumpSwapSubId);
    logger.info('[SwapMonitor] Subscribed to PumpSwap');
    
    logger.info('[SwapMonitor] Monitoring started successfully');
  }
  
  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    logger.info('[SwapMonitor] Stopping monitor...');
    this.isMonitoring = false;
    
    for (const subId of this.subscriptionIds) {
      await this.connection.removeOnLogsListener(subId);
    }
    this.subscriptionIds = [];
    
    logger.info('[SwapMonitor] Monitor stopped');
  }
  
  /**
   * Parse Raydium AMM transaction
   */
  private async parseRaydiumTransaction(signature: string): Promise<SwapTransaction | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta || tx.meta.err) {
        return null;
      }
      
      return this.extractSwapData(tx, 'raydium', signature);
    } catch (error) {
      logger.error('[SwapMonitor] Error parsing Raydium transaction:', error);
      return null;
    }
  }
  
  /**
   * Parse PumpFun transaction
   */
  private async parsePumpFunTransaction(signature: string): Promise<SwapTransaction | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta || tx.meta.err) {
        return null;
      }
      
      return this.extractSwapData(tx, 'pumpfun', signature);
    } catch (error) {
      logger.error('[SwapMonitor] Error parsing PumpFun transaction:', error);
      return null;
    }
  }
  
  /**
   * Parse PumpSwap transaction
   */
  private async parsePumpSwapTransaction(signature: string): Promise<SwapTransaction | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta || tx.meta.err) {
        return null;
      }
      
      return this.extractSwapData(tx, 'pumpswap', signature);
    } catch (error) {
      logger.error('[SwapMonitor] Error parsing PumpSwap transaction:', error);
      return null;
    }
  }
  
  /**
   * Extract swap data from parsed transaction
   */
  private extractSwapData(
    tx: ParsedTransactionWithMeta,
    dexProgram: 'raydium' | 'pumpfun' | 'pumpswap',
    signature: string
  ): SwapTransaction | null {
    try {
      if (!tx.meta || !tx.blockTime) {
        return null;
      }
      
      const slot = tx.slot;
      const timestamp = tx.blockTime;
      
      // Extract token transfers from pre/post balances
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];
      
      if (preBalances.length === 0 || postBalances.length === 0) {
        return null;
      }
      
      // Find the trader (first account that's not the program)
      const trader = tx.transaction.message.accountKeys[0];
      if (!trader || !('pubkey' in trader)) {
        return null;
      }
      
      // Detect direction and amounts from balance changes
      let tokenMint = '';
      let poolAddress = '';
      let isBuy = false;
      let amountIn = 0;
      let amountOut = 0;
      let poolReservesToken = 0;
      let poolReservesQuote = 0;
      
      // Find token transfers
      for (let i = 0; i < preBalances.length; i++) {
        const pre = preBalances[i];
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        
        if (!post || !pre.mint) continue;
        
        const preAmount = parseFloat(pre.uiTokenAmount.uiAmountString || '0');
        const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0');
        const change = postAmount - preAmount;
        
        if (Math.abs(change) > 0) {
          if (change > 0) {
            // Received tokens (buy)
            isBuy = true;
            amountOut = change;
            tokenMint = pre.mint;
          } else {
            // Sent tokens (sell)
            isBuy = false;
            amountIn = Math.abs(change);
            tokenMint = pre.mint;
          }
        }
      }
      
      if (!tokenMint || amountIn === 0 || amountOut === 0) {
        return null;
      }
      
      // Get pool reserves from on-chain accounts
      // For Raydium, pool is typically account index 4-5
      // We'll approximate from the transaction data
      const instruction = tx.transaction.message.instructions[0];
      if ('accounts' in instruction && instruction.accounts) {
        const accounts = instruction.accounts as PublicKey[];
        if (accounts.length > 4) {
          poolAddress = accounts[4].toBase58();
        }
      }
      
      // Calculate derived price and reserves
      const derivedPrice = isBuy ? amountIn / amountOut : amountOut / amountIn;
      
      // Estimate pool reserves (we'll fetch actual on-chain later)
      // For now, use transaction amounts as proxy
      poolReservesToken = amountOut * 100; // Rough estimate
      poolReservesQuote = amountIn * 100; // Rough estimate
      
      const priceImpact = this.calculatePriceImpact(
        isBuy ? amountIn : amountOut,
        isBuy ? poolReservesQuote : poolReservesToken
      );
      
      const swap: SwapTransaction = {
        signature,
        slot,
        timestamp,
        tokenMint,
        poolAddress,
        traderWallet: trader.pubkey.toBase58(),
        isBuy,
        amountIn,
        amountOut,
        priceImpact,
        derivedPrice,
        poolReservesToken,
        poolReservesQuote,
        dexProgram,
      };
      
      // Update pool state cache
      this.updatePoolState(swap);
      
      return swap;
    } catch (error) {
      logger.error('[SwapMonitor] Error extracting swap data:', error);
      return null;
    }
  }
  
  /**
   * Calculate price impact
   */
  private calculatePriceImpact(amount: number, reserve: number): number {
    if (reserve === 0) return 0;
    return (amount / reserve) * 100;
  }
  
  /**
   * Update pool state from swap
   */
  private updatePoolState(swap: SwapTransaction): void {
    const existing = this.poolStates.get(swap.poolAddress);
    
    const newState: PoolState = {
      poolAddress: swap.poolAddress,
      tokenMint: swap.tokenMint,
      tokenReserve: swap.poolReservesToken,
      quoteReserve: swap.poolReservesQuote,
      lastUpdate: swap.timestamp,
      lastSlot: swap.slot,
    };
    
    this.poolStates.set(swap.poolAddress, newState);
  }
  
  /**
   * Get pool state
   */
  getPoolState(poolAddress: string): PoolState | undefined {
    return this.poolStates.get(poolAddress);
  }
  
  /**
   * Get pool liquidity
   */
  getPoolLiquidity(poolAddress: string): number {
    const pool = this.poolStates.get(poolAddress);
    if (!pool) return 0;
    
    // Total liquidity in quote token terms
    return pool.quoteReserve * 2; // Approximate TVL
  }
}

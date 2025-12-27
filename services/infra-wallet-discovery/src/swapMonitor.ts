import { Connection, PublicKey, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js';
import { config } from './config';
import logger from './logger';
import { SwapTransaction, PoolState } from './types';
import BN from 'bn.js';

/**
 * Request queue item with retry logic
 */
interface QueuedRequest {
  signature: string;
  dexType: 'raydium' | 'pumpfun' | 'pumpswap';
  onSwap: (swap: SwapTransaction) => void;
  retries: number;
  resolve: (swap: SwapTransaction | null) => void;
  reject: (error: Error) => void;
}

/**
 * SwapMonitor - Monitors DEX transactions and extracts swap data
 * Tracks Raydium AMM, PumpFun, and PumpSwap
 */
export class SwapMonitor {
  private connection: Connection;
  private poolStates: Map<string, PoolState>;
  private isMonitoring: boolean;
  private subscriptionIds: number[];
  
  // Request queue for rate limiting
  private requestQueue: QueuedRequest[] = [];
  private isProcessingQueue: boolean = false;
  private readonly MAX_CONCURRENT_REQUESTS: number;
  private REQUESTS_PER_SECOND: number; // Made mutable for adaptive rate limiting
  private readonly INITIAL_REQUESTS_PER_SECOND: number;
  private readonly MAX_RETRIES: number;
  private activeRequests: number = 0;
  private lastRequestTime: number = 0;
  private MIN_REQUEST_INTERVAL: number; // Made mutable for adaptive rate limiting
  private consecutive429Errors: number = 0;
  private readonly MAX_QUEUE_SIZE = 1000; // Drop requests if queue gets too large
  private swapSampleCounter: number = 0; // Counter for sampling swaps
  private readonly SWAP_SAMPLE_RATE: number; // Process 1 out of every N swaps
  
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
    
    // Initialize rate limiting from config
    this.MAX_CONCURRENT_REQUESTS = config.rateLimit.maxConcurrentRequests;
    this.INITIAL_REQUESTS_PER_SECOND = config.rateLimit.requestsPerSecond;
    this.REQUESTS_PER_SECOND = config.rateLimit.requestsPerSecond;
    this.MAX_RETRIES = config.rateLimit.maxRetries;
    this.MIN_REQUEST_INTERVAL = 1000 / this.REQUESTS_PER_SECOND;
    this.SWAP_SAMPLE_RATE = config.rateLimit.swapSampleRate;
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
    logger.info(`[SwapMonitor] Rate limiting: ${this.REQUESTS_PER_SECOND} req/s, max ${this.MAX_CONCURRENT_REQUESTS} concurrent`);
    logger.info(`[SwapMonitor] Swap sampling: processing 1 out of every ${this.SWAP_SAMPLE_RATE} swaps (${(100/this.SWAP_SAMPLE_RATE).toFixed(1)}%)`);
    
    // Start queue processor
    this.processQueue();
    
    // Start periodic rate limit recovery (check every 30 seconds)
    setInterval(() => {
      if (this.consecutive429Errors === 0 && this.requestQueue.length < 100) {
        this.recoverRateLimit();
      }
    }, 30000);
    
    // Subscribe to Raydium AMM
    const raydiumSubId = this.connection.onLogs(
      this.RAYDIUM_AMM,
      async (logs) => {
        this.queueTransaction('raydium', logs.signature, onSwap);
      },
      'confirmed'
    );
    this.subscriptionIds.push(raydiumSubId);
    logger.info('[SwapMonitor] Subscribed to Raydium AMM');
    
    // Subscribe to PumpFun
    const pumpFunSubId = this.connection.onLogs(
      this.PUMPFUN,
      async (logs) => {
        this.queueTransaction('pumpfun', logs.signature, onSwap);
      },
      'confirmed'
    );
    this.subscriptionIds.push(pumpFunSubId);
    logger.info('[SwapMonitor] Subscribed to PumpFun');
    
    // Subscribe to PumpSwap
    const pumpSwapSubId = this.connection.onLogs(
      this.PUMPSWAP,
      async (logs) => {
        this.queueTransaction('pumpswap', logs.signature, onSwap);
      },
      'confirmed'
    );
    this.subscriptionIds.push(pumpSwapSubId);
    logger.info('[SwapMonitor] Subscribed to PumpSwap');
    
    logger.info('[SwapMonitor] Monitoring started successfully');
  }
  
  /**
   * Queue a transaction for processing (rate-limited with sampling)
   */
  private queueTransaction(
    dexType: 'raydium' | 'pumpfun' | 'pumpswap',
    signature: string,
    onSwap: (swap: SwapTransaction) => void
  ): void {
    // Swap sampling: only process 1 out of every SWAP_SAMPLE_RATE swaps
    this.swapSampleCounter++;
    if (this.swapSampleCounter % this.SWAP_SAMPLE_RATE !== 0) {
      // Skip this swap
      return;
    }
    
    // If queue is still too large even with sampling, drop oldest requests
    if (this.requestQueue.length >= this.MAX_QUEUE_SIZE) {
      const dropped = this.requestQueue.splice(0, 50); // Drop oldest 50
      logger.warn(`[SwapMonitor] Queue full (${this.requestQueue.length}), dropped ${dropped.length} old requests`);
    }
    
    const request: QueuedRequest = {
      signature,
      dexType,
      onSwap,
      retries: 0,
      resolve: () => {},
      reject: () => {},
    };
    
    this.requestQueue.push(request);
    
    // Log queue size periodically (less frequently now)
    if (this.requestQueue.length % 200 === 0 && this.requestQueue.length > 0) {
      logger.info(`[SwapMonitor] Queue size: ${this.requestQueue.length}, Active: ${this.activeRequests}, Rate: ${this.REQUESTS_PER_SECOND.toFixed(1)} req/s, Sampled: ${this.swapSampleCounter} swaps`);
    }
  }
  
  /**
   * Process queued requests with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    while (this.isMonitoring || this.requestQueue.length > 0) {
      // Wait if we're at max concurrent requests
      if (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      
      // Wait if we need to throttle requests (with adaptive rate limiting)
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => 
          setTimeout(resolve, this.MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
        continue;
      }
      
      // Get next request from queue
      const request = this.requestQueue.shift();
      if (!request) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // Process request
      this.activeRequests++;
      this.lastRequestTime = Date.now();
      this.processTransaction(request).finally(() => {
        this.activeRequests--;
      });
    }
    
    this.isProcessingQueue = false;
  }
  
  /**
   * Adjust rate limit based on 429 errors (adaptive rate limiting)
   */
  private adjustRateLimit(): void {
    this.consecutive429Errors++;
    
    // Reduce rate by 50% after 3 consecutive 429s, or immediately if we're still hitting errors
    if (this.consecutive429Errors >= 3) {
      const newRate = Math.max(0.5, this.REQUESTS_PER_SECOND * 0.5);
      if (newRate < this.REQUESTS_PER_SECOND) {
        this.REQUESTS_PER_SECOND = newRate;
        this.MIN_REQUEST_INTERVAL = 1000 / this.REQUESTS_PER_SECOND;
        logger.warn(
          `[SwapMonitor] Rate limit reduced to ${this.REQUESTS_PER_SECOND.toFixed(1)} req/s after ${this.consecutive429Errors} consecutive 429 errors`
        );
        // Reset counter after reducing rate
        this.consecutive429Errors = 0;
      }
    }
  }
  
  /**
   * Gradually increase rate limit back to normal when no errors
   */
  private recoverRateLimit(): void {
    if (this.REQUESTS_PER_SECOND < this.INITIAL_REQUESTS_PER_SECOND) {
      // Gradually increase rate by 10% every 30 seconds of no errors
      const newRate = Math.min(
        this.INITIAL_REQUESTS_PER_SECOND,
        this.REQUESTS_PER_SECOND * 1.1
      );
      if (newRate > this.REQUESTS_PER_SECOND) {
        this.REQUESTS_PER_SECOND = newRate;
        this.MIN_REQUEST_INTERVAL = 1000 / this.REQUESTS_PER_SECOND;
        logger.info(`[SwapMonitor] Rate limit recovering: ${this.REQUESTS_PER_SECOND.toFixed(1)} req/s`);
      }
    }
  }
  
  /**
   * Process a single transaction with retry logic
   */
  private async processTransaction(request: QueuedRequest): Promise<void> {
    try {
      const swap = await this.fetchTransactionWithRetry(request);
      if (swap) {
        request.onSwap(swap);
      }
      request.resolve(swap);
    } catch (error) {
      if (request.retries < this.MAX_RETRIES) {
        // Re-queue for retry
        request.retries++;
        const backoffDelay = Math.min(500 * Math.pow(2, request.retries - 1), 5000);
        setTimeout(() => {
          this.requestQueue.push(request);
        }, backoffDelay);
      } else {
        logger.error(`[SwapMonitor] Failed to process transaction after ${this.MAX_RETRIES} retries: ${request.signature}`);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  
  /**
   * Fetch transaction with retry and exponential backoff
   */
  private async fetchTransactionWithRetry(request: QueuedRequest): Promise<SwapTransaction | null> {
    let lastError: Error | null = null;
    let hadRateLimitError = false;
    
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        let swap: SwapTransaction | null = null;
        
        switch (request.dexType) {
          case 'raydium':
            swap = await this.parseRaydiumTransaction(request.signature);
            break;
          case 'pumpfun':
            swap = await this.parsePumpFunTransaction(request.signature);
            break;
          case 'pumpswap':
            swap = await this.parsePumpSwapTransaction(request.signature);
            break;
        }
        
        // Success - reset error counter if we had rate limit errors
        if (hadRateLimitError) {
          this.consecutive429Errors = 0;
          this.recoverRateLimit();
        }
        
        return swap;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error
        const isRateLimit = 
          error?.message?.includes('429') ||
          error?.message?.includes('Too Many Requests') ||
          error?.message?.includes('rate limit') ||
          error?.message?.includes('rate limited') ||
          error?.code === 429 ||
          error?.code === -32429;
        
        if (isRateLimit) {
          hadRateLimitError = true;
          this.adjustRateLimit();
          
          if (attempt < this.MAX_RETRIES) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 10s
            const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
            logger.warn(
              `[SwapMonitor] Rate limited, retrying after ${backoffDelay}ms (attempt ${attempt + 1}/${this.MAX_RETRIES}), current rate: ${this.REQUESTS_PER_SECOND.toFixed(1)} req/s`
            );
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          }
        }
        
        // For non-rate-limit errors, throw immediately
        if (!isRateLimit) {
          throw error;
        }
      }
    }
    
    throw lastError || new Error('Failed to fetch transaction');
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
    
    // Wait for queue to drain (with timeout)
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    while (this.requestQueue.length > 0 || this.activeRequests > 0) {
      if (Date.now() - startTime > maxWaitTime) {
        logger.warn('[SwapMonitor] Queue drain timeout, stopping anyway');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
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

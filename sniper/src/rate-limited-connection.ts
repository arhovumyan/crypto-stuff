/**
 * Rate-Limited Connection Wrapper
 * Prevents 429 errors by throttling RPC calls and suppressing spam
 */

import { Connection, ConnectionConfig, PublicKey } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';

const log = createLogger('rate-limited-rpc');

interface QueuedCall {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  fn: () => Promise<any>;
}

export class RateLimitedConnection {
  private connection: Connection;
  private callQueue: QueuedCall[] = [];
  private isProcessing = false;
  private lastCallTime = 0;
  private minDelayMs = 50; // Minimum 50ms between calls (20 calls/second max)
  private consecutive429s = 0;
  private last429LogTime = 0;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL = 30000; // Cache for 30 seconds

  constructor(endpoint: string, config?: ConnectionConfig) {
    this.connection = new Connection(endpoint, config);
  }

  /**
   * Queue an RPC call with rate limiting
   */
  private async queueCall<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.callQueue.push({ resolve, reject, fn });
      this.processQueue();
    });
  }

  /**
   * Process the call queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.callQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.callQueue.length > 0) {
      const call = this.callQueue.shift()!;
      
      try {
        // Rate limiting: ensure minimum delay between calls
        const timeSinceLastCall = Date.now() - this.lastCallTime;
        if (timeSinceLastCall < this.minDelayMs) {
          await this.sleep(this.minDelayMs - timeSinceLastCall);
        }

        // If we've had many 429s, increase delay
        if (this.consecutive429s > 5) {
          const backoffDelay = Math.min(1000 * Math.pow(2, this.consecutive429s - 5), 10000);
          await this.sleep(backoffDelay);
        }

        const result = await call.fn();
        this.lastCallTime = Date.now();
        this.consecutive429s = 0; // Reset on success
        call.resolve(result);
      } catch (error: any) {
        // Handle 429 errors silently (with occasional summary)
        if (error?.message?.includes('429') || error?.code === -32429) {
          this.consecutive429s++;
          
          // Only log 429 errors every 10 seconds to reduce spam
          const now = Date.now();
          if (now - this.last429LogTime > 10000) {
            log.warn(`⚠️  Rate limited (429) - ${this.consecutive429s} consecutive. Throttling requests...`);
            this.last429LogTime = now;
          }

          // Exponential backoff for 429s
          const backoffDelay = Math.min(500 * Math.pow(2, Math.min(this.consecutive429s - 1, 5)), 5000);
          await this.sleep(backoffDelay);

          // Retry the call
          this.callQueue.unshift(call);
        } else {
          // Non-429 errors: reject immediately
          this.consecutive429s = 0;
          call.reject(error);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get parsed account info with caching and rate limiting
   */
  async getParsedAccountInfo(
    publicKey: PublicKey,
    commitment?: 'processed' | 'confirmed' | 'finalized'
  ): Promise<any> {
    const cacheKey = `${publicKey.toBase58()}_${commitment || 'confirmed'}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const result = await this.queueCall(() =>
      this.connection.getParsedAccountInfo(publicKey, commitment)
    );

    // Cache the result
    this.cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    // Clean old cache entries (keep last 1000)
    if (this.cache.size > 1000) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      this.cache = new Map(entries.slice(0, 1000));
    }

    return result;
  }

  /**
   * Get parsed transaction with rate limiting
   */
  async getParsedTransaction(
    signature: string,
    options?: any
  ): Promise<any> {
    return this.queueCall(() =>
      this.connection.getParsedTransaction(signature, options)
    );
  }

  /**
   * Get latest blockhash with rate limiting
   */
  async getLatestBlockhash(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    return this.queueCall(() =>
      this.connection.getLatestBlockhash(commitment)
    );
  }

  /**
   * Get balance with rate limiting
   */
  async getBalance(publicKey: PublicKey, commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<number> {
    return this.queueCall(() =>
      this.connection.getBalance(publicKey, commitment)
    );
  }

  /**
   * Send raw transaction with rate limiting
   */
  async sendRawTransaction(
    rawTransaction: Buffer | Uint8Array,
    options?: { skipPreflight?: boolean; maxRetries?: number; preflightCommitment?: 'processed' | 'confirmed' | 'finalized' }
  ): Promise<string> {
    return this.queueCall(() =>
      this.connection.sendRawTransaction(rawTransaction, options)
    );
  }

  /**
   * Confirm transaction with rate limiting
   */
  async confirmTransaction(
    signature: string,
    commitment?: 'processed' | 'confirmed' | 'finalized'
  ): Promise<any> {
    return this.queueCall(() =>
      this.connection.confirmTransaction(signature, commitment)
    );
  }

  /**
   * Get signature status with rate limiting
   */
  async getSignatureStatus(signature: string): Promise<any> {
    return this.queueCall(() =>
      this.connection.getSignatureStatus(signature)
    );
  }

  /**
   * Get all other Connection methods via proxy
   */
  get rpc(): Connection {
    return this.connection;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get rate limit stats
   */
  getStats(): { queueLength: number; consecutive429s: number; cacheSize: number } {
    return {
      queueLength: this.callQueue.length,
      consecutive429s: this.consecutive429s,
      cacheSize: this.cache.size
    };
  }
}


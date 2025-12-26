/**
 * Unified Liquidity Service
 * Single source of truth for liquidity measurement
 * 
 * CRITICAL: This fixes the inconsistency where decoded liquidity differs from Gate A liquidity
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';

const log = createLogger('liquidity-service');

// Liquidity measurement result status
export type LiquidityStatus = 'OK' | 'UNKNOWN' | 'FAIL';

export interface LiquidityResult {
  status: LiquidityStatus;
  solLiquidity: number;
  source: 'vault_balance' | 'account_lamports' | 'cached' | 'none';
  error?: string;
  retryable: boolean;
}

interface CachedLiquidity {
  result: LiquidityResult;
  timestamp: number;
}

// Raydium AMM account layout offsets
// Pool account structure (simplified):
// - status: u64 (8 bytes)
// - nonce: u64 (8 bytes)
// - orderNum: u64 (8 bytes)
// - depth: u64 (8 bytes)
// - coinDecimals: u64 (8 bytes)
// - pcDecimals: u64 (8 bytes)
// - state: u64 (8 bytes)
// - resetFlag: u64 (8 bytes)
// - minSize: u64 (8 bytes)
// - volMaxCutRatio: u64 (8 bytes)
// - amountWaveRatio: u64 (8 bytes)
// - coinLotSize: u64 (8 bytes)
// - pcLotSize: u64 (8 bytes)
// - minPriceMultiplier: u64 (8 bytes)
// - maxPriceMultiplier: u64 (8 bytes)
// - systemDecimalsValue: u64 (8 bytes)
// ... more fields ...
// - coinVault: PublicKey (32 bytes) @ offset 336
// - pcVault: PublicKey (32 bytes) @ offset 368

const RAYDIUM_COIN_VAULT_OFFSET = 336;
const RAYDIUM_PC_VAULT_OFFSET = 368;
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export class LiquidityService {
  private connection: Connection;
  private cache: Map<string, CachedLiquidity> = new Map();
  private cacheTTL = 5000; // 5 second cache for liquidity
  private settlingRetries = 3;
  private settlingDelayMs = 1500; // Wait between retries during settling
  
  // Track RPC failures to implement backoff
  private rpcFailures = 0;
  private lastRpcFailure = 0;
  private backoffMs = 100;
  
  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Get liquidity for a pool - THE SINGLE SOURCE OF TRUTH
   * 
   * @param poolAddress - Raydium pool address
   * @param forceRefresh - Bypass cache
   * @returns LiquidityResult with status OK/UNKNOWN/FAIL
   */
  async getLiquidity(
    poolAddress: string,
    forceRefresh: boolean = false
  ): Promise<LiquidityResult> {
    // Check cache first
    if (!forceRefresh) {
      const cached = this.cache.get(poolAddress);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return { ...cached.result, source: 'cached' };
      }
    }

    // Apply backoff if we've been hitting RPC failures
    if (this.rpcFailures > 0 && Date.now() - this.lastRpcFailure < this.backoffMs * this.rpcFailures) {
      return {
        status: 'UNKNOWN',
        solLiquidity: 0,
        source: 'none',
        error: 'RPC backoff in effect',
        retryable: true
      };
    }

    try {
      const result = await this.measureLiquidityFromPool(poolAddress);
      
      // Cache successful results
      if (result.status === 'OK') {
        this.cache.set(poolAddress, {
          result,
          timestamp: Date.now()
        });
        this.rpcFailures = 0; // Reset on success
      }
      
      return result;
    } catch (error: any) {
      this.rpcFailures++;
      this.lastRpcFailure = Date.now();
      
      // Check if it's a rate limiting error
      const isRateLimit = error?.message?.includes('429') || 
                          error?.code === -32429 ||
                          error?.message?.includes('Too Many Requests');
      
      return {
        status: 'FAIL',
        solLiquidity: 0,
        source: 'none',
        error: error?.message || String(error),
        retryable: isRateLimit
      };
    }
  }

  /**
   * Get liquidity with settling window - retries during initial pool setup
   * Use this for newly detected pools that may still be initializing
   */
  async getLiquidityWithSettling(
    poolAddress: string,
    maxRetries: number = this.settlingRetries
  ): Promise<LiquidityResult> {
    let lastResult: LiquidityResult | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await this.getLiquidity(poolAddress, attempt > 0);
      lastResult = result;
      
      // If we got a valid reading, return it
      if (result.status === 'OK' && result.solLiquidity > 0) {
        log.info(`✅ Liquidity confirmed after ${attempt + 1} attempts: ${result.solLiquidity.toFixed(2)} SOL`, {
          poolAddress: poolAddress.slice(0, 12) + '...',
          source: result.source
        });
        return result;
      }
      
      // If it's a hard failure (not retryable), stop
      if (result.status === 'FAIL' && !result.retryable) {
        log.warn(`❌ Liquidity check failed (non-retryable): ${result.error}`, {
          poolAddress: poolAddress.slice(0, 12) + '...'
        });
        return result;
      }
      
      // Wait before retry (settling window)
      if (attempt < maxRetries - 1) {
        log.debug(`⏳ Liquidity settling, retry ${attempt + 1}/${maxRetries}...`);
        await this.sleep(this.settlingDelayMs);
      }
    }
    
    // Return last result (UNKNOWN if all retries failed)
    return lastResult || {
      status: 'UNKNOWN',
      solLiquidity: 0,
      source: 'none',
      error: 'All retries exhausted',
      retryable: false
    };
  }

  /**
   * Core liquidity measurement - reads from Raydium pool vaults
   */
  private async measureLiquidityFromPool(poolAddress: string): Promise<LiquidityResult> {
    const poolPubkey = new PublicKey(poolAddress);
    
    // Get pool account data
    const poolAccount = await this.connection.getAccountInfo(poolPubkey, 'confirmed');
    
    if (!poolAccount || !poolAccount.data) {
      return {
        status: 'FAIL',
        solLiquidity: 0,
        source: 'none',
        error: 'Pool account not found',
        retryable: true // Pool might still be creating
      };
    }

    // Check if this is a valid Raydium pool (752 bytes)
    if (poolAccount.data.length !== 752) {
      return {
        status: 'FAIL',
        solLiquidity: 0,
        source: 'none',
        error: `Invalid pool size: ${poolAccount.data.length} bytes`,
        retryable: false
      };
    }

    try {
      // Extract vault addresses from pool data
      const coinVault = new PublicKey(poolAccount.data.slice(RAYDIUM_COIN_VAULT_OFFSET, RAYDIUM_COIN_VAULT_OFFSET + 32));
      const pcVault = new PublicKey(poolAccount.data.slice(RAYDIUM_PC_VAULT_OFFSET, RAYDIUM_PC_VAULT_OFFSET + 32));

      // Get vault balances
      const [coinVaultInfo, pcVaultInfo] = await Promise.all([
        this.connection.getAccountInfo(coinVault, 'confirmed'),
        this.connection.getAccountInfo(pcVault, 'confirmed')
      ]);

      // Determine which vault holds SOL
      let solLiquidity = 0;
      
      // Check coin vault
      if (coinVaultInfo) {
        const parsedCoin = await this.getTokenBalance(coinVault);
        if (parsedCoin.mint === NATIVE_SOL) {
          solLiquidity = parsedCoin.balance;
        }
      }
      
      // Check PC vault if coin vault wasn't SOL
      if (solLiquidity === 0 && pcVaultInfo) {
        const parsedPc = await this.getTokenBalance(pcVault);
        if (parsedPc.mint === NATIVE_SOL) {
          solLiquidity = parsedPc.balance;
        }
      }

      // Fallback: use lamports from vault accounts
      if (solLiquidity === 0) {
        // Try to get wrapped SOL balance from token accounts
        const coinLamports = coinVaultInfo?.lamports || 0;
        const pcLamports = pcVaultInfo?.lamports || 0;
        
        // Use the larger one (likely the SOL side)
        solLiquidity = Math.max(coinLamports, pcLamports) / LAMPORTS_PER_SOL;
      }

      return {
        status: 'OK',
        solLiquidity,
        source: 'vault_balance',
        retryable: false
      };
    } catch (error: any) {
      // Vault parsing failed, try fallback
      return {
        status: 'UNKNOWN',
        solLiquidity: 0,
        source: 'none',
        error: `Vault parsing error: ${error?.message}`,
        retryable: true
      };
    }
  }

  /**
   * Get token balance from a token account
   */
  private async getTokenBalance(tokenAccount: PublicKey): Promise<{ mint: string; balance: number }> {
    try {
      const info = await this.connection.getParsedAccountInfo(tokenAccount, 'confirmed');
      
      if (info.value && 'parsed' in info.value.data) {
        const parsed = info.value.data.parsed;
        if (parsed.type === 'account') {
          return {
            mint: parsed.info.mint,
            balance: parsed.info.tokenAmount.uiAmount || 0
          };
        }
      }
    } catch {
      // Ignore - will use fallback
    }
    
    return { mint: '', balance: 0 };
  }

  /**
   * Estimate liquidity from transaction data (for initial detection)
   * Used when we don't have pool address yet
   */
  async estimateLiquidityFromTx(
    signature: string
  ): Promise<LiquidityResult> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!tx || !tx.meta) {
        return {
          status: 'UNKNOWN',
          solLiquidity: 0,
          source: 'none',
          error: 'Transaction not found',
          retryable: true
        };
      }

      // Look for SOL transfers in the transaction
      const preBalances = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;
      
      // Find the largest SOL deposit (likely the liquidity)
      let maxDeposit = 0;
      for (let i = 0; i < preBalances.length; i++) {
        const delta = postBalances[i] - preBalances[i];
        if (delta > maxDeposit) {
          maxDeposit = delta;
        }
      }

      const solLiquidity = maxDeposit / LAMPORTS_PER_SOL;

      return {
        status: 'OK',
        solLiquidity,
        source: 'account_lamports',
        retryable: false
      };
    } catch (error: any) {
      return {
        status: 'FAIL',
        solLiquidity: 0,
        source: 'none',
        error: error?.message || String(error),
        retryable: true
      };
    }
  }

  /**
   * Clear cache for a specific pool
   */
  clearCache(poolAddress: string): void {
    this.cache.delete(poolAddress);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.cache.clear();
    this.rpcFailures = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


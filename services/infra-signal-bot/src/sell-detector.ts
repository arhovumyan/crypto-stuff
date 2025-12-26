/**
 * Sell Detector
 * Detects large sell events that exceed threshold percentage of pool liquidity
 */

import { EventEmitter } from 'events';
import pg from 'pg';
import { createLogger } from './logger.js';
import { RawTrade, PoolState, LargeSellEvent, InfraSignalConfig } from './types.js';
import { TradeFeed } from './trade-feed.js';

const log = createLogger('sell-detector');
const { Pool } = pg;

export class SellDetector extends EventEmitter {
  private tradeFeed: TradeFeed;
  private config: InfraSignalConfig;
  private db: pg.Pool;
  
  // Track recent sells per token
  private recentSells: Map<string, LargeSellEvent[]> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(tradeFeed: TradeFeed, config: InfraSignalConfig, dbConnectionString: string) {
    super();
    this.tradeFeed = tradeFeed;
    this.config = config;
    this.db = new Pool({ connectionString: dbConnectionString });
  }

  /**
   * Start detecting large sells
   */
  start(): void {
    log.info('Starting sell detector...', {
      minLiquidityPct: this.config.minSellLiquidityPct,
      maxLiquidityPct: this.config.maxSellLiquidityPct,
    });

    // Listen to trade feed for sells
    this.tradeFeed.on('trade', (trade: RawTrade) => {
      if (trade.type === 'sell') {
        this.analyzeSell(trade);
      }
    });

    // Cleanup old sells periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldSells();
    }, 30000);
  }

  /**
   * Analyze a sell trade to determine if it's "large"
   */
  private async analyzeSell(trade: RawTrade): Promise<void> {
    try {
      // Get pool state for liquidity calculation
      const poolState = await this.tradeFeed.getPoolState(trade.tokenMint);
      if (!poolState) {
        log.debug(`No pool state for ${trade.tokenMint.slice(0, 8)}...`);
        return;
      }

      // Calculate sell as percentage of pool liquidity
      const liquidityPct = (trade.amountSOL / poolState.liquiditySOL) * 100;

      // Check if sell meets our threshold
      if (liquidityPct < this.config.minSellLiquidityPct) {
        return; // Too small, ignore
      }

      if (liquidityPct > this.config.maxSellLiquidityPct) {
        log.debug(`Sell too large (${liquidityPct.toFixed(2)}% > ${this.config.maxSellLiquidityPct}%), likely panic sell`);
        return; // Too large, likely panic sell not interesting
      }

      // This is a significant sell event!
      const sellEvent: LargeSellEvent = {
        signature: trade.signature,
        poolAddress: poolState.poolAddress,
        tokenMint: trade.tokenMint,
        sellerWallet: trade.traderWallet,
        sellAmountToken: trade.amountToken,
        sellAmountSOL: trade.amountSOL,
        sellAmountUSD: trade.amountUSD,
        liquidityPct,
        priceBefore: poolState.priceUSD,
        priceAfter: undefined, // Will be updated after impact
        priceImpactPct: undefined,
        detectedAt: new Date(),
        wasAbsorbed: false,
        status: 'pending',
      };

      log.info('🔴 LARGE SELL DETECTED', {
        token: trade.tokenMint.slice(0, 8) + '...',
        seller: trade.traderWallet.slice(0, 8) + '...',
        amountSOL: trade.amountSOL.toFixed(4),
        liquidityPct: liquidityPct.toFixed(2) + '%',
      });

      // Store the sell event
      this.addRecentSell(trade.tokenMint, sellEvent);

      // Persist to database
      await this.persistSellEvent(sellEvent);

      // Emit event for absorption detector
      this.emit('largeSell', sellEvent);
    } catch (error) {
      log.error(`Error analyzing sell: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Add to recent sells tracking
   */
  private addRecentSell(tokenMint: string, sellEvent: LargeSellEvent): void {
    const existing = this.recentSells.get(tokenMint) || [];
    existing.push(sellEvent);
    
    // Keep only sells within the detection window
    const cutoff = Date.now() - this.config.sellDetectionWindowMs;
    const filtered = existing.filter(s => s.detectedAt.getTime() > cutoff);
    
    this.recentSells.set(tokenMint, filtered);
  }

  /**
   * Get recent large sells for a token
   */
  getRecentSells(tokenMint: string): LargeSellEvent[] {
    return this.recentSells.get(tokenMint) || [];
  }

  /**
   * Get pending sells waiting for absorption
   */
  getPendingSells(): LargeSellEvent[] {
    const pending: LargeSellEvent[] = [];
    for (const sells of this.recentSells.values()) {
      pending.push(...sells.filter(s => s.status === 'pending'));
    }
    return pending;
  }

  /**
   * Update sell event status (called by absorption detector)
   */
  async updateSellStatus(
    signature: string, 
    updates: Partial<LargeSellEvent>
  ): Promise<void> {
    // Update in memory
    for (const [tokenMint, sells] of this.recentSells) {
      const sell = sells.find(s => s.signature === signature);
      if (sell) {
        Object.assign(sell, updates);
        break;
      }
    }

    // Update in database
    try {
      await this.db.query(
        `UPDATE large_sell_events 
         SET was_absorbed = $1, 
             absorption_amount_sol = $2,
             absorption_wallet = $3,
             absorption_delay_ms = $4,
             status = $5,
             resolved_at = NOW()
         WHERE signature = $6`,
        [
          updates.wasAbsorbed || false,
          updates.absorptionAmountSOL || null,
          updates.absorptionWallet || null,
          updates.absorptionDelayMs || null,
          updates.status || 'pending',
          signature,
        ]
      );
    } catch (error) {
      log.error(`Failed to update sell status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Persist sell event to database
   */
  private async persistSellEvent(sell: LargeSellEvent): Promise<number | null> {
    try {
      const result = await this.db.query(
        `INSERT INTO large_sell_events (
          signature, pool_address, token_mint, seller_wallet,
          sell_amount_token, sell_amount_sol, sell_amount_usd,
          liquidity_pct, price_before, status, detected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (signature) DO NOTHING
        RETURNING id`,
        [
          sell.signature,
          sell.poolAddress,
          sell.tokenMint,
          sell.sellerWallet,
          sell.sellAmountToken,
          sell.sellAmountSOL,
          sell.sellAmountUSD || null,
          sell.liquidityPct,
          sell.priceBefore || null,
          sell.status,
          sell.detectedAt,
        ]
      );

      if (result.rows.length > 0) {
        sell.id = result.rows[0].id;
        return result.rows[0].id;
      }
      return null;
    } catch (error) {
      log.error(`Failed to persist sell event: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Cleanup old sells from memory
   */
  private cleanupOldSells(): void {
    const cutoff = Date.now() - this.config.sellDetectionWindowMs * 2;
    
    for (const [tokenMint, sells] of this.recentSells) {
      const filtered = sells.filter(s => s.detectedAt.getTime() > cutoff);
      if (filtered.length === 0) {
        this.recentSells.delete(tokenMint);
      } else {
        this.recentSells.set(tokenMint, filtered);
      }
    }
  }

  /**
   * Stop the detector
   */
  stop(): void {
    log.info('Stopping sell detector...');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.db.end();
  }

  /**
   * Get statistics
   */
  getStats(): { tokensTracked: number; pendingSells: number; totalSells: number } {
    let totalSells = 0;
    let pendingSells = 0;
    
    for (const sells of this.recentSells.values()) {
      totalSells += sells.length;
      pendingSells += sells.filter(s => s.status === 'pending').length;
    }

    return {
      tokensTracked: this.recentSells.size,
      pendingSells,
      totalSells,
    };
  }
}


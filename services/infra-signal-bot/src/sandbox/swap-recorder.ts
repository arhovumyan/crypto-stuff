/**
 * Swap Recorder
 * Records real on-chain swaps to dataset for later replay
 */

import { EventEmitter } from 'events';
import { writeFile, appendFile } from 'fs/promises';
import pg from 'pg';
import { createLogger } from '../logger.js';
import { HistoricalSwapEvent } from './types.js';
import { PoolStateReader } from './pool-state-reader.js';
import { TradeFeed } from '../trade-feed.js';
import { RawTrade } from '../types.js';

const log = createLogger('swap-recorder');
const { Pool } = pg;

export class SwapRecorder extends EventEmitter {
  private tradeFeed: TradeFeed;
  private poolStateReader: PoolStateReader;
  private db: pg.Pool;
  private outputPath: string;
  private infraWallets: Set<string>;
  private recordCount = 0;
  private skippedCount = 0;
  private filteredCount = 0; // Count of trades filtered out (not from infra wallets)
  private startTime: Date | null = null;

  private seenTraders: Set<string> = new Set();

  constructor(
    tradeFeed: TradeFeed,
    rpcUrl: string,
    dbConnectionString: string,
    outputPath: string,
    infraWallets: string[] = [] // Optional: if empty, record all trades
  ) {
    super();
    this.tradeFeed = tradeFeed;
    this.poolStateReader = new PoolStateReader(rpcUrl);
    this.db = new Pool({ connectionString: dbConnectionString });
    this.outputPath = outputPath;
    this.infraWallets = new Set(infraWallets.map(w => w.trim().toLowerCase()));
    
    if (this.infraWallets.size > 0) {
      log.info(`✅ Filtering for ${this.infraWallets.size} infra wallet(s)`);
    } else {
      log.info('📡 Recording ALL swaps (wallet filtering done at subscription level)');
    }
  }

  /**
   * Start recording swaps
   */
  async start(): Promise<void> {
    log.info('Starting swap recorder', { outputPath: this.outputPath });
    this.startTime = new Date();

    // Listen for trades from the feed
    this.tradeFeed.on('trade', async (trade: RawTrade) => {
      await this.recordSwap(trade);
    });

    // Log stats periodically
    setInterval(() => {
      this.logStats();
    }, 60000); // Every minute
  }

  /**
   * Record a swap event
   */
  private async recordSwap(trade: RawTrade): Promise<void> {
    try {
      // Track unique traders we've seen
      const traderLower = trade.traderWallet.toLowerCase();
      if (!this.seenTraders.has(traderLower)) {
        this.seenTraders.add(traderLower);
        log.info(`🎯 Infra wallet trade: ${trade.traderWallet.slice(0, 12)}...`, {
          type: trade.type,
          token: trade.tokenMint.slice(0, 8) + '...',
          amount: trade.amountSOL.toFixed(4) + ' SOL',
        });
      } else {
        // Log subsequent trades more briefly
        log.debug(`Trade from ${trade.traderWallet.slice(0, 12)}...`, {
          type: trade.type,
          amount: trade.amountSOL.toFixed(4) + ' SOL',
        });
      }
      
      // Optional: if infraWallets filter is enabled, verify the trade
      if (this.infraWallets.size > 0 && !this.infraWallets.has(traderLower)) {
        this.filteredCount++;
        return;
      }
      
      // Read pool state from on-chain
      // Note: poolAddress and programId need to be added to RawTrade type
      const poolAddress = (trade as any).poolAddress || '';
      const programId = (trade as any).programId || '';
      
      const poolState = await this.poolStateReader.readPoolState(
        poolAddress,
        programId,
        trade.slot
      );

      if (!poolState) {
        log.warn(`Skipping swap - could not read pool state`, {
          signature: trade.signature,
          slot: trade.slot,
        });
        this.skippedCount++;
        return;
      }

      // Estimate liquidity USD (optional, for reporting only)
      const liquidityUSD = await this.poolStateReader.estimateLiquidityUSD(
        poolState?.poolAddress,
        poolState?.reserveSOL || 0
      );

      // Create historical event
      const amountIn = (trade as any).amountIn || trade.amountSOL;
      const amountOut = (trade as any).amountOut || 0;
      
      // Extract transaction index from trade (if available from Helius)
      // TODO: Verify Helius provides txIndex in transaction metadata
      const txIndex = (trade as any).txIndex || 0;
      const logIndex = (trade as any).logIndex || 0;
      const innerIndex = (trade as any).innerIndex || 0;
      
      const event: HistoricalSwapEvent = {
        slot: trade.slot,
        signature: trade.signature,
        blockTime: trade.blockTime,
        programId: programId,
        txIndex: txIndex,
        logIndex: logIndex,
        innerIndex: innerIndex,
        poolAddress: poolState.poolAddress,
        tokenMint: trade.tokenMint,
        baseMint: 'So11111111111111111111111111111111111111112', // SOL
        trader: trade.traderWallet,
        side: trade.type,
        amountIn: amountIn,
        amountOut: amountOut,
        amountInSOL: trade.amountSOL,
        amountOutSOL: amountOut * poolState.priceSOL,
        poolState: {
          ...poolState,
          liquidityUSD,
        },
      };

      // Write to JSONL file
      await this.writeToJSONL(event);

      // Store in database (disabled for Phase 2 - only JSONL needed for replay)
      // await this.storeInDatabase(event);

      this.recordCount++;
      
      // Log progress
      if (this.recordCount % 100 === 0) {
        log.info(`Recorded ${this.recordCount} swaps (${this.skippedCount} skipped)`);
      }

      this.emit('swapRecorded', event);
    } catch (error) {
      log.error(`Failed to record swap: ${error instanceof Error ? error.message : String(error)}`, {
        signature: trade.signature,
      });
      this.skippedCount++;
    }
  }

  /**
   * Write event to JSONL file
   */
  private async writeToJSONL(event: HistoricalSwapEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await appendFile(this.outputPath, line, 'utf-8');
  }

  /**
   * Store event in database
   */
  private async storeInDatabase(event: HistoricalSwapEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO swap_events (
        slot, signature, block_time, program_id,
        pool_address, token_mint, base_mint, trader, side,
        amount_in, amount_out, amount_in_sol, amount_out_sol,
        pool_slot, pool_reserve_sol, pool_reserve_token, pool_price_sol, pool_liquidity_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (signature) DO NOTHING`,
      [
        event.slot,
        event.signature,
        new Date(event.blockTime * 1000),
        event.programId,
        event.poolAddress,
        event.tokenMint,
        event.baseMint,
        event.trader,
        event.side,
        event.amountIn,
        event.amountOut,
        event.amountInSOL,
        event.amountOutSOL,
        event.poolState.slot,
        event.poolState.reserveSOL,
        event.poolState.reserveToken,
        event.poolState.priceSOL,
        event.poolState.liquidityUSD,
      ]
    );
  }

  /**
   * Log recording stats
   */
  private logStats(): void {
    const elapsed = this.startTime
      ? (Date.now() - this.startTime.getTime()) / 1000
      : 0;
    const rate = elapsed > 0 ? this.recordCount / elapsed : 0;

    const stats: any = {
      recorded: this.recordCount,
      skipped: this.skippedCount,
      elapsed: `${elapsed.toFixed(0)}s`,
      rate: `${rate.toFixed(2)}/s`,
    };
    
    if (this.infraWallets.size > 0) {
      stats.filtered = this.filteredCount;
    }

    log.info('📊 Swap Recorder Stats', stats);
  }

  /**
   * Stop recording and finalize
   */
  async stop(): Promise<void> {
    log.info('Stopping swap recorder', {
      totalRecorded: this.recordCount,
      totalSkipped: this.skippedCount,
    });
    
    // Emit final stats
    this.logStats();
  }

  /**
   * Get recording stats
   */
  getStats(): { recorded: number; skipped: number; filtered?: number } {
    const stats: { recorded: number; skipped: number; filtered?: number } = {
      recorded: this.recordCount,
      skipped: this.skippedCount,
    };
    
    if (this.infraWallets.size > 0) {
      stats.filtered = this.filteredCount;
    }
    
    return stats;
  }
}


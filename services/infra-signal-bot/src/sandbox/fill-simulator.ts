/**
 * Fill Simulator
 * Simulates trade execution with realistic friction (slippage, latency, failures)
 */

import { createLogger } from '../logger.js';
import { ExecutionConfig, FillResult, HistoricalSwapEvent, PoolStateSnapshot } from './types.js';

const log = createLogger('fill-simulator');

export class FillSimulator {
  private config: ExecutionConfig;
  private poolStateHistory: Map<string, HistoricalSwapEvent[]> = new Map();
  
  // Seeded RNG for deterministic results
  private rngSeed: number;
  private rngState: number;

  constructor(config: ExecutionConfig, seed: number = 12345) {
    this.config = config;
    this.rngSeed = seed;
    this.rngState = seed;
  }

  /**
   * Load pool state history (from recorded events)
   */
  loadPoolStateHistory(events: HistoricalSwapEvent[]): void {
    for (const event of events) {
      const key = event.tokenMint;
      if (!this.poolStateHistory.has(key)) {
        this.poolStateHistory.set(key, []);
      }
      this.poolStateHistory.get(key)!.push(event);
    }

    // Sort by slot
    for (const [key, events] of this.poolStateHistory.entries()) {
      events.sort((a, b) => a.slot - b.slot);
    }

    log.info(`Loaded pool state history for ${this.poolStateHistory.size} tokens`);
  }

  /**
   * Simulate a fill
   */
  async simulateFill(
    side: 'buy' | 'sell',
    amountSOL: number,
    tokenMint: string,
    currentSlot: number
  ): Promise<FillResult> {
    // 1. Apply latency
    const executionSlot = currentSlot + this.config.latencySlots;

    // 2. Fetch pool state at execution slot
    const poolState = this.getPoolStateAtSlot(tokenMint, executionSlot);

    if (!poolState) {
      return {
        success: false,
        fillPrice: 0,
        slippageBps: 0,
        feesSOL: 0,
        latencySlots: this.config.latencySlots,
        failureReason: 'quote_stale',
      };
    }

    // 3. Check for quote stale failure
    if (this.random() < this.config.quoteStaleProbability) {
      return {
        success: false,
        fillPrice: poolState.priceSOL,
        slippageBps: 0,
        feesSOL: 0,
        latencySlots: this.config.latencySlots,
        failureReason: 'quote_stale',
      };
    }

    // 4. Check for route fail
    if (this.random() < this.config.routeFailProbability) {
      return {
        success: false,
        fillPrice: poolState.priceSOL,
        slippageBps: 0,
        feesSOL: 0,
        latencySlots: this.config.latencySlots,
        failureReason: 'route_fail',
      };
    }

    // 5. Compute slippage
    const slippageBps = this.computeSlippage(side, amountSOL, poolState);

    // 6. Check for slippage exceeded
    const maxSlippageBps = this.config.slippageBps * 2; // 2x configured slippage = fail
    if (slippageBps > maxSlippageBps) {
      return {
        success: false,
        fillPrice: poolState.priceSOL,
        slippageBps,
        feesSOL: 0,
        latencySlots: this.config.latencySlots,
        failureReason: 'slippage_exceeded',
      };
    }

    // 7. Apply fees
    const feesSOL = amountSOL * (this.config.lpFeeBps / 10000) + this.config.priorityFeeSOL;

    // 8. Check for partial fill
    if (this.random() < this.config.partialFillProbability) {
      const executedAmountSOL = amountSOL * this.config.partialFillRatio;
      return {
        success: true,
        fillPrice: poolState.priceSOL * (1 + slippageBps / 10000),
        slippageBps,
        feesSOL: feesSOL * this.config.partialFillRatio,
        latencySlots: this.config.latencySlots,
        failureReason: 'partial_fill',
        partialFillRatio: this.config.partialFillRatio,
        executedAmountSOL,
      };
    }

    // 9. Successful fill
    return {
      success: true,
      fillPrice: poolState.priceSOL * (1 + slippageBps / 10000),
      slippageBps,
      feesSOL,
      latencySlots: this.config.latencySlots,
      executedAmountSOL: amountSOL,
    };
  }

  /**
   * Get pool state at a specific slot (from history)
   */
  private getPoolStateAtSlot(tokenMint: string, slot: number): PoolStateSnapshot | null {
    const events = this.poolStateHistory.get(tokenMint);
    if (!events || events.length === 0) {
      return null;
    }

    // Find closest event at or before the target slot
    let closestEvent: HistoricalSwapEvent | null = null;
    for (const event of events) {
      if (event.slot <= slot) {
        closestEvent = event;
      } else {
        break; // Events are sorted by slot
      }
    }

    return closestEvent ? closestEvent.poolState : null;
  }

  /**
   * Compute slippage based on model
   */
  private computeSlippage(
    side: 'buy' | 'sell',
    amountSOL: number,
    poolState: PoolStateSnapshot
  ): number {
    if (this.config.slippageModel === 'none') {
      return 0;
    }

    if (this.config.slippageModel === 'constant') {
      return this.config.slippageBps;
    }

    if (this.config.slippageModel === 'reserves') {
      // Constant-product formula: x * y = k
      const k = poolState.reserveSOL * poolState.reserveToken;
      
      if (side === 'buy') {
        // Buying tokens with SOL
        const newReserveSOL = poolState.reserveSOL + amountSOL;
        const newReserveToken = k / newReserveSOL;
        const newPrice = newReserveSOL / newReserveToken;
        const oldPrice = poolState.priceSOL;
        return ((newPrice - oldPrice) / oldPrice) * 10000; // Convert to bps
      } else {
        // Selling tokens for SOL (less common in this strategy)
        const tokensToSell = amountSOL / poolState.priceSOL;
        const newReserveToken = poolState.reserveToken + tokensToSell;
        const newReserveSOL = k / newReserveToken;
        const newPrice = newReserveSOL / newReserveToken;
        const oldPrice = poolState.priceSOL;
        return ((oldPrice - newPrice) / oldPrice) * 10000; // Convert to bps (negative = better price)
      }
    }

    return 0;
  }

  /**
   * Seeded random number generator (for deterministic results)
   */
  private random(): number {
    // Simple LCG (Linear Congruential Generator)
    const a = 1664525;
    const c = 1013904223;
    const m = 2 ** 32;
    this.rngState = (a * this.rngState + c) % m;
    return this.rngState / m;
  }

  /**
   * Reset RNG (for testing)
   */
  resetRNG(): void {
    this.rngState = this.rngSeed;
  }

  /**
   * Update config
   */
  setConfig(config: ExecutionConfig): void {
    this.config = config;
  }
}


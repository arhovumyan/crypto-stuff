import { config } from './config';
import logger from './logger';
import { SwapTransaction, LargeSellEvent } from './types';
import { SwapMonitor } from './swapMonitor';
import { v4 as uuidv4 } from 'uuid';

/**
 * LargeSellDetector - Detects market stress events (large sells)
 * Opens observation windows for absorption analysis
 */
export class LargeSellDetector {
  private swapMonitor: SwapMonitor;
  private activeSellEvents: Map<string, LargeSellEvent>;
  private recentSwaps: Map<string, SwapTransaction[]>; // tokenMint -> swaps
  
  constructor(swapMonitor: SwapMonitor) {
    this.swapMonitor = swapMonitor;
    this.activeSellEvents = new Map();
    this.recentSwaps = new Map();
    
    // Clean up old data every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  
  /**
   * Process a swap and check if it's a large sell event
   */
  processSwap(
    swap: SwapTransaction,
    onLargeSell: (event: LargeSellEvent) => void
  ): void {
    // Store swap for price tracking
    this.storeSwap(swap);
    
    // Only interested in sells
    if (swap.isBuy) {
      return;
    }
    
    // Get pool liquidity
    const poolLiquidity = this.swapMonitor.getPoolLiquidity(swap.poolAddress);
    if (poolLiquidity === 0) {
      return;
    }
    
    // Calculate sell as % of pool
    const sellAmountUsd = swap.amountIn * swap.derivedPrice;
    const percentOfPool = (sellAmountUsd / poolLiquidity) * 100;
    
    // Check if this qualifies as a large sell
    if (
      percentOfPool >= config.discovery.minSellPercentOfPool &&
      percentOfPool <= config.discovery.maxSellPercentOfPool
    ) {
      // This is a large sell event!
      const event = this.createSellEvent(swap, sellAmountUsd, percentOfPool);
      this.activeSellEvents.set(event.id, event);
      
      logger.info(
        `[LargeSellDetector] 🔴 Large sell detected: ${swap.tokenMint.slice(0, 8)}... ` +
        `${percentOfPool.toFixed(2)}% of pool ($${sellAmountUsd.toFixed(2)})`
      );
      
      onLargeSell(event);
      
      // Schedule observation window end
      setTimeout(() => {
        this.closeObservationWindow(event.id);
      }, config.discovery.absorptionWindowSec * 1000);
    }
  }
  
  /**
   * Create a large sell event
   */
  private createSellEvent(
    swap: SwapTransaction,
    sellAmountUsd: number,
    percentOfPool: number
  ): LargeSellEvent {
    // Get price before sell
    const preEventPrice = this.getRecentAveragePrice(swap.tokenMint, swap.timestamp - 30);
    
    const event: LargeSellEvent = {
      id: uuidv4(),
      tokenMint: swap.tokenMint,
      poolAddress: swap.poolAddress,
      slot: swap.slot,
      timestamp: swap.timestamp,
      sellAmount: swap.amountIn,
      sellAmountUsd,
      percentOfPool,
      sellerWallet: swap.traderWallet,
      preEventPrice: preEventPrice || swap.derivedPrice,
      postEventPrice: swap.derivedPrice,
      observationWindowEndTime: swap.timestamp + config.discovery.absorptionWindowSec,
      status: 'observing',
    };
    
    return event;
  }
  
  /**
   * Store swap for price tracking
   */
  private storeSwap(swap: SwapTransaction): void {
    const swaps = this.recentSwaps.get(swap.tokenMint) || [];
    swaps.push(swap);
    
    // Keep only last 100 swaps per token
    if (swaps.length > 100) {
      swaps.shift();
    }
    
    this.recentSwaps.set(swap.tokenMint, swaps);
  }
  
  /**
   * Get recent average price for a token
   */
  private getRecentAveragePrice(tokenMint: string, beforeTimestamp: number): number | null {
    const swaps = this.recentSwaps.get(tokenMint);
    if (!swaps || swaps.length === 0) {
      return null;
    }
    
    // Get swaps from last 30 seconds before timestamp
    const recentSwaps = swaps.filter(
      s => s.timestamp < beforeTimestamp && s.timestamp > beforeTimestamp - 30
    );
    
    if (recentSwaps.length === 0) {
      return null;
    }
    
    const avgPrice = recentSwaps.reduce((sum, s) => sum + s.derivedPrice, 0) / recentSwaps.length;
    return avgPrice;
  }
  
  /**
   * Close observation window and move to analysis
   */
  private closeObservationWindow(eventId: string): void {
    const event = this.activeSellEvents.get(eventId);
    if (!event) {
      return;
    }
    
    if (event.status === 'observing') {
      event.status = 'analyzing';
      this.activeSellEvents.set(eventId, event);
      
      logger.info(
        `[LargeSellDetector] 📊 Observation window closed for event ${eventId.slice(0, 8)}...`
      );
    }
  }
  
  /**
   * Get active sell event for a token
   */
  getActiveSellEvent(tokenMint: string): LargeSellEvent | null {
    for (const event of this.activeSellEvents.values()) {
      if (event.tokenMint === tokenMint && event.status === 'observing') {
        return event;
      }
    }
    return null;
  }
  
  /**
   * Get event by ID
   */
  getEvent(eventId: string): LargeSellEvent | null {
    return this.activeSellEvents.get(eventId) || null;
  }
  
  /**
   * Update event status
   */
  updateEventStatus(
    eventId: string,
    status: 'observing' | 'analyzing' | 'validated' | 'invalidated'
  ): void {
    const event = this.activeSellEvents.get(eventId);
    if (event) {
      event.status = status;
      this.activeSellEvents.set(eventId, event);
    }
  }
  
  /**
   * Get all events in analyzing state
   */
  getEventsForAnalysis(): LargeSellEvent[] {
    return Array.from(this.activeSellEvents.values()).filter(
      e => e.status === 'analyzing'
    );
  }
  
  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now() / 1000;
    const maxAge = 3600; // 1 hour
    
    // Remove old events
    for (const [id, event] of this.activeSellEvents.entries()) {
      if (now - event.timestamp > maxAge) {
        this.activeSellEvents.delete(id);
      }
    }
    
    // Remove old swaps
    for (const [tokenMint, swaps] of this.recentSwaps.entries()) {
      const filtered = swaps.filter(s => now - s.timestamp < maxAge);
      if (filtered.length === 0) {
        this.recentSwaps.delete(tokenMint);
      } else {
        this.recentSwaps.set(tokenMint, filtered);
      }
    }
    
    logger.debug(
      `[LargeSellDetector] Cleanup: ${this.activeSellEvents.size} events, ` +
      `${this.recentSwaps.size} tokens tracked`
    );
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    activeEvents: number;
    trackedTokens: number;
    observingEvents: number;
    analyzingEvents: number;
  } {
    const observing = Array.from(this.activeSellEvents.values()).filter(
      e => e.status === 'observing'
    ).length;
    
    const analyzing = Array.from(this.activeSellEvents.values()).filter(
      e => e.status === 'analyzing'
    ).length;
    
    return {
      activeEvents: this.activeSellEvents.size,
      trackedTokens: this.recentSwaps.size,
      observingEvents: observing,
      analyzingEvents: analyzing,
    };
  }
}

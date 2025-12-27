import { config } from './config';
import logger from './logger';
import { SwapTransaction, LargeSellEvent, AbsorptionCandidate } from './types';

/**
 * AbsorptionAnalyzer - Analyzes buyer behavior during large sell events
 * Identifies wallets that absorb sell pressure
 */
export class AbsorptionAnalyzer {
  private eventBuyers: Map<string, Map<string, AbsorptionCandidate>>; // eventId -> wallet -> candidate
  private eventSwaps: Map<string, SwapTransaction[]>; // eventId -> swaps during window
  
  constructor() {
    this.eventBuyers = new Map();
    this.eventSwaps = new Map();
  }
  
  /**
   * Process a swap during an active sell event observation window
   */
  processSwapDuringEvent(swap: SwapTransaction, event: LargeSellEvent): void {
    // Only interested in buys during sell events
    if (!swap.isBuy) {
      return;
    }
    
    // Check if this buy is within the observation window
    if (swap.timestamp > event.observationWindowEndTime) {
      return;
    }
    
    // Check if this is the same token
    if (swap.tokenMint !== event.tokenMint) {
      return;
    }
    
    // Store swap for this event
    const swaps = this.eventSwaps.get(event.id) || [];
    swaps.push(swap);
    this.eventSwaps.set(event.id, swaps);
    
    // Calculate response latency
    const responseLatencySlots = swap.slot - event.slot;
    
    // Check if response is within acceptable latency
    if (responseLatencySlots > config.discovery.maxResponseLatencySlots) {
      return; // Too slow to be meaningful absorption
    }
    
    // Get or create candidate for this wallet
    const buyers = this.eventBuyers.get(event.id) || new Map();
    let candidate = buyers.get(swap.traderWallet);
    
    if (!candidate) {
      // New buyer during this event
      candidate = {
        wallet: swap.traderWallet,
        eventId: event.id,
        tokenMint: swap.tokenMint,
        totalBuyAmount: 0,
        totalBuyAmountUsd: 0,
        buyCount: 0,
        absorptionPercent: 0,
        responseLatencySlots,
        avgPriceImpact: 0,
        firstBuySlot: swap.slot,
        lastBuySlot: swap.slot,
        boughtDuringRedCandle: this.isBuyingDuringRedCandle(swap, event),
      };
    }
    
    // Update candidate metrics
    candidate.totalBuyAmount += swap.amountOut;
    candidate.totalBuyAmountUsd += swap.amountOut * swap.derivedPrice;
    candidate.buyCount += 1;
    candidate.lastBuySlot = swap.slot;
    
    // Update average price impact
    candidate.avgPriceImpact = 
      (candidate.avgPriceImpact * (candidate.buyCount - 1) + swap.priceImpact) / candidate.buyCount;
    
    // Calculate absorption percentage
    candidate.absorptionPercent = (candidate.totalBuyAmountUsd / event.sellAmountUsd) * 100;
    
    buyers.set(swap.traderWallet, candidate);
    this.eventBuyers.set(event.id, buyers);
    
    // Log if this is meaningful absorption
    if (
      candidate.absorptionPercent >= config.discovery.minAbsorptionPercent &&
      candidate.absorptionPercent <= config.discovery.maxAbsorptionPercent
    ) {
      logger.info(
        `[AbsorptionAnalyzer] 🟢 Absorption candidate: ${swap.traderWallet.slice(0, 8)}... ` +
        `absorbed ${candidate.absorptionPercent.toFixed(1)}% of sell ` +
        `(${candidate.buyCount} buys, ${responseLatencySlots} slots latency)`
      );
    }
  }
  
  /**
   * Check if buy occurred during red candle (price still down)
   */
  private isBuyingDuringRedCandle(swap: SwapTransaction, event: LargeSellEvent): boolean {
    // If price is still below pre-event price, it's a red candle buy
    return swap.derivedPrice < event.preEventPrice;
  }
  
  /**
   * Analyze all candidates for an event
   */
  analyzeEvent(event: LargeSellEvent): AbsorptionCandidate[] {
    const buyers = this.eventBuyers.get(event.id);
    if (!buyers) {
      return [];
    }
    
    // Filter for meaningful absorption
    const candidates = Array.from(buyers.values()).filter(c => {
      const meetsAbsorptionThreshold = 
        c.absorptionPercent >= config.discovery.minAbsorptionPercent &&
        c.absorptionPercent <= config.discovery.maxAbsorptionPercent;
      
      const boughtDuringDump = c.boughtDuringRedCandle;
      
      const timely = c.responseLatencySlots <= config.discovery.maxResponseLatencySlots;
      
      return meetsAbsorptionThreshold && boughtDuringDump && timely;
    });
    
    // Sort by absorption percent
    candidates.sort((a, b) => b.absorptionPercent - a.absorptionPercent);
    
    if (candidates.length > 0) {
      logger.info(
        `[AbsorptionAnalyzer] Event ${event.id.slice(0, 8)}... analysis: ` +
        `${candidates.length} candidates identified (${buyers.size} total buyers)`
      );
    }
    
    return candidates;
  }
  
  /**
   * Get candidates for a specific event
   */
  getEventCandidates(eventId: string): AbsorptionCandidate[] {
    const buyers = this.eventBuyers.get(eventId);
    if (!buyers) {
      return [];
    }
    return Array.from(buyers.values());
  }
  
  /**
   * Get all swaps during an event
   */
  getEventSwaps(eventId: string): SwapTransaction[] {
    return this.eventSwaps.get(eventId) || [];
  }
  
  /**
   * Calculate buy pressure during event
   */
  getBuyPressure(eventId: string): {
    totalBuyVolume: number;
    totalSellVolume: number;
    buyCount: number;
    sellCount: number;
    netPressure: number;
  } {
    const swaps = this.eventSwaps.get(eventId) || [];
    
    let totalBuyVolume = 0;
    let totalSellVolume = 0;
    let buyCount = 0;
    let sellCount = 0;
    
    for (const swap of swaps) {
      if (swap.isBuy) {
        totalBuyVolume += swap.amountOut * swap.derivedPrice;
        buyCount++;
      } else {
        totalSellVolume += swap.amountIn * swap.derivedPrice;
        sellCount++;
      }
    }
    
    const netPressure = totalBuyVolume - totalSellVolume;
    
    return {
      totalBuyVolume,
      totalSellVolume,
      buyCount,
      sellCount,
      netPressure,
    };
  }
  
  /**
   * Clean up old event data
   */
  cleanup(maxAgeSeconds: number = 3600): void {
    const now = Date.now() / 1000;
    
    // This would require event timestamps - simplified for now
    // In production, track event timestamps and remove old ones
    
    logger.debug(
      `[AbsorptionAnalyzer] Tracking ${this.eventBuyers.size} events, ` +
      `${this.eventSwaps.size} swap histories`
    );
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    eventsTracked: number;
    totalCandidates: number;
    avgCandidatesPerEvent: number;
  } {
    let totalCandidates = 0;
    
    for (const buyers of this.eventBuyers.values()) {
      totalCandidates += buyers.size;
    }
    
    const avgCandidatesPerEvent = 
      this.eventBuyers.size > 0 ? totalCandidates / this.eventBuyers.size : 0;
    
    return {
      eventsTracked: this.eventBuyers.size,
      totalCandidates,
      avgCandidatesPerEvent,
    };
  }
}

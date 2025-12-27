import { config } from './config';
import logger from './logger';
import { LargeSellEvent, StabilizationResult, SwapTransaction } from './types';

/**
 * StabilizationValidator - Validates if price stabilizes after absorption
 */
export class StabilizationValidator {
  private priceHistory: Map<string, number[]>; // tokenMint -> recent prices
  
  constructor() {
    this.priceHistory = new Map();
  }
  
  /**
   * Track price from swap
   */
  trackPrice(swap: SwapTransaction): void {
    const prices = this.priceHistory.get(swap.tokenMint) || [];
    prices.push(swap.derivedPrice);
    
    // Keep last 100 prices
    if (prices.length > 100) {
      prices.shift();
    }
    
    this.priceHistory.set(swap.tokenMint, prices);
  }
  
  /**
   * Validate stabilization after absorption event
   */
  async validateStabilization(
    event: LargeSellEvent,
    recentSwaps: SwapTransaction[]
  ): Promise<StabilizationResult> {
    // Get swaps after the event during stabilization window
    const stabilizationEnd = event.timestamp + config.discovery.stabilizationWindowSec;
    const postEventSwaps = recentSwaps.filter(
      s => s.timestamp > event.observationWindowEndTime && s.timestamp <= stabilizationEnd
    );
    
    if (postEventSwaps.length < 3) {
      // Not enough data
      return this.createResult(event, false, 0);
    }
    
    // Check 1: Did price recover or at least stabilize?
    const priceRecovery = this.calculatePriceRecovery(event, postEventSwaps);
    const newLowMade = this.checkForNewLow(event, postEventSwaps);
    
    // Check 2: Did volume contract?
    const volumeContraction = this.calculateVolumeContraction(event, recentSwaps, postEventSwaps);
    
    // Check 3: Was defense level held?
    const defenseMetrics = this.analyzeDefenseLevel(event, postEventSwaps);
    
    // Check 4: Were there additional large sells?
    const additionalSells = this.checkAdditionalSells(postEventSwaps, event);
    
    // Calculate confidence score
    const confidenceScore = this.calculateConfidenceScore({
      priceRecovery,
      newLowMade,
      volumeContraction,
      defenseHeld: defenseMetrics.held,
      additionalSells,
    });
    
    // Determine if stabilized
    const stabilized = 
      !newLowMade &&
      volumeContraction >= config.discovery.minVolumeContractionPercent &&
      priceRecovery >= -config.discovery.maxPriceDropPercent &&
      defenseMetrics.held &&
      additionalSells === 0 &&
      confidenceScore >= 60;
    
    const result: StabilizationResult = {
      eventId: event.id,
      tokenMint: event.tokenMint,
      stabilized,
      priceRecoveryPercent: priceRecovery,
      newLowMade,
      volumeContractionPercent: volumeContraction,
      defenseLevel: defenseMetrics.level,
      defenseHoldTime: defenseMetrics.holdTime,
      additionalSellsPressure: additionalSells,
      confidenceScore,
    };
    
    if (stabilized) {
      logger.info(
        `[StabilizationValidator] ✅ Stabilization confirmed for ${event.tokenMint.slice(0, 8)}... ` +
        `(confidence: ${confidenceScore.toFixed(0)}%)`
      );
    } else {
      logger.debug(
        `[StabilizationValidator] ❌ Stabilization failed for ${event.tokenMint.slice(0, 8)}...`
      );
    }
    
    return result;
  }
  
  /**
   * Calculate price recovery percentage
   */
  private calculatePriceRecovery(event: LargeSellEvent, postSwaps: SwapTransaction[]): number {
    if (postSwaps.length === 0) return -100;
    
    // Average price after event
    const avgPostPrice = postSwaps.reduce((sum, s) => sum + s.derivedPrice, 0) / postSwaps.length;
    
    // Recovery from post-event price back toward pre-event price
    const recovery = ((avgPostPrice - event.postEventPrice) / event.preEventPrice) * 100;
    return recovery;
  }
  
  /**
   * Check if new low was made after absorption
   */
  private checkForNewLow(event: LargeSellEvent, postSwaps: SwapTransaction[]): boolean {
    if (postSwaps.length === 0) return false;
    
    const lowestPostPrice = Math.min(...postSwaps.map(s => s.derivedPrice));
    return lowestPostPrice < event.postEventPrice * 0.95; // 5% lower
  }
  
  /**
   * Calculate volume contraction
   */
  private calculateVolumeContraction(
    event: LargeSellEvent,
    allSwaps: SwapTransaction[],
    postSwaps: SwapTransaction[]
  ): number {
    // Volume during event (pre + observation window)
    const eventStart = event.timestamp - 60;
    const eventEnd = event.observationWindowEndTime;
    const eventSwaps = allSwaps.filter(s => s.timestamp >= eventStart && s.timestamp <= eventEnd);
    
    if (eventSwaps.length === 0 || postSwaps.length === 0) return 0;
    
    const eventVolume = eventSwaps.length;
    const postVolume = postSwaps.length;
    
    const contraction = ((eventVolume - postVolume) / eventVolume) * 100;
    return Math.max(0, contraction);
  }
  
  /**
   * Analyze if defense level was held
   */
  private analyzeDefenseLevel(
    event: LargeSellEvent,
    postSwaps: SwapTransaction[]
  ): { held: boolean; level: number; holdTime: number } {
    if (postSwaps.length === 0) {
      return { held: false, level: 0, holdTime: 0 };
    }
    
    // Defense level is the post-event price (where absorption happened)
    const defenseLevel = event.postEventPrice;
    
    // Check how many times price bounced from this level
    let holdTime = 0;
    let held = true;
    
    for (const swap of postSwaps) {
      if (swap.derivedPrice >= defenseLevel * 0.95) {
        holdTime += 1;
      } else {
        held = false;
      }
    }
    
    return {
      held,
      level: defenseLevel,
      holdTime,
    };
  }
  
  /**
   * Check for additional large sells during stabilization
   */
  private checkAdditionalSells(postSwaps: SwapTransaction[], event: LargeSellEvent): number {
    let largeSells = 0;
    
    for (const swap of postSwaps) {
      if (!swap.isBuy && swap.amountIn > event.sellAmount * 0.5) {
        largeSells++;
      }
    }
    
    return largeSells;
  }
  
  /**
   * Calculate overall confidence score
   */
  private calculateConfidenceScore(factors: {
    priceRecovery: number;
    newLowMade: boolean;
    volumeContraction: number;
    defenseHeld: boolean;
    additionalSells: number;
  }): number {
    let score = 50; // Start at neutral
    
    // Price recovery (max +20)
    if (factors.priceRecovery > 0) {
      score += Math.min(20, factors.priceRecovery * 2);
    } else {
      score += Math.max(-20, factors.priceRecovery);
    }
    
    // No new low (+15)
    if (!factors.newLowMade) {
      score += 15;
    }
    
    // Volume contraction (max +15)
    score += Math.min(15, factors.volumeContraction / 4);
    
    // Defense held (+20)
    if (factors.defenseHeld) {
      score += 20;
    }
    
    // Additional sells penalty
    score -= factors.additionalSells * 10;
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Create default result
   */
  private createResult(event: LargeSellEvent, stabilized: boolean, confidence: number): StabilizationResult {
    return {
      eventId: event.id,
      tokenMint: event.tokenMint,
      stabilized,
      priceRecoveryPercent: 0,
      newLowMade: false,
      volumeContractionPercent: 0,
      defenseLevel: event.postEventPrice,
      defenseHoldTime: 0,
      additionalSellsPressure: 0,
      confidenceScore: confidence,
    };
  }
}

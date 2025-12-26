// Connection not currently used but reserved for future RPC calls
import { config } from './config';
import logger from './logger';
import {
  AbsorptionEvent,
  StabilizationAnalysis,
  MarketData,
} from './types';

/**
 * StabilizationMonitor confirms that price has stabilized after absorption
 * 
 * Key Concept: After infrastructure wallets absorb sell pressure, we wait for:
 * 1. Price volatility to decrease
 * 2. Price to stabilize around a new equilibrium
 * 3. Volume to normalize (more buying than selling)
 * 4. Liquidity to remain healthy
 * 
 * This ensures we're not catching a falling knife - we enter AFTER stability is confirmed
 */
export class StabilizationMonitor {
  // Track price samples for each token
  private priceSamples: Map<string, Array<{ timestamp: number; price: number }>> = new Map();
  
  // Track market data
  private marketData: Map<string, MarketData> = new Map();

  constructor() {
    // Monitor prices periodically
    setInterval(() => this.updatePrices(), 30000); // Every 30 seconds
  }

  /**
   * Start monitoring an absorption event for stabilization
   */
  async startMonitoring(event: AbsorptionEvent): Promise<void> {
    logger.info(`[StabilizationMonitor] Started monitoring ${event.token.slice(0, 8)}...`);
    
    // Initialize price samples
    this.priceSamples.set(event.token, []);
    
    // Fetch initial market data
    await this.fetchMarketData(event.token);
  }

  /**
   * Check if an absorption event has stabilized
   */
  async checkStabilization(event: AbsorptionEvent): Promise<StabilizationAnalysis> {
    const token = event.token;
    const samples = this.priceSamples.get(token) || [];
    const marketData = this.marketData.get(token);

    if (!marketData) {
      return this.createFailedAnalysis(token, 'No market data available');
    }

    // Get time since absorption
    const now = Date.now() / 1000;
    const timeSinceAbsorption = now - event.absorptionEndTime;

    // Check if we've monitored long enough
    if (timeSinceAbsorption < config.stabilization.monitorDurationSec) {
      return this.createFailedAnalysis(
        token,
        `Monitoring period not complete (${timeSinceAbsorption.toFixed(0)}s / ${config.stabilization.monitorDurationSec}s)`
      );
    }

    // Check if we have enough samples
    if (samples.length < config.stabilization.minPriceSamples) {
      return this.createFailedAnalysis(
        token,
        `Insufficient price samples (${samples.length} / ${config.stabilization.minPriceSamples})`
      );
    }

    // Calculate price statistics
    const prices = samples.map(s => s.price);
    const currentPrice = marketData.price;
    const averagePrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const priceVolatility = this.calculateVolatility(prices);
    const priceDeviation = Math.abs((currentPrice - averagePrice) / averagePrice) * 100;
    const priceRecovery = ((currentPrice - event.priceAtAbsorption) / event.priceAtAbsorption) * 100;

    // Track passed/failed checks
    const passedChecks: string[] = [];
    const failedChecks: string[] = [];

    // Check 1: Volatility
    if (priceVolatility <= config.stabilization.maxVolatilityPercent) {
      passedChecks.push(`Volatility OK (${priceVolatility.toFixed(2)}% <= ${config.stabilization.maxVolatilityPercent}%)`);
    } else {
      failedChecks.push(`High volatility (${priceVolatility.toFixed(2)}% > ${config.stabilization.maxVolatilityPercent}%)`);
    }

    // Check 2: Price deviation from average
    if (priceDeviation <= config.stabilization.maxPriceDeviationPercent) {
      passedChecks.push(`Price stable (${priceDeviation.toFixed(2)}% deviation)`);
    } else {
      failedChecks.push(`Price unstable (${priceDeviation.toFixed(2)}% deviation)`);
    }

    // Check 3: Price recovery (not falling further)
    if (priceRecovery >= config.stabilization.minPriceRecoveryPercent) {
      passedChecks.push(`Price recovered (${priceRecovery.toFixed(2)}%)`);
    } else {
      failedChecks.push(`Price not recovered (${priceRecovery.toFixed(2)}%)`);
    }

    // Check 4: Liquidity
    if (marketData.liquidityUsd >= config.entry.minLiquidityUsd) {
      passedChecks.push(`Liquidity OK ($${marketData.liquidityUsd.toFixed(0)})`);
    } else {
      failedChecks.push(`Low liquidity ($${marketData.liquidityUsd.toFixed(0)})`);
    }

    // Check 5: Volume analysis (buy vs sell)
    const recentVolume = this.analyzeRecentVolume(token);
    const volumeRatio = recentVolume.buyVolume / (recentVolume.sellVolume || 1);
    
    if (volumeRatio >= 1.0) {
      passedChecks.push(`Volume balanced (buy/sell: ${volumeRatio.toFixed(2)})`);
    } else {
      failedChecks.push(`Selling pressure continues (buy/sell: ${volumeRatio.toFixed(2)})`);
    }

    // Calculate stability score (0-100)
    const score = (passedChecks.length / (passedChecks.length + failedChecks.length)) * 100;
    const isStable = failedChecks.length === 0;

    const analysis: StabilizationAnalysis = {
      token,
      isStable,
      currentPrice,
      averagePrice,
      priceVolatilityPercent: priceVolatility,
      priceRecoveryPercent: priceRecovery,
      priceDeviationPercent: priceDeviation,
      priceSamples: samples,
      sampleCount: samples.length,
      monitorDurationSec: timeSinceAbsorption,
      buyVolume: recentVolume.buyVolume,
      sellVolume: recentVolume.sellVolume,
      volumeRatio,
      liquidityUsd: marketData.liquidityUsd,
      passedChecks,
      failedChecks,
      score,
    };

    if (isStable) {
      logger.info(`[StabilizationMonitor] ✅ ${token.slice(0, 8)}... STABILIZED (score: ${score.toFixed(0)})`);
      passedChecks.forEach(check => logger.info(`  ✓ ${check}`));
    } else {
      logger.info(`[StabilizationMonitor] ⏳ ${token.slice(0, 8)}... NOT STABLE (score: ${score.toFixed(0)})`);
      failedChecks.forEach(check => logger.warn(`  ✗ ${check}`));
    }

    return analysis;
  }

  /**
   * Create a failed analysis result
   */
  private createFailedAnalysis(token: string, reason: string): StabilizationAnalysis {
    return {
      token,
      isStable: false,
      currentPrice: 0,
      averagePrice: 0,
      priceVolatilityPercent: 100,
      priceRecoveryPercent: 0,
      priceDeviationPercent: 100,
      priceSamples: [],
      sampleCount: 0,
      monitorDurationSec: 0,
      buyVolume: 0,
      sellVolume: 0,
      volumeRatio: 0,
      liquidityUsd: 0,
      passedChecks: [],
      failedChecks: [reason],
      score: 0,
    };
  }

  /**
   * Calculate price volatility (standard deviation)
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) {
      return 100; // High volatility if insufficient data
    }

    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    return (stdDev / mean) * 100; // As percentage
  }

  /**
   * Analyze recent volume (buy vs sell)
   * In production, this would query actual transaction data
   */
  private analyzeRecentVolume(_token: string): { buyVolume: number; sellVolume: number } {
    // Placeholder - in production, query recent transactions
    // For now, assume balanced volume if we reached this point
    return {
      buyVolume: 100,
      sellVolume: 80,
    };
  }

  /**
   * Update prices for all monitored tokens
   */
  private async updatePrices(): Promise<void> {
    for (const [token] of this.priceSamples) {
      try {
        await this.fetchMarketData(token);
        
        const marketData = this.marketData.get(token);
        if (marketData) {
          const samples = this.priceSamples.get(token) || [];
          samples.push({
            timestamp: Date.now() / 1000,
            price: marketData.price,
          });
          
          // Keep only recent samples (last hour)
          const now = Date.now() / 1000;
          const filtered = samples.filter(s => now - s.timestamp < 3600);
          this.priceSamples.set(token, filtered);
        }
      } catch (error) {
        logger.error(`[StabilizationMonitor] Error updating price for ${token}:`, error);
      }
    }
  }

  /**
   * Fetch current market data for a token
   * In production, this would use Jupiter/DexScreener API
   */
  private async fetchMarketData(token: string): Promise<void> {
    try {
      // Placeholder - in production, query real market data
      // For now, generate mock data
      const mockData: MarketData = {
        token,
        price: Math.random() * 0.001 + 0.0001,
        priceUsd: Math.random() * 0.1 + 0.01,
        liquidityUsd: Math.random() * 100000 + 50000,
        volume24hUsd: Math.random() * 500000 + 100000,
        priceChange24hPercent: (Math.random() - 0.5) * 20,
        timestamp: Date.now() / 1000,
      };

      this.marketData.set(token, mockData);
    } catch (error) {
      logger.error(`[StabilizationMonitor] Error fetching market data for ${token}:`, error);
    }
  }

  /**
   * Stop monitoring a token
   */
  stopMonitoring(token: string): void {
    this.priceSamples.delete(token);
    this.marketData.delete(token);
    logger.info(`[StabilizationMonitor] Stopped monitoring ${token.slice(0, 8)}...`);
  }

  /**
   * Get current market data for a token
   */
  getMarketData(token: string): MarketData | undefined {
    return this.marketData.get(token);
  }
}

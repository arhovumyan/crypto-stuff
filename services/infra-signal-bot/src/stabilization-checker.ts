/**
 * Stabilization Checker
 * Confirms price stabilization after large sells and absorption events
 * Looks for higher lows and price stability before signaling entry
 */

import axios from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';
import { 
  RawTrade, 
  PriceCandle, 
  StabilizationResult, 
  InfraSignalConfig,
  LargeSellEvent
} from './types.js';
import { TradeFeed } from './trade-feed.js';

const log = createLogger('stabilization-checker');

interface TokenPriceState {
  tokenMint: string;
  prices: { price: number; timestamp: number }[];
  candles1m: PriceCandle[];
  candles5m: PriceCandle[];
  lowestLow: number;
  lowestLowTime: number;
  recentHigh: number;
  recentHighTime: number;
  higherLowCount: number;
  lastCheckTime: number;
  defendedLevel?: number;
  absorptionTime?: number;
}

export class StabilizationChecker extends EventEmitter {
  private tradeFeed: TradeFeed;
  private config: InfraSignalConfig;
  
  // Price state per token
  private priceStates: Map<string, TokenPriceState> = new Map();
  private monitoredTokens: Map<string, { sellEvent: LargeSellEvent; startTime: number }> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(tradeFeed: TradeFeed, config: InfraSignalConfig) {
    super();
    this.tradeFeed = tradeFeed;
    this.config = config;
  }

  /**
   * Start the stabilization checker
   */
  start(): void {
    log.info('Starting stabilization checker...', {
      timeframeMs: this.config.stabilizationTimeframeMs,
      minHigherLows: this.config.minHigherLows,
      priceStabilizationPct: this.config.priceStabilizationPct,
    });

    // Track prices from trade feed
    this.tradeFeed.on('trade', (trade: RawTrade) => {
      this.updatePriceState(trade);
    });

    // Periodically check for stabilization
    this.checkInterval = setInterval(() => {
      this.checkAllMonitoredTokens();
    }, 5000);
  }

  /**
   * Start monitoring a token for stabilization after absorption
   */
  monitorForStabilization(
    tokenMint: string,
    sellEvent: LargeSellEvent,
    defendedLevel: number
  ): void {
    const existing = this.priceStates.get(tokenMint) || {
      tokenMint,
      prices: [],
      candles1m: [],
      candles5m: [],
      lowestLow: Infinity,
      lowestLowTime: Date.now(),
      recentHigh: 0,
      recentHighTime: Date.now(),
      higherLowCount: 0,
      lastCheckTime: Date.now(),
    };

    // Reset for new monitoring period
    existing.defendedLevel = defendedLevel;
    existing.absorptionTime = Date.now();
    existing.lowestLow = Infinity;
    existing.higherLowCount = 0;
    
    this.priceStates.set(tokenMint, existing);
    this.monitoredTokens.set(tokenMint, {
      sellEvent,
      startTime: Date.now(),
    });

    log.info(`Monitoring ${tokenMint.slice(0, 8)}... for stabilization`, {
      defendedLevel: defendedLevel.toFixed(8),
    });
  }

  /**
   * Update price state from trade
   */
  private updatePriceState(trade: RawTrade): void {
    const state = this.priceStates.get(trade.tokenMint);
    if (!state) return;

    const price = trade.priceSOL || trade.amountSOL / trade.amountToken;
    const now = Date.now();

    // Add to price history
    state.prices.push({ price, timestamp: now });

    // Keep only last 5 minutes of price data
    const cutoff = now - 300000;
    state.prices = state.prices.filter(p => p.timestamp > cutoff);

    // Update lowest low
    if (price < state.lowestLow) {
      // Check if we're in the monitoring period (after absorption)
      if (state.absorptionTime && now - state.absorptionTime > 10000) {
        // This is a new low after initial period - count it
        state.lowestLow = price;
        state.lowestLowTime = now;
      } else {
        // Initial low
        state.lowestLow = price;
        state.lowestLowTime = now;
      }
    }

    // Update recent high
    if (price > state.recentHigh) {
      state.recentHigh = price;
      state.recentHighTime = now;
    }

    // Update candles
    this.updateCandles(state, price, now);
  }

  /**
   * Update candle data
   */
  private updateCandles(state: TokenPriceState, price: number, timestamp: number): void {
    // 1-minute candles
    const candle1mStart = Math.floor(timestamp / 60000) * 60000;
    let candle1m = state.candles1m.find(c => c.startTime.getTime() === candle1mStart);
    
    if (!candle1m) {
      candle1m = {
        tokenMint: state.tokenMint,
        timeframe: '1m',
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        tradeCount: 0,
        startTime: new Date(candle1mStart),
        endTime: new Date(candle1mStart + 60000),
      };
      state.candles1m.push(candle1m);
      
      // Keep only last 10 candles
      if (state.candles1m.length > 10) {
        state.candles1m = state.candles1m.slice(-10);
      }
    } else {
      candle1m.high = Math.max(candle1m.high, price);
      candle1m.low = Math.min(candle1m.low, price);
      candle1m.close = price;
      candle1m.tradeCount++;
    }

    // 5-minute candles
    const candle5mStart = Math.floor(timestamp / 300000) * 300000;
    let candle5m = state.candles5m.find(c => c.startTime.getTime() === candle5mStart);
    
    if (!candle5m) {
      candle5m = {
        tokenMint: state.tokenMint,
        timeframe: '5m',
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        tradeCount: 0,
        startTime: new Date(candle5mStart),
        endTime: new Date(candle5mStart + 300000),
      };
      state.candles5m.push(candle5m);
      
      // Keep only last 5 candles
      if (state.candles5m.length > 5) {
        state.candles5m = state.candles5m.slice(-5);
      }
    } else {
      candle5m.high = Math.max(candle5m.high, price);
      candle5m.low = Math.min(candle5m.low, price);
      candle5m.close = price;
      candle5m.tradeCount++;
    }
  }

  /**
   * Check all monitored tokens for stabilization
   */
  private async checkAllMonitoredTokens(): Promise<void> {
    const now = Date.now();

    for (const [tokenMint, { sellEvent, startTime }] of this.monitoredTokens) {
      const elapsed = now - startTime;
      
      // Check if monitoring period expired
      if (elapsed > this.config.stabilizationTimeframeMs) {
        log.info(`Stabilization check expired for ${tokenMint.slice(0, 8)}...`);
        this.monitoredTokens.delete(tokenMint);
        this.emit('stabilizationExpired', { tokenMint, sellEvent });
        continue;
      }

      // Need at least 30 seconds before checking
      if (elapsed < 30000) continue;

      // Check stabilization
      const result = this.checkStabilization(tokenMint);
      
      if (result.isStabilized) {
        log.info('✅ STABILIZATION CONFIRMED', {
          token: tokenMint.slice(0, 8) + '...',
          higherLowFormed: result.higherLowFormed,
          defendedLevel: result.defendedLevel.toFixed(8),
          currentPrice: result.currentPrice.toFixed(8),
          timeMs: result.stabilizationTimeMs,
        });

        this.monitoredTokens.delete(tokenMint);
        this.emit('stabilized', {
          tokenMint,
          sellEvent,
          result,
        });
      }
    }
  }

  /**
   * Check if a token has stabilized
   */
  checkStabilization(tokenMint: string): StabilizationResult {
    const state = this.priceStates.get(tokenMint);
    
    if (!state || state.prices.length < 10) {
      return {
        isStabilized: false,
        higherLowFormed: false,
        stabilizationTimeMs: 0,
        defendedLevel: 0,
        currentPrice: 0,
        lowestLow: 0,
        recentHigh: 0,
        reasons: ['Insufficient price data'],
      };
    }

    const now = Date.now();
    const currentPrice = state.prices[state.prices.length - 1].price;
    const reasons: string[] = [];

    // Check for higher lows in recent candles
    const higherLowFormed = this.detectHigherLows(state.candles1m);
    
    if (higherLowFormed) {
      reasons.push('Higher low pattern detected');
    }

    // Check price stability (not making new lows)
    const recentPrices = state.prices.filter(p => p.timestamp > now - 60000);
    const recentLow = Math.min(...recentPrices.map(p => p.price));
    const priceStable = recentLow >= state.lowestLow * 0.99; // Within 1% of lowest

    if (priceStable) {
      reasons.push('Price stopped making lower lows');
    }

    // Check if price is above defended level
    const aboveDefended = state.defendedLevel 
      ? currentPrice >= state.defendedLevel * 0.98 
      : true;

    if (aboveDefended && state.defendedLevel) {
      reasons.push(`Price above defended level (${state.defendedLevel.toFixed(8)})`);
    }

    // Check price volatility has decreased
    const volatilityDecreased = this.checkVolatilityDecreased(state);
    
    if (volatilityDecreased) {
      reasons.push('Volatility has decreased');
    }

    // Determine if stabilized
    const isStabilized = higherLowFormed && priceStable && aboveDefended;

    const stabilizationTimeMs = state.absorptionTime 
      ? now - state.absorptionTime 
      : 0;

    return {
      isStabilized,
      higherLowFormed,
      stabilizationTimeMs,
      defendedLevel: state.defendedLevel || 0,
      currentPrice,
      lowestLow: state.lowestLow,
      recentHigh: state.recentHigh,
      reasons,
    };
  }

  /**
   * Detect higher low pattern in candles
   */
  private detectHigherLows(candles: PriceCandle[]): boolean {
    if (candles.length < this.config.minHigherLows + 1) return false;

    // Sort by time
    const sorted = [...candles].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    // Get the lows
    const lows = sorted.map(c => c.low);
    
    // Count higher lows
    let higherLowCount = 0;
    for (let i = 1; i < lows.length; i++) {
      if (lows[i] > lows[i - 1]) {
        higherLowCount++;
      } else {
        // Reset if lower low
        higherLowCount = 0;
      }
    }

    return higherLowCount >= this.config.minHigherLows;
  }

  /**
   * Check if volatility has decreased
   */
  private checkVolatilityDecreased(state: TokenPriceState): boolean {
    const now = Date.now();
    
    // Compare volatility of first half vs second half of monitoring period
    const midpoint = state.absorptionTime 
      ? state.absorptionTime + (now - state.absorptionTime) / 2
      : now - 60000;

    const firstHalf = state.prices.filter(
      p => p.timestamp < midpoint && p.timestamp > (state.absorptionTime || 0)
    );
    const secondHalf = state.prices.filter(p => p.timestamp >= midpoint);

    if (firstHalf.length < 5 || secondHalf.length < 5) return false;

    const volatility1 = this.calculateVolatility(firstHalf.map(p => p.price));
    const volatility2 = this.calculateVolatility(secondHalf.map(p => p.price));

    return volatility2 < volatility1 * 0.7; // 30% reduction
  }

  /**
   * Calculate price volatility (standard deviation / mean)
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    return mean > 0 ? stdDev / mean : 0;
  }

  /**
   * Get current price for a token
   */
  getCurrentPrice(tokenMint: string): number | null {
    const state = this.priceStates.get(tokenMint);
    if (!state || state.prices.length === 0) return null;
    return state.prices[state.prices.length - 1].price;
  }

  /**
   * Fetch current price from DexScreener as fallback
   */
  async fetchCurrentPrice(tokenMint: string): Promise<number | null> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { timeout: 5000 }
      );

      if (!response.data?.pairs?.[0]) return null;

      return parseFloat(response.data.pairs[0].priceNative || '0');
    } catch (error) {
      return null;
    }
  }

  /**
   * Stop the checker
   */
  stop(): void {
    log.info('Stopping stabilization checker...');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get statistics
   */
  getStats(): { tokensMonitored: number; tokensWithPriceData: number } {
    return {
      tokensMonitored: this.monitoredTokens.size,
      tokensWithPriceData: this.priceStates.size,
    };
  }
}


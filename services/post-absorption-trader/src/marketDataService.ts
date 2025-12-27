import { config } from './config';
import logger from './logger';
import { MarketData } from './types';

/**
 * MarketDataService fetches real-time price and liquidity data
 * Uses Jupiter and DexScreener APIs
 */
export class MarketDataService {
  private jupiterApiUrl: string;
  private dexScreenerApiUrl = 'https://api.dexscreener.com/latest/dex';
  
  // Cache to prevent excessive API calls (1 minute cache)
  private cache: Map<string, { data: MarketData; timestamp: number }> = new Map();
  private cacheTimeoutMs = 60000; // 1 minute

  constructor() {
    this.jupiterApiUrl = config.jupiterApiUrl || 'https://price.jup.ag/v4';
  }

  /**
   * Fetch current market data for a token
   * Tries Jupiter first (faster), falls back to DexScreener
   */
  async fetchMarketData(tokenAddress: string): Promise<MarketData | null> {
    try {
      // Check cache first
      const cached = this.cache.get(tokenAddress);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeoutMs) {
        return cached.data;
      }

      // Try Jupiter first (faster, more reliable)
      let marketData = await this.fetchFromJupiter(tokenAddress);
      
      // Fallback to DexScreener if Jupiter fails
      if (!marketData) {
        marketData = await this.fetchFromDexScreener(tokenAddress);
      }

      if (marketData) {
        // Cache the result
        this.cache.set(tokenAddress, {
          data: marketData,
          timestamp: Date.now(),
        });
        return marketData;
      }

      return null;
    } catch (error) {
      logger.error(`[MarketDataService] Error fetching market data for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch price from Jupiter Price API
   */
  private async fetchFromJupiter(tokenAddress: string): Promise<MarketData | null> {
    try {
      const response = await fetch(`${this.jupiterApiUrl}/price?ids=${tokenAddress}`);
      
      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const priceData = data.data?.[tokenAddress];

      if (!priceData || !priceData.price) {
        return null;
      }

      // Jupiter gives USD price directly
      const priceUsd = priceData.price;
      
      // For price in SOL, we need SOL price
      const solPriceResponse = await fetch(`${this.jupiterApiUrl}/price?ids=So11111111111111111111111111111111111111112`);
      const solData: any = await solPriceResponse.json();
      const solPrice = solData.data?.['So11111111111111111111111111111111111111112']?.price || 100;
      
      const priceInSol = priceUsd / solPrice;

      const marketData: MarketData = {
        token: tokenAddress,
        price: priceInSol,
        priceUsd,
        liquidityUsd: 0, // Jupiter doesn't provide liquidity
        volume24hUsd: 0, // Jupiter doesn't provide volume
        priceChange24hPercent: 0,
        timestamp: Date.now() / 1000,
      };

      logger.debug(`[MarketDataService] Jupiter: ${tokenAddress.slice(0, 8)} = $${priceUsd.toFixed(6)}`);
      return marketData;
    } catch (error) {
      logger.debug(`[MarketDataService] Jupiter fetch failed for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch comprehensive data from DexScreener
   */
  private async fetchFromDexScreener(tokenAddress: string): Promise<MarketData | null> {
    try {
      // DexScreener endpoint for Solana tokens
      const response = await fetch(`${this.dexScreenerApiUrl}/tokens/${tokenAddress}`);
      
      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const pairs = data.pairs;

      if (!pairs || pairs.length === 0) {
        return null;
      }

      // Find the most liquid pair
      const bestPair = pairs.reduce((best: any, current: any) => {
        const currentLiquidity = current.liquidity?.usd || 0;
        const bestLiquidity = best?.liquidity?.usd || 0;
        return currentLiquidity > bestLiquidity ? current : best;
      }, pairs[0]);

      if (!bestPair || !bestPair.priceUsd) {
        return null;
      }

      const priceUsd = parseFloat(bestPair.priceUsd);
      
      // Get SOL price for conversion
      const solPriceResponse = await fetch(`${this.jupiterApiUrl}/price?ids=So11111111111111111111111111111111111111112`);
      const solData: any = await solPriceResponse.json();
      const solPrice = solData.data?.['So11111111111111111111111111111111111111112']?.price || 100;
      
      const priceInSol = priceUsd / solPrice;

      const marketData: MarketData = {
        token: tokenAddress,
        price: priceInSol,
        priceUsd,
        liquidityUsd: bestPair.liquidity?.usd || 0,
        volume24hUsd: bestPair.volume?.h24 || 0,
        priceChange24hPercent: bestPair.priceChange?.h24 || 0,
        timestamp: Date.now() / 1000,
      };

      logger.debug(`[MarketDataService] DexScreener: ${tokenAddress.slice(0, 8)} = $${priceUsd.toFixed(6)}, Liq: $${marketData.liquidityUsd.toFixed(0)}`);
      return marketData;
    } catch (error) {
      logger.debug(`[MarketDataService] DexScreener fetch failed for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Clear cache for a specific token
   */
  clearCache(tokenAddress?: string): void {
    if (tokenAddress) {
      this.cache.delete(tokenAddress);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Batch fetch prices for multiple tokens
   */
  async fetchBatchPrices(tokenAddresses: string[]): Promise<Map<string, MarketData>> {
    const results = new Map<string, MarketData>();

    // Fetch in parallel
    const promises = tokenAddresses.map(async (token) => {
      const data = await this.fetchMarketData(token);
      if (data) {
        results.set(token, data);
      }
    });

    await Promise.all(promises);
    return results;
  }
}

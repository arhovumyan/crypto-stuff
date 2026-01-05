import axios from 'axios';
import { logger } from './logger';

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  priceSol: number;
  marketCapUsd: number;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  volumeChange24h: number;
  priceChange24h: number;
  priceChange1h: number;
  holderCount?: number;
  poolAddress?: string;
  dexName: string;
  tokenAgeSeconds?: number;
}

export class DexScreenerService {
  private readonly baseUrl = 'https://api.dexscreener.com/latest';
  private requestCount = 0;
  private lastRequestTime = Date.now();
  private readonly RATE_LIMIT = 10; // 10 requests per second for free tier
  
  constructor() {
    logger.info('DexScreenerService initialized');
  }
  
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < 1000 && this.requestCount >= this.RATE_LIMIT) {
      const waitTime = 1000 - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
    }
    
    if (timeSinceLastRequest >= 1000) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    this.requestCount++;
  }
  
  /**
   * Get token data from DexScreener
   */
  async getTokenData(mintAddress: string): Promise<TokenInfo | null> {
    await this.rateLimit();
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/dex/tokens/${mintAddress}`,
        { timeout: 10000 }
      );
      
      const data = response.data;
      
      if (!data.pairs || data.pairs.length === 0) {
        logger.warn('No pairs found for token', { mintAddress });
        return null;
      }
      
      // Get the pair with highest liquidity
      const bestPair = data.pairs.reduce((best: any, current: any) => {
        const currentLiq = parseFloat(current.liquidity?.usd || '0');
        const bestLiq = parseFloat(best.liquidity?.usd || '0');
        return currentLiq > bestLiq ? current : best;
      });
      
      const tokenInfo: TokenInfo = {
        mint: mintAddress,
        symbol: bestPair.baseToken.symbol,
        name: bestPair.baseToken.name,
        decimals: 9, // Solana default, update if needed
        priceUsd: parseFloat(bestPair.priceUsd || '0'),
        priceSol: parseFloat(bestPair.priceNative || '0'),
        marketCapUsd: parseFloat(bestPair.marketCap || '0'),
        fdvUsd: parseFloat(bestPair.fdv || '0'),
        liquidityUsd: parseFloat(bestPair.liquidity?.usd || '0'),
        volume24hUsd: parseFloat(bestPair.volume?.h24 || '0'),
        volumeChange24h: parseFloat(bestPair.volume?.h24Change || '0'),
        priceChange24h: parseFloat(bestPair.priceChange?.h24 || '0'),
        priceChange1h: parseFloat(bestPair.priceChange?.h1 || '0'),
        poolAddress: bestPair.pairAddress,
        dexName: bestPair.dexId,
        tokenAgeSeconds: bestPair.pairCreatedAt 
          ? Math.floor((Date.now() - bestPair.pairCreatedAt) / 1000)
          : undefined
      };
      
      logger.debug('Fetched token data', { 
        mint: mintAddress,
        symbol: tokenInfo.symbol,
        priceUsd: tokenInfo.priceUsd
      });
      
      return tokenInfo;
    } catch (error: any) {
      logger.error('Error fetching token data from DexScreener', {
        mintAddress,
        error: error.message,
        status: error.response?.status
      });
      
      // Retry on rate limit or server error
      if (error.response?.status === 429) {
        logger.info('Rate limited, waiting 60s...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        return this.getTokenData(mintAddress);
      }
      
      return null;
    }
  }
  
  /**
   * Search for tokens by query
   */
  async searchTokens(query: string): Promise<any[]> {
    await this.rateLimit();
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/dex/search`,
        {
          params: { q: query },
          timeout: 10000
        }
      );
      
      return response.data.pairs || [];
    } catch (error: any) {
      logger.error('Error searching tokens', {
        query,
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Get token data with cache (to reduce API calls)
   */
  private cache = new Map<string, { data: TokenInfo; timestamp: number }>();
  private readonly CACHE_TTL = 60000; // 1 minute
  
  async getTokenDataCached(mintAddress: string): Promise<TokenInfo | null> {
    const cached = this.cache.get(mintAddress);
    
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      logger.debug('Using cached token data', { mintAddress });
      return cached.data;
    }
    
    const data = await this.getTokenData(mintAddress);
    
    if (data) {
      this.cache.set(mintAddress, {
        data,
        timestamp: Date.now()
      });
    }
    
    return data;
  }
  
  /**
   * Batch get multiple tokens (with delay to respect rate limits)
   */
  async getMultipleTokens(mintAddresses: string[]): Promise<Map<string, TokenInfo>> {
    const results = new Map<string, TokenInfo>();
    
    logger.info('Fetching multiple tokens', { count: mintAddresses.length });
    
    for (const mint of mintAddresses) {
      const data = await this.getTokenDataCached(mint);
      
      if (data) {
        results.set(mint, data);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    logger.info('Completed batch token fetch', { 
      requested: mintAddresses.length,
      found: results.size 
    });
    
    return results;
  }
}

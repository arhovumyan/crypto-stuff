/**
 * DexScreener API Client
 * Fetches market data for tokens
 */

import axios from 'axios';
import { config } from './config';
import { Logger } from './logger';

export interface TokenPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  priceChange: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap?: number;
  pairCreatedAt: number;
}

export interface TokenData {
  mint: string;
  name: string;
  symbol: string;
  marketCapUsd: number;
  liquidityUsd: number;
  priceUsd: number;
  priceNative: number;
  pairCreatedAt: Date;
  pairAddress: string;
  volumeH24: number;
  ageHours: number;
}

export class DexScreenerAPI {
  private cache: Map<string, { data: TokenData; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds

  /**
   * Fetch token data from DexScreener
   */
  async getTokenData(mint: string): Promise<TokenData | null> {
    // Check cache
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const url = `${config.dexScreenerApiUrl}/dex/tokens/${mint}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
      });

      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        return null;
      }

      // Find Solana pairs
      const solanaPairs = response.data.pairs.filter((p: TokenPair) => p.chainId === 'solana');
      if (solanaPairs.length === 0) {
        return null;
      }

      // Sort by liquidity descending
      solanaPairs.sort((a: TokenPair, b: TokenPair) => 
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );

      const pair = solanaPairs[0];

      // Calculate age - handle both milliseconds and seconds timestamps
      let pairCreatedAt: Date;
      if (pair.pairCreatedAt > 10000000000) {
        // Timestamp is in milliseconds
        pairCreatedAt = new Date(pair.pairCreatedAt);
      } else {
        // Timestamp is in seconds
        pairCreatedAt = new Date(pair.pairCreatedAt * 1000);
      }
      
      const ageHours = (Date.now() - pairCreatedAt.getTime()) / (1000 * 60 * 60);

      const tokenData: TokenData = {
        mint,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        marketCapUsd: pair.marketCap || pair.fdv || 0,
        liquidityUsd: pair.liquidity?.usd || 0,
        priceUsd: parseFloat(pair.priceUsd || '0'),
        priceNative: parseFloat(pair.priceNative || '0'),
        pairCreatedAt,
        pairAddress: pair.pairAddress,
        volumeH24: pair.volume?.h24 || 0,
        ageHours,
      };

      // Update cache
      this.cache.set(mint, { data: tokenData, timestamp: Date.now() });

      return tokenData;

    } catch (error: any) {
      if (error.response?.status !== 404) {
        Logger.debug(`DexScreener API error for ${mint}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Get latest tokens from DexScreener
   * This fetches the most recent pairs created on Solana
   */
  async getLatestTokens(): Promise<TokenData[]> {
    try {
      // DexScreener doesn't have a direct "latest tokens" endpoint
      // We'll use the search endpoint with Solana filter
      const url = `${config.dexScreenerApiUrl}/dex/search?q=solana`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
      });

      if (!response.data || !response.data.pairs) {
        return [];
      }

      const tokens: TokenData[] = [];
      const seenMints = new Set<string>();

      for (const pair of response.data.pairs) {
        if (pair.chainId !== 'solana') continue;
        
        const mint = pair.baseToken.address;
        if (seenMints.has(mint)) continue;
        seenMints.add(mint);

        // Calculate age - handle both milliseconds and seconds timestamps
        let pairCreatedAt: Date;
        if (pair.pairCreatedAt > 10000000000) {
          // Timestamp is in milliseconds
          pairCreatedAt = new Date(pair.pairCreatedAt);
        } else {
          // Timestamp is in seconds
          pairCreatedAt = new Date(pair.pairCreatedAt * 1000);
        }
        
        const ageHours = (Date.now() - pairCreatedAt.getTime()) / (1000 * 60 * 60);

        // Only include tokens within 24 hours
        if (ageHours > config.maxCoinAgeHours) continue;

        tokens.push({
          mint,
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol,
          marketCapUsd: pair.marketCap || pair.fdv || 0,
          liquidityUsd: pair.liquidity?.usd || 0,
          priceUsd: parseFloat(pair.priceUsd || '0'),
          priceNative: parseFloat(pair.priceNative || '0'),
          pairCreatedAt,
          pairAddress: pair.pairAddress,
          volumeH24: pair.volume?.h24 || 0,
          ageHours,
        });
      }

      return tokens;

    } catch (error: any) {
      Logger.error('Failed to fetch latest tokens', error);
      return [];
    }
  }

  /**
   * Get trending tokens on Solana
   */
  async getTrendingTokens(): Promise<string[]> {
    try {
      // Use the profiles endpoint to get trending tokens
      const url = `${config.dexScreenerApiUrl}/dex/tokens/trending/solana`;
      const response = await axios.get(url, {
        timeout: 10000,
      });

      if (!response.data || !response.data.pairs) {
        return [];
      }

      const mints: string[] = [];
      for (const pair of response.data.pairs) {
        if (pair.chainId === 'solana' && pair.baseToken?.address) {
          mints.push(pair.baseToken.address);
        }
      }

      return mints;

    } catch (error: any) {
      // Trending endpoint might not exist, ignore
      return [];
    }
  }
}

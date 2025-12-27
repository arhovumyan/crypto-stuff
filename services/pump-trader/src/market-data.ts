/**
 * DexScreener Market Data Fetcher
 * Fetches market cap, liquidity, and price data from DexScreener API
 */

import axios from 'axios';
import { config } from './config';
import { Logger } from './logger';

export interface DexScreenerPair {
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
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
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

export interface MarketData {
  mint: string;
  marketCapUsd: number;
  liquidityUsd: number;
  priceUsd: number;
  priceNative: number;
  volumeH24: number;
  pairCreatedAt: Date;
  pairAddress: string;
  lastUpdated: Date;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  mint: string;
}

export class DexScreenerFetcher {
  private cache: Map<string, MarketData> = new Map();
  private metadataCache: Map<string, TokenMetadata> = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds

  /**
   * Wait for DexScreener data to appear for a newly created token
   * Returns null if timeout expires
   */
  async waitForData(mint: string, maxWaitMs: number = config.dexscreenerWaitTimeoutMs): Promise<MarketData | null> {
    const startTime = Date.now();
    let lastLogTime = 0;

    while (Date.now() - startTime < maxWaitMs) {
      const data = await this.fetchMarketData(mint);
      
      if (data) {
        return data;
      }

      // Log every 10 seconds
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        Logger.waitingForDexScreener(mint, elapsed);
        lastLogTime = elapsed;
      }

      // Wait 5 seconds before next attempt
      await this.sleep(5000);
    }

    const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
    Logger.dexScreenerTimeout(mint, totalSeconds);
    return null;
  }

  /**
   * Fetch market data for a token mint from DexScreener
   */
  async fetchMarketData(mint: string): Promise<MarketData | null> {
    // Check cache first
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL_MS) {
      return cached;
    }

    try {
      const url = `${config.dexscreenerApiUrl}/dex/tokens/${mint}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        return null;
      }

      // Find the Solana pair with highest liquidity
      const solanaPairs = response.data.pairs.filter((p: DexScreenerPair) => p.chainId === 'solana');
      if (solanaPairs.length === 0) {
        return null;
      }

      // Sort by liquidity descending
      solanaPairs.sort((a: DexScreenerPair, b: DexScreenerPair) => 
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );

      const pair = solanaPairs[0];

      // Calculate market cap (prefer marketCap field, fallback to fdv)
      const marketCapUsd = pair.marketCap || pair.fdv || 0;

      const marketData: MarketData = {
        mint,
        marketCapUsd,
        liquidityUsd: pair.liquidity?.usd || 0,
        priceUsd: parseFloat(pair.priceUsd || '0'),
        priceNative: parseFloat(pair.priceNative || '0'),
        volumeH24: pair.volume?.h24 || 0,
        pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt * 1000) : new Date(),
        pairAddress: pair.pairAddress,
        lastUpdated: new Date(),
      };

      // Update cache
      this.cache.set(mint, marketData);

      return marketData;

    } catch (error: any) {
      if (error.code !== 'ECONNABORTED' && error.response?.status !== 404) {
        Logger.debug(`DexScreener fetch error for ${mint}`, {
          error: error.message,
          status: error.response?.status,
        });
      }
      return null;
    }
  }

  /**
   * Get cached data if available
   */
  getCached(mint: string): MarketData | null {
    const cached = this.cache.get(mint);
    if (!cached) return null;
    
    // Return cached data even if stale
    return cached;
  }

  /**
   * Get token metadata (name and symbol)
   */
  async getTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    // Check cache first
    const cached = this.metadataCache.get(mint);
    if (cached) return cached;

    try {
      // Try to get from DexScreener first
      const url = `${config.dexscreenerApiUrl}/dex/tokens/${mint}`;
      const response = await axios.get(url, {
        timeout: 5000,
        headers: { 'Accept': 'application/json' },
      });

      if (response.data?.pairs?.[0]) {
        const pair = response.data.pairs[0];
        const metadata: TokenMetadata = {
          name: pair.baseToken?.name || 'Unknown',
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          mint,
        };
        this.metadataCache.set(mint, metadata);
        return metadata;
      }

      // Fallback: use RPC to get on-chain metadata
      const rpcResponse = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [mint, { encoding: 'jsonParsed' }],
        },
        { timeout: 5000 }
      );

      if (rpcResponse.data?.result?.value?.data?.parsed?.info) {
        const info = rpcResponse.data.result.value.data.parsed.info;
        const metadata: TokenMetadata = {
          name: info.name || 'Unknown',
          symbol: info.symbol || 'UNKNOWN',
          mint,
        };
        this.metadataCache.set(mint, metadata);
        return metadata;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

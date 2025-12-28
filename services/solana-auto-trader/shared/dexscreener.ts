// DexScreener API client for fetching token data
import axios from 'axios';

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

export interface DexScreenerToken {
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
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  txns: {
    h24: {
      buys: number;
      sells: number;
    };
    h6: {
      buys: number;
      sells: number;
    };
    h1: {
      buys: number;
      sells: number;
    };
    m5: {
      buys: number;
      sells: number;
    };
  };
}

export class DexScreenerClient {
  static async getTokenInfo(tokenAddress: string): Promise<DexScreenerToken | null> {
    try {
      const response = await axios.get(`${DEXSCREENER_API}/tokens/${tokenAddress}`);
      
      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        return null;
      }

      // Find Solana pair
      const solanaPair = response.data.pairs.find((pair: any) => pair.chainId === 'solana');
      return solanaPair || response.data.pairs[0];
    } catch (error) {
      console.error(`Error fetching token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  static async searchNewTokens(limit: number = 50): Promise<DexScreenerToken[]> {
    try {
      // Get latest pairs on Solana from profiles endpoint
      const response = await axios.get('https://api.dexscreener.com/latest/dex/pairs/solana');
      
      if (!response.data || !response.data.pairs) {
        return [];
      }

      // Filter for Solana chain only and recently created
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);

      const recentTokens = response.data.pairs
        .filter((pair: DexScreenerToken) => 
          pair.chainId === 'solana' && 
          pair.pairCreatedAt && 
          pair.pairCreatedAt >= oneDayAgo / 1000
        )
        .slice(0, limit);

      return recentTokens;
    } catch (error) {
      console.error('Error searching for new tokens:', error);
      return [];
    }
  }

  static async getLatestTokens(): Promise<DexScreenerToken[]> {
    try {
      // Use the pairs endpoint with limit
      const response = await axios.get('https://api.dexscreener.com/latest/dex/pairs/solana');
      
      if (!response.data || !response.data.pairs) {
        return [];
      }

      // Sort by creation time and get most recent
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);

      return response.data.pairs
        .filter((pair: any) => 
          pair.chainId === 'solana' && 
          pair.pairCreatedAt && 
          pair.pairCreatedAt >= oneDayAgo / 1000
        )
        .sort((a: any, b: any) => b.pairCreatedAt - a.pairCreatedAt)
        .slice(0, 50);
    } catch (error) {
      console.error('Error getting latest tokens:', error);
      return [];
    }
  }
}

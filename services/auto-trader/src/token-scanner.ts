/**
 * Token Scanner
 * Continuously scans for new tokens from multiple sources
 */

import axios from 'axios';
import { Logger } from './logger';
import { config } from './config';

export interface NewTokenSource {
  mint: string;
  source: string;
}

export class TokenScanner {
  private seenTokens: Set<string> = new Set();
  private scanInterval: NodeJS.Timeout | null = null;

  /**
   * Start scanning for new tokens
   */
  start(onNewToken: (mint: string) => void): void {
    Logger.system('Starting token scanner...');

    // Scan immediately
    this.scan(onNewToken);

    // Then scan periodically
    this.scanInterval = setInterval(async () => {
      await this.scan(onNewToken);
    }, config.tokenCheckIntervalMs);
  }

  /**
   * Stop scanning
   */
  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  /**
   * Perform a scan for new tokens
   */
  private async scan(onNewToken: (mint: string) => void): Promise<void> {
    try {
      // Fetch from DexScreener API
      const tokens = await this.fetchFromDexScreener();

      for (const mint of tokens) {
        if (!this.seenTokens.has(mint)) {
          this.seenTokens.add(mint);
          onNewToken(mint);
        }
      }

    } catch (error: any) {
      Logger.debug(`Scan error: ${error.message}`);
    }
  }

  /**
   * Fetch new tokens from DexScreener
   */
  private async fetchFromDexScreener(): Promise<string[]> {
    try {
      // Use DexScreener's token profiles or search endpoint
      // We'll fetch tokens sorted by creation time
      
      const url = 'https://api.dexscreener.com/token-profiles/latest/v1';
      const response = await axios.get(url, {
        timeout: 10000,
      });

      const tokens: string[] = [];

      if (response.data && Array.isArray(response.data)) {
        for (const profile of response.data) {
          if (profile.chainId === 'solana' && profile.tokenAddress) {
            tokens.push(profile.tokenAddress);
          }
        }
      }

      // Also try the boosted tokens endpoint
      const boostUrl = 'https://api.dexscreener.com/token-boosts/top/v1';
      const boostResponse = await axios.get(boostUrl, {
        timeout: 10000,
      });

      if (boostResponse.data && Array.isArray(boostResponse.data)) {
        for (const boost of boostResponse.data) {
          if (boost.chainId === 'solana' && boost.tokenAddress) {
            tokens.push(boost.tokenAddress);
          }
        }
      }

      // Also scan latest pairs from search
      const searchUrl = `${config.dexScreenerApiUrl}/dex/search?q=solana`;
      const searchResponse = await axios.get(searchUrl, {
        timeout: 10000,
      });

      if (searchResponse.data && searchResponse.data.pairs) {
        for (const pair of searchResponse.data.pairs.slice(0, 50)) {
          if (pair.chainId === 'solana' && pair.baseToken?.address) {
            // Only include recent pairs (last 24 hours)
            if (pair.pairCreatedAt) {
              const ageHours = (Date.now() - pair.pairCreatedAt * 1000) / (1000 * 60 * 60);
              if (ageHours <= config.maxCoinAgeHours) {
                tokens.push(pair.baseToken.address);
              }
            }
          }
        }
      }

      return [...new Set(tokens)]; // Deduplicate

    } catch (error: any) {
      Logger.debug(`DexScreener fetch error: ${error.message}`);
      return [];
    }
  }

  /**
   * Get count of seen tokens
   */
  getSeenCount(): number {
    return this.seenTokens.size;
  }

  /**
   * Clear old seen tokens (for memory management)
   */
  clearOldSeenTokens(): void {
    // Keep only last 10,000 tokens
    if (this.seenTokens.size > 10000) {
      const tokensArray = Array.from(this.seenTokens);
      this.seenTokens = new Set(tokensArray.slice(-5000));
    }
  }
}

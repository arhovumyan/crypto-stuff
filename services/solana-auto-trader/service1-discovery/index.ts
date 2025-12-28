// Service 1: Token Discovery
// Continuously discovers new Solana tokens created in the last 24 hours
// and saves them to the database for validation

import { Database } from '../shared/database';
import { DexScreenerClient, DexScreenerToken } from '../shared/dexscreener';
import { PumpFunClient, PumpToken } from '../shared/pumpfun';
import { HeliusClient } from '../shared/helius';
import { Logger } from '../shared/logger';
import { Token } from '../shared/types';
import axios from 'axios';

const SERVICE_NAME = 'TOKEN-DISCOVERY';
const SCAN_INTERVAL_MS = 60000; // Scan every 1 minute
const MAX_TOKEN_AGE_HOURS = 24;

class TokenDiscoveryService {
  private running = false;
  private discoveredTokens = new Set<string>();

  async start() {
    Logger.info(SERVICE_NAME, 'Starting Token Discovery Service...');
    
    try {
      await Database.connect();
      Logger.success(SERVICE_NAME, 'Database connected');
      
      this.running = true;
      await this.discoveryLoop();
    } catch (error) {
      Logger.error(SERVICE_NAME, 'Failed to start service', error);
      process.exit(1);
    }
  }

  private async discoveryLoop() {
    while (this.running) {
      try {
        await this.discoverNewTokens();
        
        // Wait before next scan
        Logger.info(SERVICE_NAME, `Waiting ${SCAN_INTERVAL_MS / 1000}s before next scan...`);
        await this.sleep(SCAN_INTERVAL_MS);
      } catch (error) {
        Logger.error(SERVICE_NAME, 'Error in discovery loop', error);
        await this.sleep(5000); // Wait 5s on error
      }
    }
  }

  private async discoverNewTokens() {
    Logger.info(SERVICE_NAME, 'Scanning for new tokens...');

    try {Get new tokens from Pump.fun (primary source)
      const pumpTokens = await PumpFunClient.getLatestTokens(50);
      Logger.info(SERVICE_NAME, `Found ${pumpTokens.length} tokens from Pump.fun`);

      for (const tokenData of pumpTokens) {
        await this.processPump of tokens) {
        await this.processToken(tokenData);
      }

      Logger.success(SERVICE_NAME, `Scan complete. Discovered ${this.discoveredTokens.size} unique tokens so far.`);
    } catch (error) {
      Logger.error(SERVICE_NAME, 'Error discovering tokens', error);
    }
  }

  private async processPumpToken(tokenData: PumpToken) {
    try {
      const tokenAddress = tokenData.mint;
      
      // Skip if we've already discovered this token
      if (this.discoveredTokens.has(tokenAddress)) {
        return;
      }

      // Check if token already exists in database
      const existingToken = await Database.getToken(tokenAddress);
      if (existingToken) {
        this.discoveredTokens.add(tokenAddress);
        return;
      }

      // Calculate age - only save if less than 24 hours old
      const now = Date.now();
      const createdAt = tokenData.created_timestamp;
      const ageHours = (now - createdAt) / (1000 * 60 * 60);

      if (ageHours > MAX_TOKEN_AGE_HOURS) {
        return; // Too old, skip
      }

      Logger.info(SERVICE_NAME, `New token discovered: ${tokenAddress}`);

      // Get additional data from DexScreener for price/market data
      const dexData = await DexScreenerClient.getTokenInfo(tokenAddress);

      // Create token object
      const token: Token = {
        address: tokenAddress,
        mintTime: new Date(createdAt),
        discoveryTime: new Date(),
        
        // Market data
        marketCap: dexData?.marketCap || tokenData.usd_market_cap || 0,
        currentPrice: dexData ? parseFloat(dexData.priceUsd) : 0,
        liquidity: dexData?.liquidity?.usd,
        volume24h: dexData?.volume?.h24,
        
        // Metadata
        name: tokenData.name,
        symbol: tokenData.symbol,
        decimals: 9, // Pump.fun tokens are typically 9 decimals
        
        // Validation flags (to be checked by Service 2)
        meetsCriteria: false,
        validated: false,
        rejectionReasons: []
      };

      // Save to database
      await Database.saveToken(token);
      this.discoveredTokens.add(tokenAddress);

      Logger.success(SERVICE_NAME, `Saved new token: ${token.symbol} (${tokenAddress.substring(0, 8)}...)`);
      Logger.info(SERVICE_NAME, `  Name: ${token.name}`);
      Logger.info(SERVICE_NAME, `  Market Cap: $${token.marketCap?.toFixed(2) || 'N/A'}`);
      Logger.info(SERVICE_NAME, `  Age: ${ageHours.toFixed(1)} hours`);
      Logger.info(SERVICE_NAME, `  Created: ${token.mintTime.toLocaleString()}`);

    } catch (error) {
      Logger.error(SERVICE_NAME, `Error processing token ${tokenData.mint}`, error);
    }
  }

  private async searchDexScreener(): Promise<DexScreenerToken[]> {
    try {
      // DexScreener doesn't have a direct "get all new Solana pairs" endpoint
      // We'll use the token boosts/profiles to find active pairs
      // Alternative: Search for pump.fun tokens which are typically new
      const response = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1');
      
      if (!response.data || !response.data.length) {
        Logger.warn(SERVICE_NAME, 'No boost data returned from DexScreener, trying alternative...');
        
        // Try alternative approach: Get pump.fun program pairs
        const pumpResponse = await axios.get(
          'https://api.dexscreener.com/latest/dex/search?q=solana'
        );
        
        if (!pumpResponse.data || !pumpResponse.data.pairs) {
          return [];
        }
        
        return this.filterRecentTokens(pumpResponse.data.pairs);
      }

      // Get full pair data for boosted tokens
      const tokens: DexScreenerToken[] = [];
      for (const boost of response.data.slice(0, 20)) {
        if (boost.chainId === 'solana' && boost.tokenAddress) {
          const tokenInfo = await DexScreenerClient.getTokenInfo(boost.tokenAddress);
          if (tokenInfo) {
            tokens.push(tokenInfo);
          }
          await this.sleep(100); // Rate limit
        }
      }

      return this.filterRecentTokens(tokens);
    } catch (error: any) {
      Logger.error(SERVICE_NAME, `Error fetching from DexScreener: ${error.message}`);
      
      // Fallback: Try to get data from specific known pump.fun or raydium pairs
      try {
        Logger.info(SERVICE_NAME, 'Trying fallback method...');
        // For now, return empty array - in production you'd want a more robust fallback
        return [];
      } catch (fallbackError) {
        return [];
      }
    }
  }

  private filterRecentTokens(pairs: DexScreenerToken[]): DexScreenerToken[] {
    const now = Date.now();
    const maxAge = MAX_TOKEN_AGE_HOURS * 60 * 60 * 1000;

    const filtered = pairs.filter((pair: DexScreenerToken) => {
      if (!pair.pairCreatedAt) return false;
      
      const createdAt = pair.pairCreatedAt * 1000; // Convert to ms
      const age = now - createdAt;
      
      return age <= maxAge && age >= 0 && pair.chainId === 'solana';
    });

    Logger.info(SERVICE_NAME, `Filtered to ${filtered.length} tokens created in last ${MAX_TOKEN_AGE_HOURS}h`);
    return filtered;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    Logger.info(SERVICE_NAME, 'Stopping Token Discovery Service...');
    this.running = false;
    await Database.disconnect();
  }
}

// Start the service
const service = new TokenDiscoveryService();

process.on('SIGINT', async () => {
  await service.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await service.stop();
  process.exit(0);
});

service.start();

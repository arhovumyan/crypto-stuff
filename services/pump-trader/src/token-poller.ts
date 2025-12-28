/**
 * Token Poller
 * Actively polls for new tokens from multiple sources
 * Ensures we catch ALL new token launches
 */

import axios from 'axios';
import { Logger } from './logger';
import { config } from './config';

export interface NewToken {
  mint: string;
  name: string;
  symbol: string;
  source: string;
  pairCreatedAt: Date;
  pairAddress?: string;
  marketCap?: number;
  liquidity?: number;
}

export class TokenPoller {
  private seenTokens: Set<string> = new Set();
  private isRunning: boolean = false;
  private pollInterval: number = 5000; // Poll every 5 seconds

  /**
   * Start polling for new tokens
   */
  async start(onNewToken: (token: NewToken) => void): Promise<void> {
    this.isRunning = true;
    
    console.log('🔄 Starting token poller - checking for new tokens every 5 seconds...\n');
    
    // Poll immediately
    await this.pollForNewTokens(onNewToken);
    
    // Then poll every 5 seconds
    const intervalId = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(intervalId);
        return;
      }
      
      await this.pollForNewTokens(onNewToken);
    }, this.pollInterval);
  }

  /**
   * Poll all sources for new tokens
   */
  private async pollForNewTokens(onNewToken: (token: NewToken) => void): Promise<void> {
    try {
      // Poll DexScreener for new Solana tokens
      await this.pollDexScreener(onNewToken);
      
      // Poll Pump.fun token list
      await this.pollPumpFunTokens(onNewToken);
      
    } catch (error: any) {
      Logger.debug('Error polling for tokens', { error: error.message });
    }
  }

  /**
   * Poll DexScreener for newly created Solana pairs
   */
  private async pollDexScreener(onNewToken: (token: NewToken) => void): Promise<void> {
    try {
      // Get latest tokens on Solana sorted by pair creation time
      const url = 'https://api.dexscreener.com/latest/dex/tokens/solana';
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
      });

      if (!response.data?.pairs) return;

      const pairs = response.data.pairs;
      
      // Sort by pair created time (newest first)
      const sortedPairs = pairs.sort((a: any, b: any) => {
        const timeA = a.pairCreatedAt || 0;
        const timeB = b.pairCreatedAt || 0;
        return timeB - timeA;
      });

      // Check the newest 50 pairs
      for (const pair of sortedPairs.slice(0, 50)) {
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        
        // Skip if we've already seen this token
        if (this.seenTokens.has(mint)) continue;
        
        // Check if this is a new token (created in last 2 hours)
        const pairCreatedAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt * 1000) : null;
        if (!pairCreatedAt) continue;
        
        const ageMinutes = (Date.now() - pairCreatedAt.getTime()) / 60000;
        if (ageMinutes > 120) continue; // Skip if older than 2 hours
        
        this.seenTokens.add(mint);
        
        const token: NewToken = {
          mint,
          name: pair.baseToken?.name || 'Unknown',
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          source: 'DexScreener',
          pairCreatedAt,
          pairAddress: pair.pairAddress,
          marketCap: pair.marketCap || pair.fdv,
          liquidity: pair.liquidity?.usd,
        };
        
        onNewToken(token);
      }
      
    } catch (error: any) {
      if (error.code !== 'ECONNABORTED') {
        Logger.debug('DexScreener poll error', { error: error.message });
      }
    }
  }

  /**
   * Poll Pump.fun for newly created tokens
   */
  private async pollPumpFunTokens(onNewToken: (token: NewToken) => void): Promise<void> {
    try {
      // Pump.fun doesn't have a public API, but we can try to get recent tokens
      // by checking recent Solana transactions for the Pump.fun program
      
      // Get recent signatures for Pump.fun program
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            config.pumpfunProgramId,
            {
              limit: 20,
            },
          ],
        },
        { timeout: 10000 }
      );

      if (!response.data?.result) return;

      const signatures = response.data.result;
      
      // For each recent signature, try to extract token info
      for (const sig of signatures) {
        if (!sig.signature) continue;
        
        // Get the full transaction
        await this.extractTokenFromTransaction(sig.signature, onNewToken);
      }
      
    } catch (error: any) {
      Logger.debug('Pump.fun poll error', { error: error.message });
    }
  }

  /**
   * Extract token information from a transaction
   */
  private async extractTokenFromTransaction(
    signature: string,
    onNewToken: (token: NewToken) => void
  ): Promise<void> {
    try {
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        },
        { timeout: 5000 }
      );

      if (!response.data?.result) return;

      const tx = response.data.result;
      const accountKeys = tx.transaction?.message?.accountKeys || [];

      // Look for new token mints in the transaction
      const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      
      for (const account of accountKeys) {
        const pubkey = typeof account === 'string' ? account : account.pubkey;
        
        // Skip if not a valid address or already seen
        if (!pubkey || pubkey.length < 32 || this.seenTokens.has(pubkey)) continue;
        
        // Skip if it's a known program
        if (pubkey === config.pumpfunProgramId || pubkey === tokenProgram) continue;
        
        // This could be a new token mint
        // Try to get metadata from DexScreener
        try {
          const dexResponse = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${pubkey}`,
            { timeout: 3000 }
          );
          
          if (dexResponse.data?.pairs?.[0]) {
            const pair = dexResponse.data.pairs[0];
            
            this.seenTokens.add(pubkey);
            
            const token: NewToken = {
              mint: pubkey,
              name: pair.baseToken?.name || 'Unknown',
              symbol: pair.baseToken?.symbol || 'UNKNOWN',
              source: 'Pump.fun Transaction',
              pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt * 1000) : new Date(),
              pairAddress: pair.pairAddress,
              marketCap: pair.marketCap || pair.fdv,
              liquidity: pair.liquidity?.usd,
            };
            
            onNewToken(token);
            break; // Only process one token per transaction
          }
        } catch (e) {
          // Skip if can't get metadata
        }
      }
      
    } catch (error: any) {
      // Silently fail for individual transactions
    }
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Get statistics
   */
  getStats(): { totalSeen: number } {
    return {
      totalSeen: this.seenTokens.size,
    };
  }
}

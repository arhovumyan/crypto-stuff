/**
 * Pump.fun Token Launch Monitor
 * Monitors new token launches on Pump.fun in real-time
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import axios from 'axios';

const log = createLogger('pump-monitor');

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
const POLLING_INTERVAL = 2000; // 2 seconds

export interface NewToken {
  address: string;
  name?: string;
  symbol?: string;
  deployer: string;
  launchTime: Date;
  initialLiquidity?: number;
  bondingCurve?: string;
}

export interface TokenActivity {
  address: string;
  uniqueBuyers: Set<string>;
  totalBuys: number;
  totalVolume: number;
  priceUSD: number;
  marketCapUSD: number;
  liquidityUSD: number;
  firstBuyTime: Date;
  lastUpdate: Date;
}

export class PumpMonitor {
  private connection: Connection;
  private monitoredTokens: Map<string, TokenActivity> = new Map();
  private isRunning = false;
  private lastProcessedSlot = 0;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Start monitoring for new token launches
   */
  async start(): Promise<void> {
    log.info('🚀 Starting Pump.fun token monitor...');
    this.isRunning = true;

    // Get current slot
    this.lastProcessedSlot = await this.connection.getSlot();
    log.info(`✅ Starting from slot: ${this.lastProcessedSlot}`);

    // Start monitoring loop
    this.monitorLoop();
  }

  /**
   * Main monitoring loop
   */
  private async monitorLoop(): Promise<void> {
    let loopCount = 0;
    while (this.isRunning) {
      try {
        await this.checkForNewTokens();
        await this.updateTokenActivity();
        
        // Heartbeat every 10 loops (20 seconds)
        loopCount++;
        if (loopCount % 10 === 0) {
          log.info(`💓 Monitoring active | Tracked tokens: ${this.monitoredTokens.size} | Slot: ${this.lastProcessedSlot}`);
        }
        
        await this.sleep(POLLING_INTERVAL);
      } catch (error) {
        log.error(`❌ Error in monitor loop | ${error instanceof Error ? error.message : String(error)}`);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Check for new token launches
   */
  private async checkForNewTokens(): Promise<void> {
    try {
      // Get recent signatures for Pump.fun program
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(PUMP_FUN_PROGRAM),
        { limit: 20 }
      );

      if (signatures.length > 0) {
        log.info(`🔍 Scanning ${signatures.length} transactions on Pump.fun program...`);
      }

      for (const sig of signatures) {
        if (sig.slot <= this.lastProcessedSlot) continue;

        const tx = await this.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || tx.meta?.err) continue;

        // Look for token creation patterns
        const newToken = await this.extractNewToken(tx);
        if (newToken) {
          this.onNewTokenDetected(newToken);
        }

        this.lastProcessedSlot = Math.max(this.lastProcessedSlot, sig.slot);
      }
    } catch (error) {
      log.error(`Failed to check for new tokens | ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract new token from transaction
   */
  private async extractNewToken(tx: any): Promise<NewToken | null> {
    // This is a simplified version - you'll need to parse actual Pump.fun program logs
    // to identify token creation events
    const accounts = tx.transaction.message.accountKeys;
    
    // Look for new token mint creation
    for (const account of accounts) {
      if (account.signer && !this.monitoredTokens.has(account.pubkey.toString())) {
        // Check if this is actually a new token on Pump.fun
        const tokenInfo = await this.verifyPumpToken(account.pubkey.toString());
        if (tokenInfo) {
          return tokenInfo;
        }
      }
    }

    return null;
  }

  /**
   * Verify if address is a Pump.fun token
   */
  private async verifyPumpToken(address: string): Promise<NewToken | null> {
    try {
      // Check DexScreener for Pump.fun pairs
      const response = await axios.get(`${DEXSCREENER_API}/tokens/${address}`, {
        timeout: 5000,
      });

      const pairs = response.data?.pairs || [];
      const pumpPair = pairs.find((p: any) => 
        p.dexId === 'raydium' && p.labels?.includes('pump.fun')
      );

      if (pumpPair) {
        return {
          address,
          name: pumpPair.baseToken?.name,
          symbol: pumpPair.baseToken?.symbol,
          deployer: pumpPair.pairCreatedAt ? 'unknown' : 'unknown',
          launchTime: new Date(),
          initialLiquidity: parseFloat(pumpPair.liquidity?.usd || '0'),
        };
      }
    } catch (error) {
      // Token might be too new for DexScreener
    }

    return null;
  }

  /**
   * Handle new token detection
   */
  private onNewTokenDetected(token: NewToken): void {
    log.info('');
    log.info('────────────────────────────────────────────────────────────────────────────────');
    log.info('═══════════════════════════════════════════════════');
    log.info('🆕 NEW TOKEN DETECTED');
    log.info('═══════════════════════════════════════════════════');
    log.info(`Address:    ${token.address}`);
    log.info(`Symbol:     ${token.symbol || 'Unknown'}`);
    log.info(`Name:       ${token.name || 'Unknown'}`);
    log.info(`Liquidity:  $${token.initialLiquidity?.toFixed(2) || '0.00'}`);
    log.info('═══════════════════════════════════════════════════');
    log.info('────────────────────────────────────────────────────────────────────────────────');
    log.info('');

    // Initialize activity tracking
    this.monitoredTokens.set(token.address, {
      address: token.address,
      uniqueBuyers: new Set(),
      totalBuys: 0,
      totalVolume: 0,
      priceUSD: 0,
      marketCapUSD: 0,
      liquidityUSD: token.initialLiquidity || 0,
      firstBuyTime: new Date(),
      lastUpdate: new Date(),
    });
  }

  /**
   * Update activity for all monitored tokens
   */
  private async updateTokenActivity(): Promise<void> {
    if (this.monitoredTokens.size === 0) return;
    const tokensToCheck = Array.from(this.monitoredTokens.keys());
    
    for (const tokenAddress of tokensToCheck) {
      const activity = this.monitoredTokens.get(tokenAddress);
      if (!activity) continue;

      // Remove tokens older than 5 minutes
      const age = Date.now() - activity.firstBuyTime.getTime();
      if (age > 5 * 60 * 1000) {
        this.monitoredTokens.delete(tokenAddress);
        continue;
      }

      try {
        await this.updateSingleTokenActivity(tokenAddress, activity);
      } catch (error) {
        log.error(`Failed to update activity for ${tokenAddress.slice(0, 8)}...`);
      }
    }
  }

  /**
   * Update activity for a single token
   */
  private async updateSingleTokenActivity(
    tokenAddress: string,
    activity: TokenActivity
  ): Promise<void> {
    try {
      // Fetch recent transactions for this token
      const response = await axios.get(`${DEXSCREENER_API}/tokens/${tokenAddress}`, {
        timeout: 5000,
      });

      const pairs = response.data?.pairs || [];
      if (pairs.length === 0) return;

      const pair = pairs[0];
      
      // Update metrics
      activity.priceUSD = parseFloat(pair.priceUsd || '0');
      activity.marketCapUSD = parseFloat(pair.fdv || '0');
      activity.liquidityUSD = parseFloat(pair.liquidity?.usd || '0');
      activity.totalVolume = parseFloat(pair.volume?.h1 || '0');
      activity.lastUpdate = new Date();

      // Fetch recent transactions to count unique buyers
      const txns = pair.txns?.m5 || {};
      activity.totalBuys = txns.buys || 0;
      
      // Note: Unique buyers requires parsing actual blockchain transactions
      // This is simplified - you'll need to fetch and parse actual txs
    } catch (error) {
      // Silent fail for API errors
    }
  }

  /**
   * Get token activity for analysis
   */
  getTokenActivity(address: string): TokenActivity | undefined {
    return this.monitoredTokens.get(address);
  }

  /**
   * Get all monitored tokens
   */
  getAllMonitoredTokens(): Map<string, TokenActivity> {
    return this.monitoredTokens;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    log.info('🛑 Stopping Pump.fun monitor...');
    this.isRunning = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

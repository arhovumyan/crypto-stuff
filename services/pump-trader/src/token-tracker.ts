/**
 * Token Tracker
 * Tracks tokens through their lifecycle and evaluates trading criteria
 */

import { config } from './config';
import { Logger } from './logger';
import { DexScreenerFetcher, MarketData } from './market-data';
import { HolderAnalyzer, ConcentrationAnalysis } from './holder-analyzer';

export enum TokenState {
  DISCOVERED = 'DISCOVERED',
  WAITING_FOR_DEXSCREENER = 'WAITING_FOR_DEXSCREENER',
  TRACKING_FOR_ATH = 'TRACKING_FOR_ATH',
  WAITING_FOR_DRAWDOWN = 'WAITING_FOR_DRAWDOWN',
  READY_TO_BUY = 'READY_TO_BUY',
  BOUGHT = 'BOUGHT',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface TrackedToken {
  mint: string;
  discoveredAt: Date;
  state: TokenState;
  
  // Market data
  marketData?: MarketData;
  ath?: number;
  athReachedAt?: Date;
  
  // Holder analysis
  holderAnalysis?: ConcentrationAnalysis;
  
  // Rejection reason
  rejectionReason?: string;
}

export class TokenTracker {
  private tokens: Map<string, TrackedToken> = new Map();
  private dexScreener: DexScreenerFetcher;
  private holderAnalyzer: HolderAnalyzer;
  private totalTokensDetected: number = 0;

  constructor() {
    this.dexScreener = new DexScreenerFetcher();
    this.holderAnalyzer = new HolderAnalyzer();
    
    // Log total count every 60 seconds
    setInterval(() => {
      if (this.totalTokensDetected > 0) {
        Logger.allNewTokens(this.totalTokensDetected);
      }
    }, 60000);
  }

  /**
   * Add a newly discovered token for tracking
   */
  async discoverToken(mint: string, signature: string): Promise<void> {
    // Check if already tracking
    if (this.tokens.has(mint)) {
      return;
    }

    this.totalTokensDetected++;

    // Fetch metadata immediately (async, don't wait)
    this.dexScreener.getTokenMetadata(mint).then(metadata => {
      if (metadata) {
        Logger.newTokenDetected(mint, signature, metadata);
      } else {
        Logger.newTokenDetected(mint, signature);
      }
    }).catch(() => {
      Logger.newTokenDetected(mint, signature);
    });

    // Log without metadata first
    Logger.newTokenDetected(mint, signature);

    const token: TrackedToken = {
      mint,
      discoveredAt: new Date(),
      state: TokenState.DISCOVERED,
    };

    this.tokens.set(mint, token);

    // Start evaluation process
    await this.evaluateToken(mint);
  }

  /**
   * Evaluate a token through all criteria
   */
  private async evaluateToken(mint: string): Promise<void> {
    const token = this.tokens.get(mint);
    if (!token) return;

    try {
      // 1. Check age
      const ageMinutes = (Date.now() - token.discoveredAt.getTime()) / 60000;
      if (ageMinutes > config.tokenLifetimeMinutes) {
        this.rejectToken(mint, `Token too old (${ageMinutes.toFixed(1)} minutes)`);
        Logger.tokenTooOld(mint, ageMinutes, config.tokenLifetimeMinutes);
        return;
      }

      // 2. Wait for DexScreener data
      if (!token.marketData) {
        token.state = TokenState.WAITING_FOR_DEXSCREENER;
        const marketData = await this.dexScreener.waitForData(mint, 60000); // Wait up to 60 seconds
        
        if (!marketData) {
          this.rejectToken(mint, 'DexScreener data never appeared');
          return;
        }

        token.marketData = marketData;
      }

      // 3. Check market cap
      if (token.marketData.marketCapUsd < config.minMarketCapUsd) {
        this.rejectToken(mint, `Market cap too low: $${token.marketData.marketCapUsd.toFixed(2)}`);
        Logger.marketCapTooLow(mint, token.marketData.marketCapUsd, config.minMarketCapUsd);
        return;
      }

      // 4. Check liquidity
      if (token.marketData.liquidityUsd < 1000) {
        this.rejectToken(mint, `Liquidity too low: $${token.marketData.liquidityUsd.toFixed(2)}`);
        Logger.liquidityTooLow(mint, token.marketData.liquidityUsd);
        return;
      }

      // 5. Check holder concentration
      if (!token.holderAnalysis) {
        const analysis = await this.holderAnalyzer.analyzeConcentration(mint);
        
        if (!analysis) {
          this.rejectToken(mint, 'Could not analyze holder concentration');
          return;
        }

        token.holderAnalysis = analysis;

        if (!analysis.passesCheck) {
          this.rejectToken(mint, `Holder concentration too high: ${analysis.topHolderPercent.toFixed(2)}%`);
          Logger.holderConcentrationFailed(
            mint,
            analysis.topHolderPercent,
            config.maxHolderConcentrationPercent,
            analysis.topHolderAddress
          );
          return;
        }
      }

      // 6. Track for ATH and drawdown
      token.state = TokenState.TRACKING_FOR_ATH;
      Logger.trackingForATH(mint, token.marketData.marketCapUsd);

      // Start monitoring loop
      this.monitorForATHAndDrawdown(mint);

    } catch (error: any) {
      Logger.error(`Error evaluating token ${mint}`, error);
      this.rejectToken(mint, `Evaluation error: ${error.message}`);
    }
  }

  /**
   * Monitor token for ATH and subsequent drawdown
   */
  private async monitorForATHAndDrawdown(mint: string): Promise<void> {
    const token = this.tokens.get(mint);
    if (!token) return;

    const checkInterval = setInterval(async () => {
      const token = this.tokens.get(mint);
      if (!token || token.state === TokenState.REJECTED || token.state === TokenState.EXPIRED) {
        clearInterval(checkInterval);
        return;
      }

      // Check if token is too old
      const ageMinutes = (Date.now() - token.discoveredAt.getTime()) / 60000;
      if (ageMinutes > config.tokenLifetimeMinutes) {
        clearInterval(checkInterval);
        this.rejectToken(mint, `Expired: never met criteria within ${config.tokenLifetimeMinutes} minutes`);
        return;
      }

      // Fetch latest market data
      const marketData = await this.dexScreener.fetchMarketData(mint);
      if (!marketData) {
        return; // Try again next interval
      }

      token.marketData = marketData;

      // Update ATH
      if (!token.ath || marketData.marketCapUsd > token.ath) {
        const previousATH = token.ath || 0;
        token.ath = marketData.marketCapUsd;
        token.athReachedAt = new Date();
        
        if (previousATH > 0) {
          Logger.newATH(mint, token.ath, previousATH);
        }
      }

      // Check for drawdown
      if (token.ath && token.athReachedAt) {
        const drawdownPercent = ((token.ath - marketData.marketCapUsd) / token.ath) * 100;
        
        if (drawdownPercent >= config.requiredDrawdownPercent) {
          // Check if drawdown happened within the ATH window
          const minutesSinceATH = (Date.now() - token.athReachedAt.getTime()) / 60000;
          
          if (minutesSinceATH <= config.athWindowMinutes) {
            clearInterval(checkInterval);
            
            Logger.drawdownDetected(mint, token.ath, marketData.marketCapUsd, drawdownPercent);
            
            // All criteria passed!
            token.state = TokenState.READY_TO_BUY;
            Logger.allCriteriaPass(
              mint,
              marketData.marketCapUsd,
              drawdownPercent,
              token.holderAnalysis?.topHolderPercent || 0
            );
            
            // Emit event for buying
            this.emitReadyToBuy(token);
          } else {
            clearInterval(checkInterval);
            this.rejectToken(mint, `Drawdown occurred ${minutesSinceATH.toFixed(1)} minutes after ATH (max ${config.athWindowMinutes})`);
          }
        } else if (drawdownPercent > 0) {
          Logger.drawdownDetected(mint, token.ath, marketData.marketCapUsd, drawdownPercent);
        }
      }

    }, 5000); // Check every 5 seconds
  }

  private rejectToken(mint: string, reason: string): void {
    const token = this.tokens.get(mint);
    if (!token) return;

    token.state = TokenState.REJECTED;
    token.rejectionReason = reason;
  }

  private emitReadyToBuy(token: TrackedToken): void {
    // This will be called by the main orchestrator
    // For now, we'll use a callback pattern
    if (this.onReadyToBuy) {
      this.onReadyToBuy(token);
    }
  }

  // Callback for when a token is ready to buy
  onReadyToBuy?: (token: TrackedToken) => void;

  getToken(mint: string): TrackedToken | undefined {
    return this.tokens.get(mint);
  }

  getAllTokens(): TrackedToken[] {
    return Array.from(this.tokens.values());
  }
}

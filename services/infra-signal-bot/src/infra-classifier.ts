/**
 * Infra Classifier
 * Classifies infrastructure wallet behavior types based on trading patterns
 */

import pg from 'pg';
import { createLogger } from './logger.js';
import { 
  RawTrade, 
  InfraWallet, 
  InfraBehaviorType, 
  WalletClassification,
  InfraSignalConfig 
} from './types.js';
import { TradeFeed } from './trade-feed.js';

const log = createLogger('infra-classifier');
const { Pool } = pg;

interface WalletTradeHistory {
  trades: RawTrade[];
  buyCount: number;
  sellCount: number;
  totalBuySOL: number;
  totalSellSOL: number;
  defenseEvents: number;
  lastTradeTime: number;
  firstTradeTime: number;
  avgTimeBetweenTrades: number;
  responseTimes: number[]; // Time from sell to their buy
}

export class InfraClassifier {
  private tradeFeed: TradeFeed;
  private config: InfraSignalConfig;
  private db: pg.Pool;

  // Track wallet trading history
  private walletHistory: Map<string, WalletTradeHistory> = new Map();
  private classificationCache: Map<string, WalletClassification> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(tradeFeed: TradeFeed, config: InfraSignalConfig, dbConnectionString: string) {
    this.tradeFeed = tradeFeed;
    this.config = config;
    this.db = new Pool({ connectionString: dbConnectionString });
  }

  /**
   * Start the classifier
   */
  start(): void {
    log.info('Starting infra classifier...');

    // Track all trades for pattern analysis
    this.tradeFeed.on('trade', (trade: RawTrade) => {
      this.recordTrade(trade);
    });

    // Periodically update classifications
    this.updateInterval = setInterval(() => {
      this.updateClassifications();
    }, 60000); // Every minute
  }

  /**
   * Record a trade for wallet history
   */
  private recordTrade(trade: RawTrade): void {
    const history = this.walletHistory.get(trade.traderWallet) || {
      trades: [],
      buyCount: 0,
      sellCount: 0,
      totalBuySOL: 0,
      totalSellSOL: 0,
      defenseEvents: 0,
      lastTradeTime: 0,
      firstTradeTime: Date.now(),
      avgTimeBetweenTrades: 0,
      responseTimes: [],
    };

    // Update trade timing
    if (history.lastTradeTime > 0) {
      const timeDiff = Date.now() - history.lastTradeTime;
      history.avgTimeBetweenTrades = 
        (history.avgTimeBetweenTrades * history.trades.length + timeDiff) / 
        (history.trades.length + 1);
    }

    // Add trade
    history.trades.push(trade);
    history.lastTradeTime = Date.now();

    // Update counts
    if (trade.type === 'buy') {
      history.buyCount++;
      history.totalBuySOL += trade.amountSOL;
    } else {
      history.sellCount++;
      history.totalSellSOL += trade.amountSOL;
    }

    // Keep only last 100 trades
    if (history.trades.length > 100) {
      history.trades = history.trades.slice(-100);
    }

    this.walletHistory.set(trade.traderWallet, history);

    // Invalidate cached classification
    this.classificationCache.delete(trade.traderWallet);
  }

  /**
   * Classify a wallet's behavior
   */
  classify(walletAddress: string): WalletClassification {
    // Check cache first
    const cached = this.classificationCache.get(walletAddress);
    if (cached) return cached;

    const history = this.walletHistory.get(walletAddress);
    
    if (!history || history.trades.length < 5) {
      return {
        wallet: walletAddress,
        behaviorType: 'unknown',
        confidence: 0,
        reasons: ['Insufficient trade history'],
        metrics: {
          tradeCount: history?.trades.length || 0,
          buyRatio: 0,
          avgTradeSize: 0,
          avgResponseTime: 0,
          defensiveScore: 0,
        },
      };
    }

    // Calculate metrics
    const totalTrades = history.buyCount + history.sellCount;
    const buyRatio = history.buyCount / totalTrades;
    const avgTradeSize = (history.totalBuySOL + history.totalSellSOL) / totalTrades;
    const avgResponseTime = history.responseTimes.length > 0
      ? history.responseTimes.reduce((a, b) => a + b, 0) / history.responseTimes.length
      : 0;

    // Calculate trading frequency (trades per hour)
    const tradingPeriodMs = history.lastTradeTime - history.firstTradeTime;
    const tradingPeriodHours = tradingPeriodMs / (1000 * 60 * 60);
    const tradesPerHour = tradingPeriodHours > 0 ? totalTrades / tradingPeriodHours : 0;

    // Calculate defensive score
    const defensiveScore = this.calculateDefensiveScore(history);

    // Classify based on patterns
    const classification = this.determineClassification(
      history,
      buyRatio,
      avgTradeSize,
      avgResponseTime,
      tradesPerHour,
      defensiveScore
    );

    // Cache the result
    this.classificationCache.set(walletAddress, classification);

    return classification;
  }

  /**
   * Calculate defensive behavior score
   */
  private calculateDefensiveScore(history: WalletTradeHistory): number {
    let score = 0;

    // High buy ratio indicates defensive behavior
    const buyRatio = history.buyCount / (history.buyCount + history.sellCount);
    if (buyRatio > 0.7) score += 30;
    else if (buyRatio > 0.5) score += 15;

    // Quick response times indicate defensive behavior
    const avgResponse = history.responseTimes.length > 0
      ? history.responseTimes.reduce((a, b) => a + b, 0) / history.responseTimes.length
      : Infinity;
    if (avgResponse < 5000) score += 30; // < 5 seconds
    else if (avgResponse < 15000) score += 20; // < 15 seconds
    else if (avgResponse < 30000) score += 10; // < 30 seconds

    // Consistent trade sizes indicate market making
    const tradeSizes = history.trades.map(t => t.amountSOL);
    const avgSize = tradeSizes.reduce((a, b) => a + b, 0) / tradeSizes.length;
    const variance = tradeSizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) / tradeSizes.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgSize > 0 ? stdDev / avgSize : 1;
    
    if (coefficientOfVariation < 0.3) score += 20; // Very consistent
    else if (coefficientOfVariation < 0.5) score += 10; // Somewhat consistent

    // Defense events directly add to score
    score += Math.min(history.defenseEvents * 5, 20);

    return Math.min(score, 100);
  }

  /**
   * Determine classification based on metrics
   */
  private determineClassification(
    history: WalletTradeHistory,
    buyRatio: number,
    avgTradeSize: number,
    avgResponseTime: number,
    tradesPerHour: number,
    defensiveScore: number
  ): WalletClassification {
    const reasons: string[] = [];
    let behaviorType: InfraBehaviorType = 'unknown';
    let confidence = 0;

    // Defensive: High buy ratio, quick responses, defends levels
    if (defensiveScore >= 60 && buyRatio > 0.6) {
      behaviorType = 'defensive';
      confidence = Math.min(defensiveScore, 90);
      reasons.push(`High defensive score (${defensiveScore})`);
      reasons.push(`Buy ratio: ${(buyRatio * 100).toFixed(1)}%`);
      if (avgResponseTime < 10000) {
        reasons.push(`Fast response time: ${(avgResponseTime / 1000).toFixed(1)}s`);
      }
    }
    // Aggressive: High frequency, large trades, mixed buy/sell
    else if (tradesPerHour > 10 && avgTradeSize > 1) {
      behaviorType = 'aggressive';
      confidence = Math.min(50 + tradesPerHour * 2, 85);
      reasons.push(`High frequency: ${tradesPerHour.toFixed(1)} trades/hour`);
      reasons.push(`Large avg trade: ${avgTradeSize.toFixed(2)} SOL`);
    }
    // Cyclical: Regular patterns, balanced buy/sell
    else if (Math.abs(buyRatio - 0.5) < 0.15 && history.avgTimeBetweenTrades > 0) {
      const avgTimeMinutes = history.avgTimeBetweenTrades / 60000;
      if (avgTimeMinutes >= 5 && avgTimeMinutes <= 60) {
        behaviorType = 'cyclical';
        confidence = 60;
        reasons.push(`Balanced buy/sell ratio: ${(buyRatio * 100).toFixed(1)}%`);
        reasons.push(`Regular trading interval: ~${avgTimeMinutes.toFixed(0)} min`);
      }
    }
    // Passive: Low frequency, small trades
    else if (tradesPerHour < 2 && avgTradeSize < 0.5) {
      behaviorType = 'passive';
      confidence = 50;
      reasons.push(`Low frequency: ${tradesPerHour.toFixed(1)} trades/hour`);
      reasons.push(`Small avg trade: ${avgTradeSize.toFixed(2)} SOL`);
    }

    // Unknown if no pattern matches
    if (behaviorType === 'unknown') {
      confidence = 20;
      reasons.push('No clear pattern identified');
    }

    return {
      wallet: history.trades[0]?.traderWallet || 'unknown',
      behaviorType,
      confidence,
      reasons,
      metrics: {
        tradeCount: history.trades.length,
        buyRatio,
        avgTradeSize,
        avgResponseTime,
        defensiveScore,
      },
    };
  }

  /**
   * Record that a wallet defended a price level
   */
  recordDefenseEvent(walletAddress: string, responseTimeMs: number): void {
    const history = this.walletHistory.get(walletAddress);
    if (history) {
      history.defenseEvents++;
      history.responseTimes.push(responseTimeMs);
      
      // Keep only last 20 response times
      if (history.responseTimes.length > 20) {
        history.responseTimes = history.responseTimes.slice(-20);
      }

      // Invalidate cache
      this.classificationCache.delete(walletAddress);
    }
  }

  /**
   * Update classifications and persist to database
   */
  private async updateClassifications(): Promise<void> {
    for (const [walletAddress, history] of this.walletHistory) {
      if (history.trades.length < 10) continue;

      const classification = this.classify(walletAddress);
      
      if (classification.confidence >= 50) {
        log.info('🎯 WALLET CLASSIFIED', {
          wallet: walletAddress.slice(0, 8) + '...',
          behaviorType: classification.behaviorType.toUpperCase(),
          confidence: classification.confidence + '%',
          reasons: classification.reasons.join(', '),
          metrics: {
            trades: classification.metrics.tradeCount,
            buyRatio: (classification.metrics.buyRatio * 100).toFixed(1) + '%',
            avgTradeSize: classification.metrics.avgTradeSize.toFixed(4) + ' SOL',
          },
        });
        
        try {
          await this.db.query(
            `INSERT INTO infra_wallets (
              address, behavior_type, confidence_score, total_trades,
              first_seen_at, last_seen_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (address) DO UPDATE SET
              behavior_type = $2,
              confidence_score = $3,
              total_trades = $4,
              last_seen_at = $6,
              updated_at = NOW()`,
            [
              walletAddress,
              classification.behaviorType,
              classification.confidence,
              history.trades.length,
              new Date(history.firstTradeTime),
              new Date(history.lastTradeTime),
            ]
          );
        } catch (error) {
          log.error(`Failed to persist classification: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * Get classification for display
   */
  getWalletInfo(walletAddress: string): string {
    const classification = this.classify(walletAddress);
    return `${classification.behaviorType} (${classification.confidence}% confidence)`;
  }

  /**
   * Stop the classifier
   */
  stop(): void {
    log.info('Stopping infra classifier...');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.db.end();
  }

  /**
   * Get statistics
   */
  getStats(): { 
    walletsTracked: number; 
    classifiedWallets: number;
    byType: Record<InfraBehaviorType, number>;
  } {
    const byType: Record<InfraBehaviorType, number> = {
      defensive: 0,
      cyclical: 0,
      aggressive: 0,
      passive: 0,
      unknown: 0,
    };

    let classifiedWallets = 0;

    for (const [wallet] of this.walletHistory) {
      const classification = this.classify(wallet);
      byType[classification.behaviorType]++;
      if (classification.behaviorType !== 'unknown') {
        classifiedWallets++;
      }
    }

    return {
      walletsTracked: this.walletHistory.size,
      classifiedWallets,
      byType,
    };
  }
}


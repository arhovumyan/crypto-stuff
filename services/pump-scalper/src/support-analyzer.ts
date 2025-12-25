/**
 * Support Analyzer
 * Analyzes token support based on buyer activity and volume
 */

import { createLogger } from '@copytrader/shared';
import { TokenActivity } from './pump-monitor.js';

const log = createLogger('support-analyzer');

export interface SupportCriteria {
  minUniqueBuyers: number;
  minBuyersInTimeframe: number; // seconds
  minVolumeUSD: number;
  minLiquidityUSD: number;
  minMarketCapUSD: number;
  maxMarketCapUSD: number;
}

export interface SupportAnalysis {
  hasSupport: boolean;
  score: number;
  reasons: string[];
  uniqueBuyers: number;
  volumeUSD: number;
  liquidityUSD: number;
  ageSeconds: number;
}

export class SupportAnalyzer {
  private criteria: SupportCriteria;

  constructor(criteria?: Partial<SupportCriteria>) {
    this.criteria = {
      minUniqueBuyers: criteria?.minUniqueBuyers || 10,
      minBuyersInTimeframe: criteria?.minBuyersInTimeframe || 60,
      minVolumeUSD: criteria?.minVolumeUSD || 1000,
      minLiquidityUSD: criteria?.minLiquidityUSD || 5000,
      minMarketCapUSD: criteria?.minMarketCapUSD || 10000,
      maxMarketCapUSD: criteria?.maxMarketCapUSD || 500000,
    };

    log.info('📊 Support Analyzer initialized');
    log.info(`   Min Unique Buyers: ${this.criteria.minUniqueBuyers}`);
    log.info(`   Timeframe: ${this.criteria.minBuyersInTimeframe}s`);
    log.info(`   Min Volume: $${this.criteria.minVolumeUSD}`);
    log.info(`   Min Liquidity: $${this.criteria.minLiquidityUSD}`);
    log.info(`   Market Cap Range: $${this.criteria.minMarketCapUSD} - $${this.criteria.maxMarketCapUSD}`);
  }

  /**
   * Analyze if token has sufficient support
   */
  analyze(activity: TokenActivity): SupportAnalysis {
    const reasons: string[] = [];
    let score = 0;

    // Calculate age in seconds
    const ageSeconds = (Date.now() - activity.firstBuyTime.getTime()) / 1000;

    // Check unique buyers
    const uniqueBuyers = activity.uniqueBuyers.size;
    if (uniqueBuyers >= this.criteria.minUniqueBuyers) {
      score += 30;
      reasons.push(`✅ ${uniqueBuyers} unique buyers (min: ${this.criteria.minUniqueBuyers})`);
    } else {
      reasons.push(`❌ Only ${uniqueBuyers} unique buyers (need: ${this.criteria.minUniqueBuyers})`);
    }

    // Check buyers in timeframe
    if (ageSeconds <= this.criteria.minBuyersInTimeframe && uniqueBuyers >= this.criteria.minUniqueBuyers) {
      score += 25;
      reasons.push(`✅ Strong early adoption (${ageSeconds.toFixed(0)}s)`);
    }

    // Check volume
    if (activity.totalVolume >= this.criteria.minVolumeUSD) {
      score += 20;
      reasons.push(`✅ Volume: $${activity.totalVolume.toFixed(0)} (min: $${this.criteria.minVolumeUSD})`);
    } else {
      reasons.push(`❌ Volume: $${activity.totalVolume.toFixed(0)} (need: $${this.criteria.minVolumeUSD})`);
    }

    // Check liquidity
    if (activity.liquidityUSD >= this.criteria.minLiquidityUSD) {
      score += 15;
      reasons.push(`✅ Liquidity: $${activity.liquidityUSD.toFixed(0)} (min: $${this.criteria.minLiquidityUSD})`);
    } else {
      reasons.push(`❌ Liquidity: $${activity.liquidityUSD.toFixed(0)} (need: $${this.criteria.minLiquidityUSD})`);
    }

    // Check market cap range
    if (
      activity.marketCapUSD >= this.criteria.minMarketCapUSD &&
      activity.marketCapUSD <= this.criteria.maxMarketCapUSD
    ) {
      score += 10;
      reasons.push(`✅ Market Cap: $${activity.marketCapUSD.toFixed(0)}`);
    } else if (activity.marketCapUSD < this.criteria.minMarketCapUSD) {
      reasons.push(`❌ Market Cap too low: $${activity.marketCapUSD.toFixed(0)}`);
    } else {
      reasons.push(`❌ Market Cap too high: $${activity.marketCapUSD.toFixed(0)}`);
    }

    const hasSupport = score >= 70; // Need at least 70/100 points

    return {
      hasSupport,
      score,
      reasons,
      uniqueBuyers,
      volumeUSD: activity.totalVolume,
      liquidityUSD: activity.liquidityUSD,
      ageSeconds,
    };
  }

  /**
   * Update criteria
   */
  updateCriteria(criteria: Partial<SupportCriteria>): void {
    this.criteria = { ...this.criteria, ...criteria };
    log.info('📊 Support criteria updated');
  }

  /**
   * Get current criteria
   */
  getCriteria(): SupportCriteria {
    return { ...this.criteria };
  }
}

import { logger } from './logger';
import { config } from './config';
import fs from 'fs/promises';
import path from 'path';

interface RegimeState {
  failedStabilizations: Array<{
    timestamp: number;
    token: string;
  }>;
  recentPerformance: {
    trades: number;
    wins: number;
    totalPnl: number;
  };
  blocked: boolean;
  blockReason?: string;
  lastUpdate: number;
}

const REGIME_FILE = path.join(__dirname, '../data/regime-state.json');

/**
 * RegimeFilter blocks entries during poor market conditions
 * 
 * Prevents overtrading when:
 * 1. Multiple failed stabilizations (choppy market)
 * 2. High daily losses (strategy not working)
 * 3. Saturation (too many signals, quality diluted)
 * 4. Poor recent performance (edge decaying)
 */
export class RegimeFilter {
  private state: RegimeState;

  constructor() {
    this.state = {
      failedStabilizations: [],
      recentPerformance: {
        trades: 0,
        wins: 0,
        totalPnl: 0,
      },
      blocked: false,
      lastUpdate: Date.now(),
    };
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(REGIME_FILE), { recursive: true });
      
      try {
        const data = await fs.readFile(REGIME_FILE, 'utf-8');
        this.state = JSON.parse(data);
        
        logger.info(
          `[RegimeFilter] Loaded state: ` +
          `${this.state.failedStabilizations.length} failed stabilizations, ` +
          `${this.state.blocked ? 'BLOCKED' : 'ACTIVE'}`
        );
      } catch (err) {
        logger.info('[RegimeFilter] Starting with fresh regime state');
      }
      
      // Clean old data
      await this.cleanup();
      
    } catch (err) {
      logger.error('[RegimeFilter] Init error:', err);
    }
  }

  /**
   * Check if we should block new entries
   */
  async shouldBlockEntry(dailyPnl: number): Promise<{ block: boolean; reason?: string }> {
    await this.cleanup();
    
    const now = Date.now() / 1000;
    const reasons: string[] = [];

    // Check 1: Too many failed stabilizations (choppy market)
    const windowSec = config.regime.failureWindowSec;
    const recentFailures = this.state.failedStabilizations.filter(f => 
      now - f.timestamp < windowSec
    );
    
    if (recentFailures.length >= config.regime.maxFailedStabilizations) {
      reasons.push(
        `Choppy market: ${recentFailures.length} failed stabilizations ` +
        `in ${windowSec / 3600}h (max: ${config.regime.maxFailedStabilizations})`
      );
    }

    // Check 2: Daily loss too high (strategy not working)
    const maxLoss = config.risk.maxDailyLossUsd;
    const lossThreshold = maxLoss * (config.regime.maxDailyLossThresholdPercent / 100);
    
    if (dailyPnl < 0 && Math.abs(dailyPnl) >= lossThreshold) {
      reasons.push(
        `High daily losses: $${Math.abs(dailyPnl).toFixed(2)} ` +
        `(threshold: $${lossThreshold.toFixed(2)})`
      );
    }

    // Check 3: Poor recent performance
    const { trades, wins, totalPnl } = this.state.recentPerformance;
    if (trades >= 5) {
      const winRate = wins / trades;
      const avgPnl = totalPnl / trades;
      
      // Block if win rate < 30% or avg P&L < -10%
      if (winRate < 0.3 || avgPnl < -10) {
        reasons.push(
          `Poor performance: ${(winRate * 100).toFixed(0)}% win rate, ` +
          `${avgPnl.toFixed(1)}% avg P&L over ${trades} trades`
        );
      }
    }

    const block = reasons.length > 0;
    
    if (block && !this.state.blocked) {
      // State changed to blocked
      this.state.blocked = true;
      this.state.blockReason = reasons.join('; ');
      await this.save();
      
      logger.warn(`[RegimeFilter] 🚫 BLOCKING NEW ENTRIES`);
      reasons.forEach(r => logger.warn(`  • ${r}`));
    } else if (!block && this.state.blocked) {
      // State cleared
      this.state.blocked = false;
      this.state.blockReason = undefined;
      await this.save();
      
      logger.info(`[RegimeFilter] ✅ Regime cleared - accepting entries again`);
    }

    return {
      block,
      reason: block ? reasons.join('; ') : undefined,
    };
  }

  /**
   * Record a failed stabilization
   */
  async recordFailedStabilization(token: string): Promise<void> {
    this.state.failedStabilizations.push({
      timestamp: Date.now() / 1000,
      token,
    });
    
    await this.save();
    
    logger.info(
      `[RegimeFilter] Failed stabilization recorded: ${token.slice(0, 8)}... ` +
      `(${this.state.failedStabilizations.length} in window)`
    );
  }

  /**
   * Record a trade outcome for performance tracking
   */
  async recordTrade(won: boolean, pnlPercent: number): Promise<void> {
    this.state.recentPerformance.trades++;
    if (won) this.state.recentPerformance.wins++;
    this.state.recentPerformance.totalPnl += pnlPercent;
    
    // Keep only recent trades (last 20)
    if (this.state.recentPerformance.trades > 20) {
      // Reset counters but keep trend direction
      const winRate = this.state.recentPerformance.wins / this.state.recentPerformance.trades;
      const avgPnl = this.state.recentPerformance.totalPnl / this.state.recentPerformance.trades;
      
      this.state.recentPerformance = {
        trades: 10,
        wins: Math.round(winRate * 10),
        totalPnl: avgPnl * 10,
      };
    }
    
    await this.save();
  }

  /**
   * Get current regime status
   */
  getStatus(): {
    blocked: boolean;
    reason?: string;
    failedStabilizations: number;
    recentTrades: number;
    winRate: number;
  } {
    const { trades, wins } = this.state.recentPerformance;
    
    return {
      blocked: this.state.blocked,
      reason: this.state.blockReason,
      failedStabilizations: this.state.failedStabilizations.length,
      recentTrades: trades,
      winRate: trades > 0 ? wins / trades : 0,
    };
  }

  /**
   * Manually unblock (for testing or recovery)
   */
  async unblock(): Promise<void> {
    this.state.blocked = false;
    this.state.blockReason = undefined;
    this.state.failedStabilizations = [];
    await this.save();
    
    logger.info('[RegimeFilter] ✅ Manually unblocked');
  }

  /**
   * Clean up old data
   */
  private async cleanup(): Promise<void> {
    const now = Date.now() / 1000;
    const windowSec = config.regime.failureWindowSec;
    
    // Remove old failed stabilizations
    const before = this.state.failedStabilizations.length;
    this.state.failedStabilizations = this.state.failedStabilizations.filter(f =>
      now - f.timestamp < windowSec
    );
    
    if (this.state.failedStabilizations.length < before) {
      await this.save();
    }
  }

  /**
   * Save state to disk
   */
  private async save(): Promise<void> {
    try {
      this.state.lastUpdate = Date.now();
      await fs.writeFile(REGIME_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error('[RegimeFilter] Save error:', err);
    }
  }
}

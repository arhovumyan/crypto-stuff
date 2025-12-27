import { logger } from './logger';
import { config } from './config';
import fs from 'fs/promises';
import path from 'path';

interface WalletPerformance {
  wallet: string;
  trades: {
    timestamp: number;
    won: boolean;
    pnlPercent: number;
  }[];
  confidence: number;
  lastUpdated: number;
  winRate: number;
  avgPnl: number;
}

interface WalletConfidenceState {
  wallets: Map<string, WalletPerformance>;
  lastDecay: number;
}

const CONFIDENCE_FILE = path.join(__dirname, '../data/wallet-confidence.json');

export class WalletConfidenceTracker {
  private state: WalletConfidenceState;

  constructor() {
    this.state = {
      wallets: new Map(),
      lastDecay: Date.now(),
    };
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(CONFIDENCE_FILE), { recursive: true });
      
      try {
        const data = await fs.readFile(CONFIDENCE_FILE, 'utf-8');
        const loaded = JSON.parse(data);
        
        // Convert array back to Map
        this.state.wallets = new Map(
          loaded.wallets.map((w: any) => [w.wallet, w])
        );
        this.state.lastDecay = loaded.lastDecay || Date.now();
        
        logger.info(`[WalletConfidence] Loaded ${this.state.wallets.size} wallet histories`);
      } catch (err) {
        // File doesn't exist yet, start fresh
        logger.info('[WalletConfidence] Starting with fresh wallet confidence tracking');
        
        // Initialize all configured infra wallets
        for (const wallet of config.infraWallets) {
          this.state.wallets.set(wallet, {
            wallet,
            trades: [],
            confidence: config.walletConfidence.initialScore,
            lastUpdated: Date.now(),
            winRate: 0,
            avgPnl: 0,
          });
        }
      }

      // Apply decay if needed
      await this.applyDecay();
      
    } catch (err) {
      logger.error('[WalletConfidence] Init error:', err);
      throw err;
    }
  }

  /**
   * Get confidence score for a wallet (0-1 range)
   */
  getConfidence(wallet: string): number {
    const perf = this.state.wallets.get(wallet);
    if (!perf) {
      // Unknown wallet - use initial score
      return config.walletConfidence.initialScore;
    }
    
    return perf.confidence;
  }

  /**
   * Check if wallet meets minimum confidence threshold
   */
  isConfident(wallet: string): boolean {
    const confidence = this.getConfidence(wallet);
    const isConfident = confidence >= config.walletConfidence.minScore;
    
    if (!isConfident) {
      logger.info(
        `[WalletConfidence] ❌ Wallet ${wallet.slice(0, 8)}... below threshold: ` +
        `${(confidence * 100).toFixed(1)}% < ${(config.walletConfidence.minScore * 100).toFixed(1)}%`
      );
    }
    
    return isConfident;
  }

  /**
   * Record a trade outcome for a wallet
   */
  async recordTrade(wallet: string, won: boolean, pnlPercent: number): Promise<void> {
    let perf = this.state.wallets.get(wallet);
    
    if (!perf) {
      // New wallet discovered
      perf = {
        wallet,
        trades: [],
        confidence: config.walletConfidence.initialScore,
        lastUpdated: Date.now(),
        winRate: 0,
        avgPnl: 0,
      };
      this.state.wallets.set(wallet, perf);
      logger.info(`[WalletConfidence] 🆕 New wallet discovered: ${wallet.slice(0, 8)}...`);
    }

    // Add trade
    perf.trades.push({
      timestamp: Date.now(),
      won,
      pnlPercent,
    });

    // Keep only recent trades
    const window = config.walletConfidence.performanceWindow;
    if (perf.trades.length > window) {
      perf.trades = perf.trades.slice(-window);
    }

    // Recalculate metrics
    this.recalculateConfidence(perf);
    
    logger.info(
      `[WalletConfidence] 📊 ${wallet.slice(0, 8)}... trade recorded: ` +
      `${won ? '✅ WIN' : '❌ LOSS'} ${pnlPercent.toFixed(1)}% | ` +
      `Confidence: ${(perf.confidence * 100).toFixed(1)}% | ` +
      `Win Rate: ${(perf.winRate * 100).toFixed(1)}% | ` +
      `Avg P&L: ${perf.avgPnl.toFixed(1)}%`
    );

    await this.save();
  }

  /**
   * Recalculate confidence score based on performance
   */
  private recalculateConfidence(perf: WalletPerformance): void {
    if (perf.trades.length === 0) {
      perf.confidence = config.walletConfidence.initialScore;
      perf.winRate = 0;
      perf.avgPnl = 0;
      return;
    }

    // Calculate win rate
    const wins = perf.trades.filter(t => t.won).length;
    perf.winRate = wins / perf.trades.length;

    // Calculate average P&L
    const totalPnl = perf.trades.reduce((sum, t) => sum + t.pnlPercent, 0);
    perf.avgPnl = totalPnl / perf.trades.length;

    // Calculate profit factor (wins / losses)
    const totalWins = perf.trades.filter(t => t.won).reduce((sum, t) => sum + t.pnlPercent, 0);
    const totalLosses = Math.abs(perf.trades.filter(t => !t.won).reduce((sum, t) => sum + t.pnlPercent, 0));
    const profitFactor = totalLosses === 0 ? 2 : totalWins / totalLosses;

    // Confidence score formula:
    // - Win rate contributes 40%
    // - Avg P&L contributes 30% (normalized to 0-1)
    // - Profit factor contributes 30% (normalized to 0-1)
    
    const winRateScore = perf.winRate;
    const pnlScore = Math.max(0, Math.min(1, (perf.avgPnl + 20) / 60)); // -20% to +40% mapped to 0-1
    const pfScore = Math.max(0, Math.min(1, profitFactor / 3)); // 0-3 mapped to 0-1

    perf.confidence = (winRateScore * 0.4) + (pnlScore * 0.3) + (pfScore * 0.3);
    perf.lastUpdated = Date.now();
  }

  /**
   * Apply daily decay to all wallet confidence scores
   */
  private async applyDecay(): Promise<void> {
    const now = Date.now();
    const daysSinceLastDecay = (now - this.state.lastDecay) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastDecay < 1) {
      return; // Not enough time passed
    }

    const decayAmount = config.walletConfidence.dailyDecay * Math.floor(daysSinceLastDecay);
    let decayedCount = 0;

    for (const perf of this.state.wallets.values()) {
      const oldConfidence = perf.confidence;
      perf.confidence = Math.max(0, perf.confidence - decayAmount);
      
      if (perf.confidence < oldConfidence) {
        decayedCount++;
      }
    }

    this.state.lastDecay = now;

    if (decayedCount > 0) {
      logger.info(
        `[WalletConfidence] ⏰ Applied decay to ${decayedCount} wallets ` +
        `(${decayAmount.toFixed(3)} per wallet)`
      );
      await this.save();
    }
  }

  /**
   * Get all wallet stats for reporting
   */
  getAllStats(): Array<{
    wallet: string;
    confidence: number;
    winRate: number;
    avgPnl: number;
    trades: number;
  }> {
    return Array.from(this.state.wallets.values())
      .map(perf => ({
        wallet: perf.wallet,
        confidence: perf.confidence,
        winRate: perf.winRate,
        avgPnl: perf.avgPnl,
        trades: perf.trades.length,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Save state to disk
   */
  private async save(): Promise<void> {
    try {
      const data = {
        wallets: Array.from(this.state.wallets.values()),
        lastDecay: this.state.lastDecay,
      };
      
      await fs.writeFile(CONFIDENCE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('[WalletConfidence] Save error:', err);
    }
  }

  /**
   * Periodic maintenance (call every 10 minutes)
   */
  async maintain(): Promise<void> {
    await this.applyDecay();
  }
}

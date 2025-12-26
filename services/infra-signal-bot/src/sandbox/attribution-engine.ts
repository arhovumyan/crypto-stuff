/**
 * Attribution Engine
 * Logs detailed trade context and generates performance reports
 */

import { writeFile } from 'fs/promises';
import pg from 'pg';
import { createLogger } from '../logger.js';
import { SimulatedTrade, WalletAnalytics, SimulationReport, VirtualPosition } from './types.js';

const log = createLogger('attribution-engine');
const { Pool } = pg;

export class AttributionEngine {
  private trades: SimulatedTrade[] = [];
  private walletAnalytics: Map<string, WalletAnalytics> = new Map();
  private db: pg.Pool;
  private runId: string;

  constructor(runId: string, dbConnectionString: string) {
    this.runId = runId;
    this.db = new Pool({ connectionString: dbConnectionString });
  }

  /**
   * Log a trade with full attribution
   */
  async logTrade(trade: SimulatedTrade): Promise<void> {
    this.trades.push(trade);

    // Store in database
    await this.storeTradeInDatabase(trade);

    // Update wallet analytics
    for (const walletAddress of trade.infraWallets) {
      this.updateWalletAnalytics(walletAddress, trade);
    }

    log.info('📊 Trade logged', {
      tradeId: trade.tradeId,
      token: trade.tokenMint.slice(0, 8) + '...',
      pnl: trade.pnlSOL.toFixed(4) + ' SOL',
      pnlPct: trade.pnlPct.toFixed(2) + '%',
      exitReason: trade.exitReason,
    });
  }

  /**
   * Store trade in database
   */
  private async storeTradeInDatabase(trade: SimulatedTrade): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO trade_attributions (
          run_id, trade_id, token_mint, pool_address,
          entry_slot, entry_time, entry_price, entry_amount_sol, entry_amount_tokens,
          entry_slippage_bps, entry_fees_sol,
          infra_wallets, absorption_event, stabilization_metrics, signal_strength, regime_state,
          exit_slot, exit_time, exit_price, exit_reason, exit_slippage_bps, exit_fees_sol,
          pnl_sol, pnl_pct, net_pnl_sol,
          mae, mfe, mae_pct, mfe_pct,
          holding_time_slots, holding_time_ms,
          total_fees_sol, fill_success, fill_failure_reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
        )`,
        [
          this.runId,
          trade.tradeId,
          trade.tokenMint,
          trade.poolAddress,
          trade.entrySlot,
          trade.entryTime,
          trade.entryPrice,
          trade.entryAmountSOL,
          trade.entryAmountTokens,
          trade.entrySlippageBps,
          trade.entryFeesSOL,
          trade.infraWallets,
          JSON.stringify(trade.absorptionEvent),
          JSON.stringify(trade.stabilizationMetrics),
          trade.signalStrength,
          trade.regimeState,
          trade.exitSlot,
          trade.exitTime,
          trade.exitPrice,
          trade.exitReason,
          trade.exitSlippageBps,
          trade.exitFeesSOL,
          trade.pnlSOL,
          trade.pnlPct,
          trade.netPnLSOL,
          trade.mae,
          trade.mfe,
          trade.maePct,
          trade.mfePct,
          trade.holdingTimeSlots,
          trade.holdingTimeMs,
          trade.totalFeesSOL,
          trade.fillSuccess,
          trade.fillFailureReason,
        ]
      );
    } catch (error) {
      log.error(`Failed to store trade in database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update wallet analytics
   */
  private updateWalletAnalytics(walletAddress: string, trade: SimulatedTrade): void {
    if (!this.walletAnalytics.has(walletAddress)) {
      this.walletAnalytics.set(walletAddress, {
        address: walletAddress,
        behaviorType: 'unknown',
        discoveredAt: trade.entryTime,
        discoveryMethod: 'automatic',
        totalAbsorptions: 0,
        totalDefenses: 0,
        successfulDefenses: 0,
        defenseSuccessRate: 0,
        averageResponseTimeSlots: 0,
        initialConfidence: 100,
        finalConfidence: 100,
        confidenceHistory: [],
        confidenceDecayEvents: 0,
        tradesInvolved: 0,
        totalPnLContribution: 0,
        averagePnLPerTrade: 0,
        winRate: 0,
        isBlacklisted: false,
      });
    }

    const analytics = this.walletAnalytics.get(walletAddress)!;
    analytics.tradesInvolved++;
    analytics.totalPnLContribution += trade.pnlSOL;
    analytics.averagePnLPerTrade = analytics.totalPnLContribution / analytics.tradesInvolved;
    
    // Update win rate
    const winningTrades = this.trades
      .filter(t => t.infraWallets.includes(walletAddress) && t.pnlSOL > 0)
      .length;
    analytics.winRate = analytics.tradesInvolved > 0 ? winningTrades / analytics.tradesInvolved : 0;
  }

  /**
   * Generate full simulation report
   */
  async generateReport(
    datasetPath: string,
    datasetHash: string,
    configHash: string,
    startTime: Date,
    endTime: Date,
    portfolio: any
  ): Promise<SimulationReport> {
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationDays = durationMs / (1000 * 60 * 60 * 24);

    // Calculate summary stats
    const closedTrades = this.trades.filter(t => t.exitTime);
    const winningTrades = closedTrades.filter(t => t.pnlSOL > 0);
    const losingTrades = closedTrades.filter(t => t.pnlSOL <= 0);

    const totalPnLSOL = closedTrades.reduce((sum, t) => sum + t.pnlSOL, 0);
    const totalFeesSOL = closedTrades.reduce((sum, t) => sum + t.totalFeesSOL, 0);
    const netPnLSOL = totalPnLSOL - totalFeesSOL;

    const avgHoldingTimeMs = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + t.holdingTimeMs, 0) / closedTrades.length
      : 0;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnlSOL, 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlSOL, 0) / losingTrades.length)
      : 0;

    const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Calculate Sharpe ratio (simplified)
    const returns = closedTrades.map(t => t.pnlPct / 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Market coverage
    const uniqueTokens = new Set(this.trades.map(t => t.tokenMint)).size;
    const uniqueTraders = new Set(); // Would need to track from events

    const report: SimulationReport = {
      runId: this.runId,
      datasetPath,
      datasetHash,
      configHash,
      startTime,
      endTime,
      durationDays,
      summary: {
        totalTrades: closedTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        totalPnLSOL,
        netPnLSOL,
        totalFeesSOL,
        maxDrawdownSOL: portfolio.maxDrawdownSOL || 0,
        maxDrawdownPct: portfolio.maxDrawdownPct || 0,
        avgHoldingTimeMs,
        expectancy,
        sharpeRatio,
      },
      marketCoverage: {
        totalEvents: 0, // Would track from replay
        totalSwaps: 0,
        uniqueTokens,
        uniqueTraders: uniqueTraders.size,
        largeSellsDetected: 0,
        absorptionsConfirmed: 0,
        stabilizationsConfirmed: 0,
        signalsGenerated: this.trades.length,
      },
      trades: this.trades,
      walletAnalytics: Array.from(this.walletAnalytics.values()),
      equityCurve: [], // Would generate from portfolio history
      drawdownCurve: [],
    };

    log.info('📊 Report generated', {
      totalTrades: report.summary.totalTrades,
      winRate: (report.summary.winRate * 100).toFixed(1) + '%',
      netPnL: report.summary.netPnLSOL.toFixed(4) + ' SOL',
      maxDrawdown: report.summary.maxDrawdownPct.toFixed(2) + '%',
    });

    return report;
  }

  /**
   * Export report to files
   */
  async exportReport(report: SimulationReport, outputDir: string): Promise<void> {
    // Create output directory if it doesn't exist
    const { mkdir } = await import('fs/promises');
    await mkdir(outputDir, { recursive: true });
    
    // 1. Write summary JSON
    await writeFile(
      `${outputDir}/run_summary.json`,
      JSON.stringify(report, null, 2),
      'utf-8'
    );

    // 2. Write trades CSV
    await this.writeTradesCSV(report.trades, `${outputDir}/trades.csv`);

    // 3. Write wallet performance CSV
    await this.writeWalletPerformanceCSV(report.walletAnalytics, `${outputDir}/wallet_performance.csv`);

    // 4. Write markdown report
    await this.writeMarkdownReport(report, `${outputDir}/report.md`);

    log.info('✅ Report exported', { outputDir });
  }

  /**
   * Write trades to CSV
   */
  private async writeTradesCSV(trades: SimulatedTrade[], filePath: string): Promise<void> {
    const header = [
      'trade_id', 'token_mint', 'entry_slot', 'entry_price', 'exit_slot', 'exit_price',
      'exit_reason', 'pnl_sol', 'pnl_pct', 'mae_pct', 'mfe_pct', 'holding_time_slots',
      'signal_strength', 'regime_state', 'infra_wallets',
    ].join(',');

    const rows = trades.map(t => [
      t.tradeId,
      t.tokenMint.slice(0, 8),
      t.entrySlot,
      t.entryPrice.toFixed(8),
      t.exitSlot || '',
      t.exitPrice?.toFixed(8) || '',
      t.exitReason || '',
      t.pnlSOL.toFixed(4),
      t.pnlPct.toFixed(2),
      t.maePct.toFixed(2),
      t.mfePct.toFixed(2),
      t.holdingTimeSlots,
      t.signalStrength,
      t.regimeState,
      t.infraWallets.length,
    ].join(','));

    const csv = [header, ...rows].join('\n');
    await writeFile(filePath, csv, 'utf-8');
  }

  /**
   * Write wallet performance to CSV
   */
  private async writeWalletPerformanceCSV(wallets: WalletAnalytics[], filePath: string): Promise<void> {
    const header = [
      'address', 'behavior_type', 'trades_involved', 'total_pnl_contribution', 
      'average_pnl_per_trade', 'win_rate', 'discovery_method',
    ].join(',');

    const rows = wallets.map(w => [
      w.address.slice(0, 8),
      w.behaviorType,
      w.tradesInvolved,
      w.totalPnLContribution.toFixed(4),
      w.averagePnLPerTrade.toFixed(4),
      (w.winRate * 100).toFixed(1),
      w.discoveryMethod,
    ].join(','));

    const csv = [header, ...rows].join('\n');
    await writeFile(filePath, csv, 'utf-8');
  }

  /**
   * Write markdown report
   */
  private async writeMarkdownReport(report: SimulationReport, filePath: string): Promise<void> {
    const md = `# Replay Simulation Report

**Run ID:** ${report.runId}
**Dataset:** ${report.datasetPath}
**Duration:** ${report.durationDays.toFixed(2)} days
**Start:** ${report.startTime.toISOString()}
**End:** ${report.endTime.toISOString()}

## Summary

- **Total Trades:** ${report.summary.totalTrades}
- **Win Rate:** ${(report.summary.winRate * 100).toFixed(1)}% (${report.summary.winningTrades} wins, ${report.summary.losingTrades} losses)
- **Total P&L:** ${report.summary.totalPnLSOL.toFixed(4)} SOL
- **Net P&L (after fees):** ${report.summary.netPnLSOL.toFixed(4)} SOL
- **Total Fees:** ${report.summary.totalFeesSOL.toFixed(4)} SOL
- **Max Drawdown:** ${report.summary.maxDrawdownSOL.toFixed(4)} SOL (${report.summary.maxDrawdownPct.toFixed(2)}%)
- **Avg Holding Time:** ${(report.summary.avgHoldingTimeMs / 60000).toFixed(1)} minutes
- **Expectancy:** ${report.summary.expectancy.toFixed(4)} SOL
- **Sharpe Ratio:** ${report.summary.sharpeRatio.toFixed(2)}

## Signal Quality

- **Signals Generated:** ${report.marketCoverage.signalsGenerated}
- **Unique Tokens:** ${report.marketCoverage.uniqueTokens}

## Top Performing Wallets

${this.formatTopWallets(report.walletAnalytics.filter(w => w.totalPnLContribution > 0))}

## Worst Performing Wallets

${this.formatWorstWallets(report.walletAnalytics.filter(w => w.totalPnLContribution < 0))}

## Exit Reasons

${this.formatExitReasons(report.trades)}

---

*Generated on ${new Date().toISOString()}*
`;

    await writeFile(filePath, md, 'utf-8');
  }

  private formatTopWallets(wallets: WalletAnalytics[]): string {
    const top = wallets
      .sort((a, b) => b.totalPnLContribution - a.totalPnLContribution)
      .slice(0, 5);

    if (top.length === 0) return '_No profitable wallets_';

    return top.map((w, i) => 
      `${i + 1}. ${w.address.slice(0, 8)}... - ${w.tradesInvolved} trades, +${w.totalPnLContribution.toFixed(4)} SOL, ${(w.winRate * 100).toFixed(1)}% win rate`
    ).join('\n');
  }

  private formatWorstWallets(wallets: WalletAnalytics[]): string {
    const worst = wallets
      .sort((a, b) => a.totalPnLContribution - b.totalPnLContribution)
      .slice(0, 5);

    if (worst.length === 0) return '_No losing wallets_';

    return worst.map((w, i) => 
      `${i + 1}. ${w.address.slice(0, 8)}... - ${w.tradesInvolved} trades, ${w.totalPnLContribution.toFixed(4)} SOL, ${(w.winRate * 100).toFixed(1)}% win rate (FALSE POSITIVE)`
    ).join('\n');
  }

  private formatExitReasons(trades: SimulatedTrade[]): string {
    const reasons: Record<string, number> = {};
    for (const trade of trades) {
      if (trade.exitReason) {
        reasons[trade.exitReason] = (reasons[trade.exitReason] || 0) + 1;
      }
    }

    return Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `- **${reason}:** ${count} (${((count / trades.length) * 100).toFixed(1)}%)`)
      .join('\n');
  }

  /**
   * Get trades
   */
  getTrades(): SimulatedTrade[] {
    return this.trades;
  }

  /**
   * Get wallet analytics
   */
  getWalletAnalytics(): WalletAnalytics[] {
    return Array.from(this.walletAnalytics.values());
  }
}


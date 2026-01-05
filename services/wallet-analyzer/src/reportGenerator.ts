import { Database, MatchedTrade } from './database';
import { logger } from './logger';
import { format, formatDistanceStrict } from 'date-fns';
import fs from 'fs/promises';
import path from 'path';

export class ReportGenerator {
  private db: Database;
  
  constructor(database: Database) {
    this.db = database;
  }
  
  /**
   * Generate comprehensive wallet analysis report
   */
  async generateWalletReport(walletId: number, outputPath: string): Promise<void> {
    logger.info('Generating wallet report', { walletId });
    
    const wallet = await this.db.query(
      'SELECT * FROM tracked_wallets WHERE id = $1',
      [walletId]
    );
    
    if (!wallet.rows[0]) {
      throw new Error(`Wallet ${walletId} not found`);
    }
    
    const walletData = wallet.rows[0];
    
    // Gather all analysis data
    const summary = await this.db.getWalletSummary(walletId);
    const performance = await this.db.calculatePerformanceMetrics(walletId);
    const trades = await this.db.getMatchedTradesByWallet(walletId);
    const patterns = await this.analyzePatterns(trades);
    const tokenSelection = await this.analyzeTokenSelection(trades);
    const timingAnalysis = await this.analyzeEntryTiming(trades);
    const exitAnalysis = await this.analyzeExitStrategy(trades);
    
    // Generate markdown report
    const report = this.formatReport({
      wallet: walletData,
      summary,
      performance,
      patterns,
      tokenSelection,
      timingAnalysis,
      exitAnalysis,
      topTrades: trades.filter(t => t.isWinner).slice(0, 10),
      worstTrades: trades.filter(t => !t.isWinner).slice(0, 10)
    });
    
    // Write to file
    await fs.writeFile(outputPath, report, 'utf-8');
    logger.info('Report generated', { outputPath });
  }
  
  /**
   * Analyze behavioral patterns
   */
  private async analyzePatterns(trades: MatchedTrade[]): Promise<any> {
    const completedTrades = trades.filter(t => t.sellTransactionId !== null);
    
    if (completedTrades.length === 0) {
      return { patterns: [] };
    }
    
    return {
      tradingStyle: this.classifyTradingStyle(completedTrades),
      consistency: this.calculateConsistency(completedTrades),
      riskProfile: this.assessRiskProfile(completedTrades)
    };
  }
  
  /**
   * Classify trading style based on hold times
   */
  private classifyTradingStyle(trades: MatchedTrade[]): string {
    const avgHoldTime = trades.reduce((sum, t) => sum + (t.holdTimeSeconds || 0), 0) / trades.length;
    
    if (avgHoldTime < 300) return 'Ultra-Fast Scalper (< 5 minutes)';
    if (avgHoldTime < 3600) return 'Scalper (< 1 hour)';
    if (avgHoldTime < 86400) return 'Day Trader (< 24 hours)';
    if (avgHoldTime < 604800) return 'Swing Trader (< 7 days)';
    return 'Position Trader (> 7 days)';
  }
  
  /**
   * Calculate trading consistency
   */
  private calculateConsistency(trades: MatchedTrade[]): string {
    const winRate = trades.filter(t => t.isWinner).length / trades.length;
    
    if (winRate > 0.75) return 'Very High (75%+ win rate)';
    if (winRate > 0.60) return 'High (60-75% win rate)';
    if (winRate > 0.50) return 'Moderate (50-60% win rate)';
    return 'Low (< 50% win rate)';
  }
  
  /**
   * Assess risk profile
   */
  private assessRiskProfile(trades: MatchedTrade[]): string {
    const avgReturn = trades.reduce((sum, t) => sum + (t.returnPercentage || 0), 0) / trades.length;
    const maxLoss = Math.min(...trades.map(t => t.returnPercentage || 0));
    
    if (maxLoss < -50) return 'High Risk (large losses tolerated)';
    if (maxLoss < -20) return 'Moderate Risk';
    return 'Conservative (tight stop losses)';
  }
  
  /**
   * Analyze token selection criteria
   */
  private async analyzeTokenSelection(trades: MatchedTrade[]): Promise<any> {
    if (trades.length === 0) return {};
    
    const mcaps = trades.map(t => t.entryMcapUsd).filter(Boolean) as number[];
    const liquidities = trades.map(t => t.entryLiquidityUsd).filter(Boolean) as number[];
    
    return {
      preferredMcapRange: mcaps.length > 0 ? {
        min: Math.min(...mcaps),
        max: Math.max(...mcaps),
        avg: mcaps.reduce((a, b) => a + b, 0) / mcaps.length
      } : null,
      preferredLiquidityRange: liquidities.length > 0 ? {
        min: Math.min(...liquidities),
        max: Math.max(...liquidities),
        avg: liquidities.reduce((a, b) => a + b, 0) / liquidities.length
      } : null
    };
  }
  
  /**
   * Analyze entry timing patterns
   */
  private async analyzeEntryTiming(trades: MatchedTrade[]): Promise<any> {
    if (trades.length === 0) return {};
    
    const hourDistribution = new Array(24).fill(0);
    const dayDistribution: Record<string, number> = {};
    
    for (const trade of trades) {
      if (trade.entryHourOfDay !== undefined) {
        hourDistribution[trade.entryHourOfDay]++;
      }
      if (trade.entryDayOfWeek) {
        dayDistribution[trade.entryDayOfWeek] = (dayDistribution[trade.entryDayOfWeek] || 0) + 1;
      }
    }
    
    const peakHour = hourDistribution.indexOf(Math.max(...hourDistribution));
    const peakDay = Object.entries(dayDistribution).sort((a, b) => b[1] - a[1])[0]?.[0];
    
    return {
      peakTradingHour: peakHour,
      peakTradingDay: peakDay,
      hourDistribution,
      dayDistribution
    };
  }
  
  /**
   * Analyze exit strategy
   */
  private async analyzeExitStrategy(trades: MatchedTrade[]): Promise<any> {
    const completedTrades = trades.filter(t => t.sellTransactionId !== null);
    
    if (completedTrades.length === 0) return {};
    
    const profitTargets = completedTrades
      .filter(t => t.isWinner)
      .map(t => t.returnPercentage || 0);
    
    const stopLosses = completedTrades
      .filter(t => !t.isWinner)
      .map(t => t.returnPercentage || 0);
    
    return {
      avgProfitTarget: profitTargets.length > 0 
        ? profitTargets.reduce((a, b) => a + b, 0) / profitTargets.length 
        : 0,
      avgStopLoss: stopLosses.length > 0
        ? stopLosses.reduce((a, b) => a + b, 0) / stopLosses.length
        : 0,
      avgHoldTimeWinners: this.avgHoldTime(completedTrades.filter(t => t.isWinner)),
      avgHoldTimeLosers: this.avgHoldTime(completedTrades.filter(t => !t.isWinner))
    };
  }
  
  private avgHoldTime(trades: MatchedTrade[]): number {
    if (trades.length === 0) return 0;
    return trades.reduce((sum, t) => sum + (t.holdTimeSeconds || 0), 0) / trades.length;
  }
  
  /**
   * Format complete report as markdown
   */
  private formatReport(data: any): string {
    const { wallet, summary, performance, patterns, tokenSelection, timingAnalysis, exitAnalysis, topTrades, worstTrades } = data;
    
    return `# Wallet Behavior Analysis Report

## Wallet Information
- **Address**: \`${wallet.address}\`
- **Label**: ${wallet.label || 'N/A'}
- **Analysis Date**: ${format(new Date(), 'MMMM dd, yyyy HH:mm:ss')}
- **Last Activity**: ${wallet.last_analyzed_at ? format(new Date(wallet.last_analyzed_at), 'MMMM dd, yyyy') : 'N/A'}

---

## Executive Summary

### Performance Metrics
- **Total Trades**: ${performance.total_trades || 0}
- **Win Rate**: ${((performance.win_rate || 0) * 100).toFixed(2)}%
- **Total Profit**: ${(performance.total_profit_sol || 0).toFixed(4)} SOL
- **Average Return**: ${(performance.avg_return_pct || 0).toFixed(2)}%
- **Best Trade**: ${(performance.best_trade_pct || 0).toFixed(2)}%
- **Worst Trade**: ${(performance.worst_trade_pct || 0).toFixed(2)}%
- **Avg Hold Time**: ${this.formatDuration(performance.avg_hold_time_seconds || 0)}

### Trading Style Classification
**${patterns.tradingStyle || 'Unknown'}**

**Consistency**: ${patterns.consistency || 'N/A'}  
**Risk Profile**: ${patterns.riskProfile || 'N/A'}

---

## Token Selection Analysis

### Market Cap Preferences
${tokenSelection.preferredMcapRange ? `
- **Minimum**: $${tokenSelection.preferredMcapRange.min.toLocaleString()}
- **Maximum**: $${tokenSelection.preferredMcapRange.max.toLocaleString()}
- **Average**: $${tokenSelection.preferredMcapRange.avg.toFixed(0).toLocaleString()}
` : 'No data available'}

### Liquidity Requirements
${tokenSelection.preferredLiquidityRange ? `
- **Minimum**: $${tokenSelection.preferredLiquidityRange.min.toLocaleString()}
- **Maximum**: $${tokenSelection.preferredLiquidityRange.max.toLocaleString()}
- **Average**: $${tokenSelection.preferredLiquidityRange.avg.toFixed(0).toLocaleString()}
` : 'No data available'}

---

## Entry Timing Analysis

### Peak Trading Times
- **Peak Hour**: ${timingAnalysis.peakTradingHour !== undefined ? `${timingAnalysis.peakTradingHour}:00 UTC` : 'N/A'}
- **Peak Day**: ${timingAnalysis.peakTradingDay || 'N/A'}

### Hourly Distribution
\`\`\`
${timingAnalysis.hourDistribution ? timingAnalysis.hourDistribution.map((count: number, hour: number) => 
  `${hour.toString().padStart(2, '0')}:00 | ${'█'.repeat(Math.ceil(count / 2))} ${count}`
).join('\n') : 'No data'}
\`\`\`

---

## Exit Strategy Analysis

### Profit Targets & Stop Losses
- **Average Profit Target**: ${(exitAnalysis.avgProfitTarget || 0).toFixed(2)}%
- **Average Stop Loss**: ${(exitAnalysis.avgStopLoss || 0).toFixed(2)}%

### Hold Time by Outcome
- **Winners**: ${this.formatDuration(exitAnalysis.avgHoldTimeWinners || 0)}
- **Losers**: ${this.formatDuration(exitAnalysis.avgHoldTimeLosers || 0)}

---

## Top 10 Winning Trades

| Entry Time | Token | Hold Time | Return % | Profit (SOL) | Entry Price | Exit Price |
|------------|-------|-----------|----------|--------------|-------------|------------|
${topTrades.slice(0, 10).map((t: MatchedTrade) => 
  `| ${format(new Date(t.entryTime), 'MM/dd HH:mm')} | ${t.tokenMint.substring(0, 8)}... | ${this.formatDuration(t.holdTimeSeconds || 0)} | ${(t.returnPercentage || 0).toFixed(2)}% | ${(t.profitLossSol || 0).toFixed(4)} | $${(t.entryPriceUsd || 0).toFixed(6)} | $${(t.exitPriceUsd || 0).toFixed(6)} |`
).join('\n')}

---

## Top 10 Losing Trades

| Entry Time | Token | Hold Time | Return % | Loss (SOL) | Entry Price | Exit Price |
|------------|-------|-----------|----------|------------|-------------|------------|
${worstTrades.slice(0, 10).map((t: MatchedTrade) => 
  `| ${format(new Date(t.entryTime), 'MM/dd HH:mm')} | ${t.tokenMint.substring(0, 8)}... | ${this.formatDuration(t.holdTimeSeconds || 0)} | ${(t.returnPercentage || 0).toFixed(2)}% | ${(t.profitLossSol || 0).toFixed(4)} | $${(t.entryPriceUsd || 0).toFixed(6)} | $${(t.exitPriceUsd || 0).toFixed(6)} |`
).join('\n')}

---

## Strategy Recommendations

### Replicable Elements
1. **Entry Timing**: Focus on ${timingAnalysis.peakTradingHour !== undefined ? `${timingAnalysis.peakTradingHour}:00 UTC` : 'peak hours'} on ${timingAnalysis.peakTradingDay || 'active days'}
2. **Token Selection**: Target tokens with $${tokenSelection.preferredMcapRange?.avg.toFixed(0).toLocaleString() || 'moderate'} market cap
3. **Hold Time**: ${patterns.tradingStyle || 'Match the trading style'} with avg ${this.formatDuration(performance.avg_hold_time_seconds || 0)} holds
4. **Profit Target**: Aim for ~${(exitAnalysis.avgProfitTarget || 0).toFixed(0)}% gains
5. **Stop Loss**: Set at ~${Math.abs(exitAnalysis.avgStopLoss || 0).toFixed(0)}% loss

### Key Success Factors
- High win rate (${((performance.win_rate || 0) * 100).toFixed(0)}%) indicates strong token selection
- ${patterns.consistency} consistency suggests reliable methodology
- ${patterns.riskProfile} approach with controlled losses

### Implementation Difficulty
**Medium** - Requires:
- Fast transaction execution
- Real-time market data monitoring
- Disciplined exit strategy
- Capital for ${performance.total_trades || 0}+ trades

---

## Risk Warnings

⚠️ **Past performance does not guarantee future results**
- Market conditions change rapidly
- This wallet may have insider information
- Replication requires significant capital and speed
- High-frequency trading has substantial risks

---

*Report generated by Wallet Analyzer v1.0*  
*Analysis Period: ${wallet.discovered_at ? format(new Date(wallet.discovered_at), 'MMM dd, yyyy') : 'N/A'} - ${format(new Date(), 'MMM dd, yyyy')}*
`;
  }
  
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    return `${(seconds / 86400).toFixed(1)}d`;
  }
}

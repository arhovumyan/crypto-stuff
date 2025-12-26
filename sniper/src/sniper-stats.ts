/**
 * Sniper Statistics and Monitoring
 * Tracks performance metrics and system health
 */

import { createLogger } from '@copytrader/shared';

const log = createLogger('sniper-stats');

export interface TradeStats {
  signature: string;
  tokenMint: string;
  action: 'buy' | 'sell';
  amountSOL: number;
  success: boolean;
  timestamp: number;
  reason?: string;
}

export interface GateRejection {
  tokenMint: string;
  gate: string;
  reason: string;
  timestamp: number;
}

export class SniperStats {
  private startTime: number = Date.now();
  private launches: number = 0;
  private gateRejections: GateRejection[] = [];
  private trades: TradeStats[] = [];
  private positions: number = 0;
  private wins: number = 0;
  private losses: number = 0;
  private totalPnL: number = 0;

  constructor() {
    log.info('📈 Statistics tracking initialized');
  }

  /**
   * Record a new launch detected
   */
  recordLaunch(): void {
    this.launches++;
  }

  /**
   * Record a gate rejection
   */
  recordRejection(rejection: GateRejection): void {
    this.gateRejections.push(rejection);
    
    log.info('📋 Gate rejection logged', {
      gate: rejection.gate,
      reason: rejection.reason,
      mint: rejection.tokenMint.slice(0, 8) + '...'
    });
  }

  /**
   * Record a trade
   */
  recordTrade(trade: TradeStats): void {
    this.trades.push(trade);

    if (trade.action === 'buy' && trade.success) {
      this.positions++;
    }

    log.info('💼 Trade recorded', {
      action: trade.action,
      success: trade.success,
      amountSOL: trade.amountSOL
    });
  }

  /**
   * Record position close
   */
  recordPositionClose(pnl: number): void {
    this.totalPnL += pnl;
    
    if (pnl > 0) {
      this.wins++;
    } else {
      this.losses++;
    }

    this.positions = Math.max(0, this.positions - 1);
  }

  /**
   * Get total launches detected
   */
  getTotalLaunches(): number {
    return this.launches;
  }

  /**
   * Get total rejections count
   */
  getTotalRejections(): number {
    return this.gateRejections.length;
  }

  /**
   * Get rejection breakdown by gate
   */
  getRejectionBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    
    for (const rejection of this.gateRejections) {
      breakdown[rejection.gate] = (breakdown[rejection.gate] || 0) + 1;
    }
    
    return breakdown;
  }

  /**
   * Get statistics summary
   */
  getSummary(): string {
    const uptime = ((Date.now() - this.startTime) / 1000 / 60).toFixed(1);
    const touchRate = this.launches > 0 ? ((this.trades.filter(t => t.action === 'buy').length / this.launches) * 100).toFixed(2) : '0.00';
    const winRate = (this.wins + this.losses) > 0 ? ((this.wins / (this.wins + this.losses)) * 100).toFixed(2) : '0.00';
    const rejectionBreakdown = this.getRejectionBreakdown();

    let summary = `
╔════════════════════════════════════════════════════════╗
║            SNIPER PERFORMANCE SUMMARY                  ║
╠════════════════════════════════════════════════════════╣
║ Uptime:              ${uptime} minutes                        
║ Launches Detected:   ${this.launches}                         
║ Total Rejections:    ${this.gateRejections.length}                         
║ Touch Rate:          ${touchRate}%                       
║                                                        ║
║ Positions Opened:    ${this.trades.filter(t => t.action === 'buy' && t.success).length}                         
║ Active Positions:    ${this.positions}                         
║ Wins:                ${this.wins}                         
║ Losses:              ${this.losses}                         
║ Win Rate:            ${winRate}%                       
║ Total PnL:           ${this.totalPnL >= 0 ? '+' : ''}${this.totalPnL.toFixed(4)} SOL                  
╠════════════════════════════════════════════════════════╣
║ GATE REJECTION BREAKDOWN                               ║
╠════════════════════════════════════════════════════════╣`;

    for (const [gate, count] of Object.entries(rejectionBreakdown).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / this.gateRejections.length) * 100).toFixed(1);
      summary += `\n║ Gate ${gate}:              ${count} (${pct}%)                    `;
    }

    summary += `
╚════════════════════════════════════════════════════════╝
    `.trim();

    return summary;
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    console.log('\n' + this.getSummary() + '\n');
  }

  /**
   * Get recent rejections
   */
  getRecentRejections(limit: number = 10): GateRejection[] {
    return this.gateRejections.slice(-limit);
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit: number = 10): TradeStats[] {
    return this.trades.slice(-limit);
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.startTime = Date.now();
    this.launches = 0;
    this.gateRejections = [];
    this.trades = [];
    this.positions = 0;
    this.wins = 0;
    this.losses = 0;
    this.totalPnL = 0;
    
    log.info('📊 Statistics reset');
  }
}

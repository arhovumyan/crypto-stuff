/**
 * Virtual Portfolio
 * Manages simulated capital, positions, and P&L tracking
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger.js';
import { VirtualPortfolio, VirtualPosition, FillResult } from './types.js';

const log = createLogger('virtual-portfolio');

export class VirtualPortfolioManager extends EventEmitter {
  private portfolio: VirtualPortfolio;
  private config: {
    startingCapitalSOL: number;
    maxPositionSizeSOL: number;
    maxConcurrentPositions: number;
    riskPerTradePct: number;
  };

  constructor(config: {
    startingCapitalSOL: number;
    maxPositionSizeSOL: number;
    maxConcurrentPositions: number;
    riskPerTradePct: number;
  }) {
    super();
    this.config = config;
    
    // Initialize portfolio
    this.portfolio = {
      startingCapitalSOL: config.startingCapitalSOL,
      currentCapitalSOL: config.startingCapitalSOL,
      peakCapitalSOL: config.startingCapitalSOL,
      realizedPnLSOL: 0,
      unrealizedPnLSOL: 0,
      maxDrawdownSOL: 0,
      maxDrawdownPct: 0,
      openPositions: [],
      closedPositions: [],
      dailyPnL: new Map(),
      weeklyPnL: new Map(),
    };

    log.info('Virtual portfolio initialized', {
      startingCapital: config.startingCapitalSOL + ' SOL',
      maxPositionSize: config.maxPositionSizeSOL + ' SOL',
      maxPositions: config.maxConcurrentPositions,
      riskPerTrade: config.riskPerTradePct + '%',
    });
  }

  /**
   * Open a new position
   */
  async openPosition(
    tokenMint: string,
    poolAddress: string,
    entrySlot: number,
    fillResult: FillResult,
    amountSOL: number
  ): Promise<VirtualPosition | null> {
    // Check if we can open a new position
    if (this.portfolio.openPositions.length >= this.config.maxConcurrentPositions) {
      log.warn('Cannot open position - max concurrent positions reached', {
        current: this.portfolio.openPositions.length,
        max: this.config.maxConcurrentPositions,
      });
      return null;
    }

    // Check if we have enough capital
    const requiredCapital = amountSOL + fillResult.feesSOL;
    if (requiredCapital > this.portfolio.currentCapitalSOL) {
      log.warn('Cannot open position - insufficient capital', {
        required: requiredCapital,
        available: this.portfolio.currentCapitalSOL,
      });
      return null;
    }

    // Create position
    const position: VirtualPosition = {
      positionId: `${tokenMint.slice(0, 8)}_${entrySlot}`,
      tokenMint,
      poolAddress,
      entrySlot,
      entryPrice: fillResult.fillPrice,
      entryAmountSOL: amountSOL,
      entryAmountTokens: amountSOL / fillResult.fillPrice,
    };

    // Deduct capital
    this.portfolio.currentCapitalSOL -= requiredCapital;
    
    // Add to open positions
    this.portfolio.openPositions.push(position);

    log.info('✅ Position opened', {
      positionId: position.positionId,
      token: tokenMint.slice(0, 8) + '...',
      entryPrice: fillResult.fillPrice.toFixed(8) + ' SOL',
      amountSOL: amountSOL.toFixed(4),
      tokens: position.entryAmountTokens.toFixed(2),
      fees: fillResult.feesSOL.toFixed(6) + ' SOL',
    });

    this.emit('positionOpened', position);
    return position;
  }

  /**
   * Update position with current price (for MAE/MFE tracking)
   */
  updatePosition(
    positionId: string,
    currentPrice: number
  ): void {
    const position = this.portfolio.openPositions.find(p => p.positionId === positionId);
    if (!position) return;

    position.currentPrice = currentPrice;
    position.currentValueSOL = position.entryAmountTokens * currentPrice;
    position.unrealizedPnLSOL = position.currentValueSOL - position.entryAmountSOL;
    position.unrealizedPnLPct = (position.unrealizedPnLSOL / position.entryAmountSOL) * 100;

    // Update MAE (Maximum Adverse Excursion) - worst drawdown
    if (!position.mae || position.unrealizedPnLSOL < position.mae) {
      position.mae = position.unrealizedPnLSOL;
      position.maePct = position.unrealizedPnLPct;
    }

    // Update MFE (Maximum Favorable Excursion) - best profit
    if (!position.mfe || position.unrealizedPnLSOL > position.mfe) {
      position.mfe = position.unrealizedPnLSOL;
      position.mfePct = position.unrealizedPnLPct;
    }

    // Update portfolio unrealized P&L
    this.updateUnrealizedPnL();
  }

  /**
   * Close a position
   */
  async closePosition(
    positionId: string,
    exitSlot: number,
    exitReason: string,
    fillResult: FillResult
  ): Promise<VirtualPosition | null> {
    const index = this.portfolio.openPositions.findIndex(p => p.positionId === positionId);
    if (index === -1) {
      log.warn('Position not found', { positionId });
      return null;
    }

    const position = this.portfolio.openPositions[index];

    // Update position with exit details
    position.exitSlot = exitSlot;
    position.exitPrice = fillResult.fillPrice;
    position.exitReason = exitReason;
    
    // Calculate final P&L
    const exitValueSOL = position.entryAmountTokens * fillResult.fillPrice;
    position.pnlSOL = exitValueSOL - position.entryAmountSOL - fillResult.feesSOL;
    position.pnlPct = (position.pnlSOL / position.entryAmountSOL) * 100;
    
    // Calculate holding time
    position.holdingTimeSlots = exitSlot - position.entrySlot;

    // Ensure MAE/MFE are set
    position.mae = position.mae || position.pnlSOL;
    position.mfe = position.mfe || position.pnlSOL;
    position.maePct = position.maePct || position.pnlPct;
    position.mfePct = position.mfePct || position.pnlPct;

    // Return capital + P&L
    this.portfolio.currentCapitalSOL += position.entryAmountSOL + position.pnlSOL;
    this.portfolio.realizedPnLSOL += position.pnlSOL;

    // Update peak and drawdown
    if (this.portfolio.currentCapitalSOL > this.portfolio.peakCapitalSOL) {
      this.portfolio.peakCapitalSOL = this.portfolio.currentCapitalSOL;
    }
    
    const drawdownSOL = this.portfolio.peakCapitalSOL - this.portfolio.currentCapitalSOL;
    const drawdownPct = (drawdownSOL / this.portfolio.peakCapitalSOL) * 100;
    
    if (drawdownSOL > this.portfolio.maxDrawdownSOL) {
      this.portfolio.maxDrawdownSOL = drawdownSOL;
      this.portfolio.maxDrawdownPct = drawdownPct;
    }

    // Remove from open positions
    this.portfolio.openPositions.splice(index, 1);
    
    // Add to closed positions
    this.portfolio.closedPositions.push(position);

    // Update unrealized P&L
    this.updateUnrealizedPnL();

    log.info('🔒 Position closed', {
      positionId: position.positionId,
      exitReason,
      entryPrice: position.entryPrice.toFixed(8),
      exitPrice: position.exitPrice.toFixed(8),
      pnlSOL: position.pnlSOL.toFixed(4) + ' SOL',
      pnlPct: position.pnlPct.toFixed(2) + '%',
      holdingSlots: position.holdingTimeSlots,
      mae: position.maePct.toFixed(2) + '%',
      mfe: position.mfePct.toFixed(2) + '%',
    });

    this.emit('positionClosed', position);
    return position;
  }

  /**
   * Update unrealized P&L
   */
  private updateUnrealizedPnL(): void {
    this.portfolio.unrealizedPnLSOL = this.portfolio.openPositions.reduce(
      (sum, pos) => sum + (pos.unrealizedPnLSOL || 0),
      0
    );
  }

  /**
   * Get current portfolio state
   */
  getPortfolio(): VirtualPortfolio {
    return { ...this.portfolio };
  }

  /**
   * Get current drawdown
   */
  getCurrentDrawdown(): { drawdownSOL: number; drawdownPct: number } {
    const drawdownSOL = this.portfolio.peakCapitalSOL - this.portfolio.currentCapitalSOL;
    const drawdownPct = (drawdownSOL / this.portfolio.peakCapitalSOL) * 100;
    return { drawdownSOL, drawdownPct };
  }

  /**
   * Check if we can open a new position (capital governor)
   */
  canOpenPosition(amountSOL: number): boolean {
    // Check concurrent positions limit
    if (this.portfolio.openPositions.length >= this.config.maxConcurrentPositions) {
      return false;
    }

    // Check position size limit
    if (amountSOL > this.config.maxPositionSizeSOL) {
      return false;
    }

    // Check available capital
    if (amountSOL > this.portfolio.currentCapitalSOL) {
      return false;
    }

    // Check risk per trade (simple version)
    const maxRiskSOL = this.portfolio.currentCapitalSOL * (this.config.riskPerTradePct / 100);
    if (amountSOL > maxRiskSOL) {
      return false;
    }

    return true;
  }

  /**
   * Get portfolio stats
   */
  getStats(): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnLSOL: number;
    avgWinSOL: number;
    avgLossSOL: number;
    expectancy: number;
  } {
    const closedTrades = this.portfolio.closedPositions;
    const winningTrades = closedTrades.filter(p => p.pnlSOL && p.pnlSOL > 0);
    const losingTrades = closedTrades.filter(p => p.pnlSOL && p.pnlSOL <= 0);

    const totalWinSOL = winningTrades.reduce((sum, p) => sum + (p.pnlSOL || 0), 0);
    const totalLossSOL = losingTrades.reduce((sum, p) => sum + (p.pnlSOL || 0), 0);

    const avgWinSOL = winningTrades.length > 0 ? totalWinSOL / winningTrades.length : 0;
    const avgLossSOL = losingTrades.length > 0 ? totalLossSOL / losingTrades.length : 0;

    const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;
    const lossRate = 1 - winRate;

    const expectancy = (winRate * avgWinSOL) - (lossRate * Math.abs(avgLossSOL));

    return {
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalPnLSOL: this.portfolio.realizedPnLSOL,
      avgWinSOL,
      avgLossSOL,
      expectancy,
    };
  }
}


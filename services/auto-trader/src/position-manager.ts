/**
 * Position Manager
 * Manages open positions and monitors for 2x profit target
 */

import { config } from './config';
import { Logger } from './logger';
import { JupiterExecutor } from './jupiter-executor';
import { DexScreenerAPI } from './dexscreener';

export interface Position {
  tokenMint: string;
  entryPrice: number;
  entryTime: Date;
  solInvested: number;
  tokensOwned: number;
  targetPrice: number;
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private dexScreener: DexScreenerAPI;
  private executor: JupiterExecutor;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(executor: JupiterExecutor) {
    this.executor = executor;
    this.dexScreener = new DexScreenerAPI();
  }

  /**
   * Open a new position
   */
  async openPosition(tokenMint: string, solAmount: number): Promise<boolean> {
    try {
      // Get current price
      const tokenData = await this.dexScreener.getTokenData(tokenMint);
      if (!tokenData) {
        Logger.error('Cannot open position: no price data');
        return false;
      }

      const entryPrice = tokenData.priceUsd;
      const targetPrice = entryPrice * config.profitTargetMultiplier;

      // Execute buy
      const result = await this.executor.buyToken(tokenMint, solAmount);

      if (!result.success) {
        Logger.error(`Buy failed: ${result.error}`);
        return false;
      }

      // Create position
      const position: Position = {
        tokenMint,
        entryPrice,
        entryTime: new Date(),
        solInvested: solAmount,
        tokensOwned: result.outputAmount || 0,
        targetPrice,
      };

      this.positions.set(tokenMint, position);

      Logger.info(`Position opened: ${tokenMint}`);
      Logger.info(`Entry Price: $${entryPrice.toFixed(8)}`);
      Logger.info(`Target Price: $${targetPrice.toFixed(8)} (${config.profitTargetMultiplier}x)`);

      // Start monitoring if not already running
      if (!this.monitoringInterval) {
        this.startMonitoring();
      }

      return true;

    } catch (error: any) {
      Logger.error('Failed to open position', error);
      return false;
    }
  }

  /**
   * Start monitoring all positions
   */
  private startMonitoring(): void {
    Logger.system('Starting position monitoring (checking every second)');

    this.monitoringInterval = setInterval(async () => {
      await this.checkPositions();
    }, config.positionCheckIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Check all positions for profit target
   */
  private async checkPositions(): Promise<void> {
    if (this.positions.size === 0) return;

    for (const [tokenMint, position] of this.positions.entries()) {
      await this.checkPosition(tokenMint, position);
    }
  }

  /**
   * Check a single position
   */
  private async checkPosition(tokenMint: string, position: Position): Promise<void> {
    try {
      // Get current price
      const tokenData = await this.dexScreener.getTokenData(tokenMint);
      if (!tokenData) {
        Logger.debug(`No price data for ${tokenMint}`);
        return;
      }

      const currentPrice = tokenData.priceUsd;
      const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Log position check
      Logger.positionCheck(tokenMint, position.entryPrice, currentPrice, profitPercent);

      // Check if target reached
      if (currentPrice >= position.targetPrice) {
        await this.sellPosition(tokenMint, position, currentPrice);
      }

    } catch (error: any) {
      Logger.debug(`Error checking position ${tokenMint}: ${error.message}`);
    }
  }

  /**
   * Sell a position
   */
  private async sellPosition(tokenMint: string, position: Position, currentPrice: number): Promise<void> {
    try {
      const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      Logger.sellAttempt(tokenMint, profitPercent);

      // Get actual token balance (in case it's different)
      const tokenBalance = await this.executor.getTokenBalance(tokenMint);
      const tokensToSell = tokenBalance > 0 ? tokenBalance : position.tokensOwned;

      if (tokensToSell === 0) {
        Logger.error('No tokens to sell!');
        this.positions.delete(tokenMint);
        return;
      }

      // Execute sell
      const result = await this.executor.sellToken(tokenMint, tokensToSell);

      if (!result.success) {
        Logger.error(`Sell failed: ${result.error}`);
        return;
      }

      const solReceived = result.outputAmount || 0;
      const profitSol = solReceived - position.solInvested;

      Logger.sellSuccess(tokenMint, solReceived, profitSol, result.signature || 'N/A');

      // Remove position
      this.positions.delete(tokenMint);

      // Stop monitoring if no more positions
      if (this.positions.size === 0) {
        this.stopMonitoring();
      }

    } catch (error: any) {
      Logger.error('Failed to sell position', error);
    }
  }

  /**
   * Get all active positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if we have a position for this token
   */
  hasPosition(tokenMint: string): boolean {
    return this.positions.has(tokenMint);
  }
}

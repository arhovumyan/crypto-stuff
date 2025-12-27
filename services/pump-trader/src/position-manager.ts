/**
 * Position Manager
 * Tracks open positions and monitors for profit targets
 */

import { config } from './config';
import { Logger } from './logger';
import { JupiterExecutor } from './jupiter-executor';

export interface Position {
  mint: string;
  entryTime: Date;
  solInvested: number;
  tokenBalance: number;
  tokenDecimals: number;
  entrySignature: string;
  ath: number; // Highest SOL value seen
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private executor: JupiterExecutor;
  private monitoring: boolean = false;

  constructor(executor: JupiterExecutor) {
    this.executor = executor;
  }

  /**
   * Open a new position
   */
  async openPosition(mint: string, solAmount: number): Promise<boolean> {
    try {
      // Execute buy
      const result = await this.executor.buyToken(mint, solAmount);

      if (!result.success) {
        Logger.buyFailed(mint, result.error || 'Unknown error');
        return false;
      }

      // Calculate token balance received
      const tokenBalance = parseFloat(result.outputAmount || '0') / Math.pow(10, 9);

      const position: Position = {
        mint,
        entryTime: new Date(),
        solInvested: solAmount,
        tokenBalance,
        tokenDecimals: 9,
        entrySignature: result.signature || '',
        ath: solAmount, // ATH starts at entry value
      };

      this.positions.set(mint, position);

      Logger.buyExecuted(
        mint,
        solAmount,
        result.outputAmount || 'unknown',
        result.signature || 'unknown'
      );

      // Start monitoring if not already running
      if (!this.monitoring) {
        this.startMonitoring();
      }

      return true;

    } catch (error: any) {
      Logger.buyFailed(mint, error.message);
      return false;
    }
  }

  /**
   * Start monitoring all positions
   */
  private startMonitoring(): void {
    if (this.monitoring) return;

    this.monitoring = true;

    const monitorLoop = setInterval(async () => {
      if (this.positions.size === 0) {
        // No positions, but keep monitoring in case new ones are added
        return;
      }

      for (const [mint, position] of this.positions.entries()) {
        await this.checkPosition(mint, position);
      }

    }, config.pollIntervalMs);

    // Store interval ID for cleanup
    (this as any).monitorInterval = monitorLoop;
  }

  /**
   * Check a single position for profit target
   */
  private async checkPosition(mint: string, position: Position): Promise<void> {
    try {
      // Get current value in SOL
      const currentValue = await this.executor.getPositionValue(
        mint,
        position.tokenBalance,
        position.tokenDecimals
      );

      if (currentValue === null) {
        Logger.debug(`Could not get quote for position ${mint} - will retry`);
        return;
      }

      // Update ATH
      if (currentValue > position.ath) {
        position.ath = currentValue;
      }

      const profitMultiplier = currentValue / position.solInvested;
      const profitPercent = ((currentValue - position.solInvested) / position.solInvested) * 100;

      Logger.positionCheck(
        mint,
        currentValue,
        position.solInvested,
        profitPercent,
        config.profitTargetMultiplier
      );

      // Check if profit target reached
      if (profitMultiplier >= config.profitTargetMultiplier) {
        Logger.profitTargetReached(
          mint,
          position.solInvested,
          currentValue,
          profitPercent
        );

        await this.closePosition(mint, position, currentValue);
      }

    } catch (error: any) {
      Logger.error(`Error checking position ${mint}`, error);
    }
  }

  /**
   * Close a position by selling
   */
  private async closePosition(mint: string, position: Position, estimatedValue: number): Promise<void> {
    try {
      const result = await this.executor.sellToken(
        mint,
        position.tokenBalance,
        position.tokenDecimals
      );

      if (!result.success) {
        Logger.sellFailed(mint, result.error || 'Unknown error');
        return; // Will retry on next check
      }

      const solReceived = parseFloat(result.outputAmount || '0') / Math.pow(10, 9);
      const profit = solReceived - position.solInvested;

      Logger.sellExecuted(
        mint,
        result.inputAmount || 'unknown',
        solReceived,
        position.solInvested,
        profit,
        result.signature || 'unknown'
      );

      // Remove position
      this.positions.delete(mint);

    } catch (error: any) {
      Logger.error(`Error closing position ${mint}`, error);
    }
  }

  /**
   * Get all open positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if a position exists
   */
  hasPosition(mint: string): boolean {
    return this.positions.has(mint);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if ((this as any).monitorInterval) {
      clearInterval((this as any).monitorInterval);
    }
    this.monitoring = false;
  }
}

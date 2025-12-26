/**
 * Position Manager
 * Tracks positions and manages exit strategy with multi-level take profits
 */

import { Connection, Keypair } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import { ExecutionEngine } from './execution-engine.js';
import { JupiterService } from '@copytrader/shared';

const log = createLogger('position-manager');

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export interface PositionConfig {
  // Take profit levels
  takeProfit1Pct: number; // % of position to sell
  takeProfit1At: number;  // % gain to trigger
  takeProfit2Pct: number;
  takeProfit2At: number;
  
  // Stop losses
  stopLossPct: number;
  
  // Time-based stops
  timeStopMinutes: number;
  timeStopMinGainPct: number;
}

export interface Position {
  tokenMint: string;
  entryPrice: number; // SOL per token
  currentPrice: number;
  totalTokens: number;
  remainingTokens: number;
  investedSOL: number;
  currentValueSOL: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  
  // Entry details
  entryTime: number;
  entrySignature: string;
  
  // Exit tracking
  takeProfitsHit: Set<number>;
  highestPrice: number;
  
  // Status
  isActive: boolean;
  exitReason?: string;
}

export class PositionManager {
  // private connection: Connection; // Unused - kept for potential future use
  private executor: ExecutionEngine;
  private jupiter: JupiterService;
  private config: PositionConfig;
  private positions: Map<string, Position> = new Map();
  private isMonitoring = false;

  constructor(
    _connection: Connection,
    executor: ExecutionEngine,
    config: PositionConfig
  ) {
    // this.connection = connection; // Unused field assignment
    this.executor = executor;
    this.jupiter = JupiterService.getInstance();
    this.config = config;
  }

  /**
   * Open a new position
   */
  async openPosition(
    tokenMint: string,
    amountTokens: number,
    investedSOL: number,
    entrySignature: string
  ): Promise<void> {
    const entryPrice = investedSOL / amountTokens;
    
    const position: Position = {
      tokenMint,
      entryPrice,
      currentPrice: entryPrice,
      totalTokens: amountTokens,
      remainingTokens: amountTokens,
      investedSOL,
      currentValueSOL: investedSOL,
      unrealizedPnL: 0,
      unrealizedPnLPct: 0,
      entryTime: Date.now(),
      entrySignature,
      takeProfitsHit: new Set(),
      highestPrice: entryPrice,
      isActive: true
    };

    this.positions.set(tokenMint, position);

    log.info('📊 Position opened', {
      tokenMint,
      amountTokens,
      investedSOL,
      entryPrice
    });

    // Start monitoring if not already
    if (!this.isMonitoring) {
      this.startMonitoring();
    }
  }

  /**
   * Start monitoring positions for exits
   */
  private startMonitoring(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    log.info('👀 Starting position monitoring');

    this.monitoringLoop();
  }

  /**
   * Main monitoring loop
   */
  private async monitoringLoop(): Promise<void> {
    while (this.isMonitoring) {
      try {
        for (const [mint, position] of this.positions) {
          if (!position.isActive) continue;

          await this.updatePosition(mint);
          await this.checkExitConditions(mint);
        }

        await this.sleep(2000); // Check every 2 seconds
      } catch (error) {
        log.error('Error in monitoring loop', { error });
        await this.sleep(5000);
      }
    }
  }

  /**
   * Update position with current price
   */
  private async updatePosition(mint: string): Promise<void> {
    const position = this.positions.get(mint);
    if (!position) return;

    try {
      // Get current price via Jupiter quote
      const quote = await this.jupiter.getQuote({
        inputMint: mint,
        outputMint: NATIVE_SOL,
        amount: Math.floor(position.remainingTokens),
        slippageBps: 100,
        userPublicKey: 'dummy' // We just need a price quote
      });

      if (!quote) {
        log.warn('Could not get price quote', { mint });
        return;
      }

      const currentValueSOL = parseInt(quote.outAmount) / 1e9;
      const currentPrice = currentValueSOL / position.remainingTokens;

      position.currentPrice = currentPrice;
      position.currentValueSOL = currentValueSOL;
      position.unrealizedPnL = currentValueSOL - (position.investedSOL * (position.remainingTokens / position.totalTokens));
      position.unrealizedPnLPct = (position.unrealizedPnL / (position.investedSOL * (position.remainingTokens / position.totalTokens))) * 100;

      // Update highest price for trailing stop
      if (currentPrice > position.highestPrice) {
        position.highestPrice = currentPrice;
      }

      this.positions.set(mint, position);
    } catch (error) {
      log.error('Error updating position', { mint, error });
    }
  }

  /**
   * Check exit conditions and execute if needed
   */
  private async checkExitConditions(mint: string): Promise<void> {
    const position = this.positions.get(mint);
    if (!position || !position.isActive) return;

    const gainPct = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const elapsedMinutes = (Date.now() - position.entryTime) / 1000 / 60;

    // Check stop loss
    if (gainPct <= -this.config.stopLossPct) {
      log.warn('🛑 Stop loss triggered', {
        mint,
        gainPct: gainPct.toFixed(2),
        stopLoss: this.config.stopLossPct
      });
      await this.exitPosition(mint, 100, 'stop_loss');
      return;
    }

    // Check time stop
    if (elapsedMinutes >= this.config.timeStopMinutes && gainPct < this.config.timeStopMinGainPct) {
      log.warn('⏰ Time stop triggered', {
        mint,
        elapsedMinutes: elapsedMinutes.toFixed(1),
        gainPct: gainPct.toFixed(2)
      });
      await this.exitPosition(mint, 100, 'time_stop');
      return;
    }

    // Check take profit 1
    if (gainPct >= this.config.takeProfit1At && !position.takeProfitsHit.has(1)) {
      log.info('💰 Take profit 1 triggered', {
        mint,
        gainPct: gainPct.toFixed(2),
        target: this.config.takeProfit1At
      });
      await this.exitPosition(mint, this.config.takeProfit1Pct, 'take_profit_1');
      position.takeProfitsHit.add(1);
      return;
    }

    // Check take profit 2
    if (gainPct >= this.config.takeProfit2At && !position.takeProfitsHit.has(2)) {
      log.info('💰 Take profit 2 triggered', {
        mint,
        gainPct: gainPct.toFixed(2),
        target: this.config.takeProfit2At
      });
      await this.exitPosition(mint, this.config.takeProfit2Pct, 'take_profit_2');
      position.takeProfitsHit.add(2);
      return;
    }

    // Trailing stop for remaining position (after both TPs hit)
    if (position.takeProfitsHit.has(1) && position.takeProfitsHit.has(2)) {
      const trailingPct = ((position.highestPrice - position.currentPrice) / position.highestPrice) * 100;
      
      if (trailingPct >= 15) { // 15% trailing stop
        log.info('📉 Trailing stop triggered', {
          mint,
          trailingPct: trailingPct.toFixed(2)
        });
        await this.exitPosition(mint, 100, 'trailing_stop');
        return;
      }
    }
  }

  /**
   * Exit a position (partial or full)
   */
  private async exitPosition(
    mint: string,
    percentToSell: number,
    reason: string,
    signer?: Keypair
  ): Promise<boolean> {
    const position = this.positions.get(mint);
    if (!position || !position.isActive) return false;

    if (!signer) {
      log.error('Cannot exit position without signer');
      return false;
    }

    try {
      const tokensToSell = Math.floor((position.remainingTokens * percentToSell) / 100);
      
      log.info('🔻 Exiting position', {
        mint,
        percentToSell,
        tokensToSell,
        reason
      });

      const result = await this.executor.executeSell(
        mint,
        tokensToSell.toString(),
        300, // 3% slippage
        signer
      );

      if (result.success) {
        position.remainingTokens -= tokensToSell;

        if (position.remainingTokens < 1 || percentToSell === 100) {
          position.isActive = false;
          position.exitReason = reason;
          
          log.info('✅ Position fully closed', {
            mint,
            reason,
            signature: result.signature
          });
        } else {
          log.info('✅ Partial exit successful', {
            mint,
            remaining: position.remainingTokens,
            signature: result.signature
          });
        }

        this.positions.set(mint, position);
        return true;
      } else {
        log.error('Failed to exit position', {
          mint,
          error: result.error
        });
        return false;
      }
    } catch (error) {
      log.error('Error exiting position', {
        mint,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Emergency exit - liquidate immediately with high slippage
   */
  async emergencyExit(mint: string, reason: string, signer: Keypair): Promise<void> {
    const position = this.positions.get(mint);
    if (!position || !position.isActive) return;

    log.warn('🚨 EMERGENCY EXIT', {
      mint,
      reason
    });

    try {
      const result = await this.executor.emergencySell(
        mint,
        Math.floor(position.remainingTokens).toString(),
        signer
      );

      if (result.success) {
        position.isActive = false;
        position.exitReason = `emergency_${reason}`;
        this.positions.set(mint, position);

        log.info('✅ Emergency exit successful', {
          mint,
          signature: result.signature
        });
      }
    } catch (error) {
      log.error('Emergency exit failed', {
        mint,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get position by mint
   */
  getPosition(mint: string): Position | undefined {
    return this.positions.get(mint);
  }

  /**
   * Get all active positions
   */
  getActivePositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.isActive);
  }

  /**
   * Get all positions
   */
  getAllPositions(): Map<string, Position> {
    return this.positions;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    log.info('Stopping position monitoring');
    this.isMonitoring = false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get position summary
   */
  getPositionSummary(mint: string): string {
    const position = this.positions.get(mint);
    if (!position) return 'Position not found';

    const elapsed = ((Date.now() - position.entryTime) / 1000 / 60).toFixed(1);

    return `
📊 Position: ${mint.slice(0, 8)}...
Status: ${position.isActive ? '🟢 Active' : '🔴 Closed'}
Entry: ${position.entryPrice.toFixed(8)} SOL
Current: ${position.currentPrice.toFixed(8)} SOL
Tokens: ${position.remainingTokens.toFixed(2)} / ${position.totalTokens.toFixed(2)}
Value: ${position.currentValueSOL.toFixed(4)} SOL
PnL: ${position.unrealizedPnL >= 0 ? '+' : ''}${position.unrealizedPnL.toFixed(4)} SOL (${position.unrealizedPnLPct >= 0 ? '+' : ''}${position.unrealizedPnLPct.toFixed(2)}%)
Time: ${elapsed}m
TPs Hit: ${Array.from(position.takeProfitsHit).join(', ') || 'None'}
${position.exitReason ? `Exit: ${position.exitReason}` : ''}
    `.trim();
  }
}

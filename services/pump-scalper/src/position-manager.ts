/**
 * Position Manager
 * Manages open positions with profit targets and stop losses
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import axios from 'axios';

const log = createLogger('position-manager');

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export interface Position {
  tokenAddress: string;
  tokenSymbol?: string;
  entryPrice: number;
  entryTime: Date;
  amountTokens: number;
  amountSOL: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  signature: string;
}

export interface PositionUpdate {
  currentPrice: number;
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
  shouldSell: boolean;
  sellReason?: 'PROFIT_TARGET' | 'STOP_LOSS' | 'TIME_LIMIT';
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private connection: Connection;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Add a new position
   */
  addPosition(position: Position): void {
    this.positions.set(position.tokenAddress, position);
    
    log.info('');
    log.info('════════════════════════════════════════════════════');
    log.info('📊 NEW POSITION OPENED');
    log.info('════════════════════════════════════════════════════');
    log.info(`Token:        ${position.tokenSymbol || position.tokenAddress.slice(0, 8)}`);
    log.info(`Entry Price:  $${position.entryPrice.toFixed(8)}`);
    log.info(`Amount:       ${position.amountSOL.toFixed(4)} SOL`);
    log.info(`Target:       +${position.profitTargetPercent}%`);
    log.info(`Stop Loss:    -${position.stopLossPercent}%`);
    log.info(`Signature:    ${position.signature}`);
    log.info('════════════════════════════════════════════════════');
    log.info('');

    // Start monitoring if not already running
    if (!this.monitorInterval && this.positions.size > 0) {
      this.startMonitoring();
    }
  }

  /**
   * Start monitoring positions
   */
  private startMonitoring(): void {
    log.info('👁️  Starting position monitoring...');
    
    this.monitorInterval = setInterval(async () => {
      await this.checkAllPositions();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Check all positions
   */
  private async checkAllPositions(): Promise<void> {
    for (const [tokenAddress, position] of this.positions) {
      try {
        const update = await this.checkPosition(position);
        
        if (update.shouldSell) {
          this.onSellSignal(position, update);
        } else {
          // Log position status periodically
          const ageMinutes = (Date.now() - position.entryTime.getTime()) / 60000;
          if (ageMinutes % 1 < 0.1) { // Log roughly every minute
            this.logPositionStatus(position, update);
          }
        }
      } catch (error) {
        log.error(`Failed to check position ${tokenAddress.slice(0, 8)}... | ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Check individual position
   */
  private async checkPosition(position: Position): Promise<PositionUpdate> {
    // Get current price from DexScreener
    const currentPrice = await this.getCurrentPrice(position.tokenAddress);
    
    // Calculate P&L
    const currentValue = position.amountTokens * currentPrice;
    const profitLoss = currentValue - position.amountSOL;
    const profitLossPercent = (profitLoss / position.amountSOL) * 100;

    // Check exit conditions
    let shouldSell = false;
    let sellReason: PositionUpdate['sellReason'];

    // Profit target hit
    if (profitLossPercent >= position.profitTargetPercent) {
      shouldSell = true;
      sellReason = 'PROFIT_TARGET';
    }

    // Stop loss hit
    if (profitLossPercent <= -position.stopLossPercent) {
      shouldSell = true;
      sellReason = 'STOP_LOSS';
    }

    // Time limit (e.g., 10 minutes max hold)
    const ageMinutes = (Date.now() - position.entryTime.getTime()) / 60000;
    if (ageMinutes > 10) {
      shouldSell = true;
      sellReason = 'TIME_LIMIT';
    }

    return {
      currentPrice,
      currentValue,
      profitLoss,
      profitLossPercent,
      shouldSell,
      sellReason,
    };
  }

  /**
   * Get current price from DexScreener
   */
  private async getCurrentPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await axios.get(`${DEXSCREENER_API}/tokens/${tokenAddress}`, {
        timeout: 5000,
      });

      const pairs = response.data?.pairs || [];
      if (pairs.length > 0) {
        return parseFloat(pairs[0].priceUsd || '0');
      }
    } catch (error) {
      log.error(`Failed to get price for ${tokenAddress.slice(0, 8)}...`);
    }

    return 0;
  }

  /**
   * Handle sell signal
   */
  private onSellSignal(position: Position, update: PositionUpdate): void {
    log.info('');
    log.info('────────────────────────────────────────────────────────────────────────────────');
    log.info('════════════════════════════════════════════════════');
    
    if (update.sellReason === 'PROFIT_TARGET') {
      log.info('🎯 PROFIT TARGET HIT - SELL SIGNAL');
    } else if (update.sellReason === 'STOP_LOSS') {
      log.info('🛑 STOP LOSS HIT - SELL SIGNAL');
    } else {
      log.info('⏰ TIME LIMIT REACHED - SELL SIGNAL');
    }
    
    log.info('════════════════════════════════════════════════════');
    log.info(`Token:        ${position.tokenSymbol || position.tokenAddress.slice(0, 8)}`);
    log.info(`Entry Price:  $${position.entryPrice.toFixed(8)}`);
    log.info(`Exit Price:   $${update.currentPrice.toFixed(8)}`);
    log.info(`P&L:          ${update.profitLoss > 0 ? '+' : ''}$${update.profitLoss.toFixed(4)} (${update.profitLossPercent > 0 ? '+' : ''}${update.profitLossPercent.toFixed(2)}%)`);
    log.info(`Address:      ${position.tokenAddress}`);
    log.info('════════════════════════════════════════════════════');
    log.info('────────────────────────────────────────────────────────────────────────────────');
    log.info('');

    // Remove position (will be handled by auto-trader)
    this.positions.delete(position.tokenAddress);

    // Stop monitoring if no more positions
    if (this.positions.size === 0 && this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      log.info('👁️  Position monitoring stopped (no active positions)');
    }
  }

  /**
   * Log position status
   */
  private logPositionStatus(position: Position, update: PositionUpdate): void {
    const ageMinutes = (Date.now() - position.entryTime.getTime()) / 60000;
    const pnlColor = update.profitLossPercent >= 0 ? '+' : '';
    
    log.info(
      `📊 ${position.tokenSymbol || position.tokenAddress.slice(0, 8)} | ` +
      `P&L: ${pnlColor}${update.profitLossPercent.toFixed(2)}% | ` +
      `Price: $${update.currentPrice.toFixed(8)} | ` +
      `Age: ${ageMinutes.toFixed(1)}m`
    );
  }

  /**
   * Get all positions
   */
  getPositions(): Map<string, Position> {
    return this.positions;
  }

  /**
   * Get position by token address
   */
  getPosition(tokenAddress: string): Position | undefined {
    return this.positions.get(tokenAddress);
  }

  /**
   * Remove position
   */
  removePosition(tokenAddress: string): void {
    this.positions.delete(tokenAddress);
    
    if (this.positions.size === 0 && this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      log.info('👁️  Position monitoring stopped (no active positions)');
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    log.info('🛑 Position manager stopped');
  }
}

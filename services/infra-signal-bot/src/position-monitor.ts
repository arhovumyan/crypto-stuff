/**
 * Position Monitor
 * Tracks open positions and implements exit strategies
 * Monitors for infra behavior changes and price targets
 */

import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import pg from 'pg';
import axios from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';
import { 
  InfraPosition, 
  InfraSignal, 
  InfraSignalConfig,
  RawTrade 
} from './types.js';
import { TradeFeed } from './trade-feed.js';
import { AbsorptionDetector } from './absorption-detector.js';
import { StabilizationChecker } from './stabilization-checker.js';
import { EntryManager } from './entry-manager.js';

const log = createLogger('position-monitor');
const { Pool } = pg;

const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export class PositionMonitor extends EventEmitter {
  private connection: Connection;
  private tradeFeed: TradeFeed;
  private absorptionDetector: AbsorptionDetector;
  private stabilizationChecker: StabilizationChecker;
  private entryManager: EntryManager;
  private config: InfraSignalConfig;
  private db: pg.Pool;
  private keypair: Keypair | null = null;

  // Active positions
  private positions: Map<string, InfraPosition> = new Map();
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(
    connection: Connection,
    tradeFeed: TradeFeed,
    absorptionDetector: AbsorptionDetector,
    stabilizationChecker: StabilizationChecker,
    entryManager: EntryManager,
    config: InfraSignalConfig,
    dbConnectionString: string
  ) {
    super();
    this.connection = connection;
    this.tradeFeed = tradeFeed;
    this.absorptionDetector = absorptionDetector;
    this.stabilizationChecker = stabilizationChecker;
    this.entryManager = entryManager;
    this.config = config;
    this.db = new Pool({ connectionString: dbConnectionString });
  }

  /**
   * Initialize with keypair
   */
  setKeypair(keypair: Keypair): void {
    this.keypair = keypair;
  }

  /**
   * Start the position monitor
   */
  start(): void {
    log.info('Starting position monitor...', {
      takeProfitPct: this.config.takeProfitPct,
      stopLossPct: this.config.stopLossPct,
      checkIntervalMs: this.config.infraExitCheckMs,
    });

    // Listen for new entries from entry manager
    this.entryManager.on('entryExecuted', (data: {
      signal: InfraSignal;
      amountSOL: number;
      amountToken?: number;
      entryPrice: number;
      signature: string;
      isPaper: boolean;
    }) => {
      this.openPosition(data);
    });

    // Listen for trades to detect infra behavior changes
    this.tradeFeed.on('trade', (trade: RawTrade) => {
      this.checkInfraBehavior(trade);
    });

    // Periodically check positions
    this.monitorInterval = setInterval(() => {
      this.checkAllPositions();
    }, this.config.infraExitCheckMs);
  }

  /**
   * Open a new position
   */
  private async openPosition(data: {
    signal: InfraSignal;
    amountSOL: number;
    amountToken?: number;
    entryPrice: number;
    signature: string;
    isPaper: boolean;
  }): Promise<void> {
    const { signal, amountSOL, amountToken, entryPrice, signature } = data;

    const takeProfitPrice = entryPrice * (1 + this.config.takeProfitPct / 100);
    const stopLossPrice = entryPrice * (1 - this.config.stopLossPct / 100);

    const position: InfraPosition = {
      tokenMint: signal.tokenMint,
      signalId: signal.id || 0,
      entryPrice,
      entryAmountSOL: amountSOL,
      entryAmountToken: amountToken || amountSOL / entryPrice,
      entrySignature: signature,
      entryTime: new Date(),
      currentPrice: entryPrice,
      unrealizedPnlPct: 0,
      unrealizedPnlSOL: 0,
      takeProfitPrice,
      stopLossPrice,
      infraWallet: signal.infraWallet,
      lastInfraActivity: new Date(),
      status: 'open',
    };

    this.positions.set(signal.tokenMint, position);

    log.info('📍 POSITION OPENED', {
      token: signal.tokenMint.slice(0, 8) + '...',
      entryPrice: entryPrice.toFixed(8),
      amountSOL,
      takeProfitPrice: takeProfitPrice.toFixed(8),
      stopLossPrice: stopLossPrice.toFixed(8),
    });

    this.emit('positionOpened', position);
  }

  /**
   * Check infra wallet behavior on trades
   */
  private checkInfraBehavior(trade: RawTrade): void {
    const position = this.positions.get(trade.tokenMint);
    if (!position || position.status !== 'open') return;

    // Check if the infra wallet is selling
    if (position.infraWallet && trade.traderWallet === position.infraWallet) {
      if (trade.type === 'sell') {
        log.warn(`⚠️  Infra wallet selling on ${trade.tokenMint.slice(0, 8)}...`, {
          sellAmountSOL: trade.amountSOL.toFixed(4),
        });

        // If infra wallet sells significantly, consider exit
        if (trade.amountSOL > position.entryAmountSOL * 0.5) {
          log.warn(`🔴 INFRA EXIT SIGNAL - Large infra sell detected`);
          this.executeExit(position, 'infra_selling');
        }
      } else {
        // Update last activity time on buys
        position.lastInfraActivity = new Date();
      }
    }

    // Update current price
    if (trade.priceSOL) {
      position.currentPrice = trade.priceSOL;
      this.updatePnL(position);
    }
  }

  /**
   * Check all positions for exit signals
   */
  private async checkAllPositions(): Promise<void> {
    for (const [tokenMint, position] of this.positions) {
      if (position.status !== 'open') continue;

      try {
        // Get current price
        const currentPrice = this.stabilizationChecker.getCurrentPrice(tokenMint) ||
          await this.fetchCurrentPrice(tokenMint);

        if (!currentPrice) continue;

        position.currentPrice = currentPrice;
        this.updatePnL(position);

        // Check take profit
        if (currentPrice >= position.takeProfitPrice) {
          log.info(`🎯 TAKE PROFIT HIT for ${tokenMint.slice(0, 8)}...`, {
            currentPrice: currentPrice.toFixed(8),
            target: position.takeProfitPrice.toFixed(8),
            pnlPct: position.unrealizedPnlPct.toFixed(2) + '%',
          });
          await this.executeExit(position, 'take_profit');
          continue;
        }

        // Check stop loss
        if (currentPrice <= position.stopLossPrice) {
          log.warn(`🛑 STOP LOSS HIT for ${tokenMint.slice(0, 8)}...`, {
            currentPrice: currentPrice.toFixed(8),
            stopLoss: position.stopLossPrice.toFixed(8),
            pnlPct: position.unrealizedPnlPct.toFixed(2) + '%',
          });
          await this.executeExit(position, 'stop_loss');
          continue;
        }

        // Check infra inactivity
        if (position.infraWallet && position.lastInfraActivity) {
          const inactivityMs = Date.now() - position.lastInfraActivity.getTime();
          if (inactivityMs > 300000) { // 5 minutes
            log.warn(`⏰ Infra wallet inactive for ${(inactivityMs / 60000).toFixed(1)}min`);
            
            // If price is up, consider taking profit
            if (position.unrealizedPnlPct > 5) {
              log.info(`Taking profit due to infra inactivity with ${position.unrealizedPnlPct.toFixed(2)}% gain`);
              await this.executeExit(position, 'infra_inactive_profit');
            }
          }
        }

        // Trailing stop (if configured)
        if (this.config.trailingStopPct && position.unrealizedPnlPct > 10) {
          const trailingStopPrice = currentPrice * (1 - this.config.trailingStopPct / 100);
          if (trailingStopPrice > position.stopLossPrice) {
            position.stopLossPrice = trailingStopPrice;
            log.info(`📈 Trailing stop updated for ${tokenMint.slice(0, 8)}...`, {
              newStopLoss: trailingStopPrice.toFixed(8),
            });
          }
        }

      } catch (error) {
        log.error(`Error checking position ${tokenMint.slice(0, 8)}...: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Update position P&L
   */
  private updatePnL(position: InfraPosition): void {
    const pnlPct = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const pnlSOL = position.entryAmountSOL * (pnlPct / 100);

    position.unrealizedPnlPct = pnlPct;
    position.unrealizedPnlSOL = pnlSOL;
  }

  /**
   * Execute position exit (sell)
   */
  private async executeExit(position: InfraPosition, reason: string): Promise<void> {
    if (!this.keypair) {
      log.error('Cannot execute exit: keypair not set');
      return;
    }

    const tokenMint = position.tokenMint;

    try {
      log.info('💸 Executing SELL order', {
        token: tokenMint.slice(0, 8) + '...',
        reason,
        currentPrice: position.currentPrice.toFixed(8),
        pnlPct: position.unrealizedPnlPct.toFixed(2) + '%',
      });

      if (this.config.paperTradingMode) {
        // Paper trading - simulate execution
        position.status = reason === 'take_profit' ? 'take_profit' : 
                          reason === 'stop_loss' ? 'stopped_out' : 'closed';
        position.exitPrice = position.currentPrice;
        position.exitTime = new Date();
        position.exitReason = reason;
        position.realizedPnlPct = position.unrealizedPnlPct;
        position.realizedPnlSOL = position.unrealizedPnlSOL;

        log.info('📝 PAPER SELL EXECUTED', {
          token: tokenMint.slice(0, 8) + '...',
          exitPrice: position.exitPrice.toFixed(8),
          pnlPct: position.realizedPnlPct.toFixed(2) + '%',
          pnlSOL: position.realizedPnlSOL.toFixed(4),
        });

        this.positions.delete(tokenMint);
        this.entryManager.decrementPositionCount();
        
        // Record trade
        await this.recordExitTrade(position);
        
        this.emit('positionClosed', position);
        return;
      }

      // Live trading - execute sell
      const amountLamports = Math.floor(position.entryAmountToken * LAMPORTS_PER_SOL);

      const order = await this.getJupiterOrder(
        tokenMint,
        NATIVE_SOL,
        amountLamports,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        log.error('Failed to get Jupiter order for sell');
        return;
      }

      // Deserialize and sign
      const transactionBuf = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);

      // Execute
      const result = await this.executeJupiterTransaction(
        Buffer.from(transaction.serialize()).toString('base64'),
        order.requestId
      );

      if (!result || result.status !== 'Success') {
        log.error('Jupiter execution failed', { status: result?.status });
        return;
      }

      const exitAmountSOL = parseFloat(result.outputAmountResult || '0') / LAMPORTS_PER_SOL;

      position.status = reason === 'take_profit' ? 'take_profit' : 
                        reason === 'stop_loss' ? 'stopped_out' : 'closed';
      position.exitPrice = position.currentPrice;
      position.exitAmountSOL = exitAmountSOL;
      position.exitSignature = result.signature;
      position.exitTime = new Date();
      position.exitReason = reason;
      position.realizedPnlSOL = exitAmountSOL - position.entryAmountSOL;
      position.realizedPnlPct = (position.realizedPnlSOL / position.entryAmountSOL) * 100;

      log.info('🔴 LIVE SELL EXECUTED', {
        token: tokenMint.slice(0, 8) + '...',
        signature: result.signature,
        exitAmountSOL: exitAmountSOL.toFixed(4),
        pnlSOL: position.realizedPnlSOL.toFixed(4),
        pnlPct: position.realizedPnlPct.toFixed(2) + '%',
      });

      this.positions.delete(tokenMint);
      this.entryManager.decrementPositionCount();
      
      // Record trade
      await this.recordExitTrade(position);
      
      this.emit('positionClosed', position);

    } catch (error) {
      log.error(`Exit execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetch current price from DexScreener
   */
  private async fetchCurrentPrice(tokenMint: string): Promise<number | null> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { timeout: 5000 }
      );

      if (!response.data?.pairs?.[0]) return null;

      return parseFloat(response.data.pairs[0].priceNative || '0');
    } catch (error) {
      return null;
    }
  }

  /**
   * Get Jupiter order for sell
   */
  private async getJupiterOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    taker: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) throw new Error('JUPITER_API_KEY not found');

      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        taker,
      });

      const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order?${params}`, {
        headers: { 'x-api-key': apiKey },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Execute Jupiter transaction
   */
  private async executeJupiterTransaction(
    signedTransaction: string,
    requestId: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) throw new Error('JUPITER_API_KEY not found');

      const response = await axios.post(
        `${JUPITER_API_URL}/ultra/v1/execute`,
        { signedTransaction, requestId },
        {
          headers: { 'x-api-key': apiKey },
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Record exit trade to database
   */
  private async recordExitTrade(position: InfraPosition): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO infra_trades (
          signal_id, token_mint, action, reason,
          signature, amount_sol, price, status,
          entry_price, realized_pnl_sol, realized_pnl_pct, executed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          position.signalId,
          position.tokenMint,
          'sell',
          position.exitReason,
          position.exitSignature || 'PAPER_TRADE',
          position.exitAmountSOL || position.entryAmountSOL * (1 + (position.realizedPnlPct || 0) / 100),
          position.exitPrice,
          'success',
          position.entryPrice,
          position.realizedPnlSOL,
          position.realizedPnlPct,
        ]
      );

      // Update signal with exit info
      if (position.signalId) {
        await this.db.query(
          `UPDATE infra_signals SET
            exit_price = $1,
            pnl_pct = $2
          WHERE id = $3`,
          [position.exitPrice, position.realizedPnlPct, position.signalId]
        );
      }
    } catch (error) {
      log.error(`Failed to record exit trade: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): InfraPosition[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

  /**
   * Get position for a token
   */
  getPosition(tokenMint: string): InfraPosition | undefined {
    return this.positions.get(tokenMint);
  }

  /**
   * Stop the position monitor
   */
  stop(): void {
    log.info('Stopping position monitor...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.db.end();
  }

  /**
   * Get statistics
   */
  getStats(): {
    openPositions: number;
    totalPnlSOL: number;
    totalPnlPct: number;
  } {
    const openPositions = this.getOpenPositions();
    const totalPnlSOL = openPositions.reduce((sum, p) => sum + p.unrealizedPnlSOL, 0);
    const totalInvested = openPositions.reduce((sum, p) => sum + p.entryAmountSOL, 0);
    const totalPnlPct = totalInvested > 0 ? (totalPnlSOL / totalInvested) * 100 : 0;

    return {
      openPositions: openPositions.length,
      totalPnlSOL,
      totalPnlPct,
    };
  }
}


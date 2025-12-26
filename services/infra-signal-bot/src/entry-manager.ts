/**
 * Entry Manager
 * Manages confirmation-based entry logic with signal generation
 * Coordinates signals from absorption and stabilization to execute entries
 */

import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import pg from 'pg';
import axios from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';
import { 
  InfraSignal, 
  InfraSignalConfig, 
  LargeSellEvent,
  StabilizationResult,
  InfraWallet,
  SignalType
} from './types.js';
import { AbsorptionDetector } from './absorption-detector.js';
import { StabilizationChecker } from './stabilization-checker.js';
import { InfraClassifier } from './infra-classifier.js';

const log = createLogger('entry-manager');
const { Pool } = pg;

const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

interface PendingSignal {
  signal: InfraSignal;
  sellEvent: LargeSellEvent;
  absorptionWallet?: string;
  infraWallet?: InfraWallet;
}

export class EntryManager extends EventEmitter {
  private connection: Connection;
  private absorptionDetector: AbsorptionDetector;
  private stabilizationChecker: StabilizationChecker;
  private infraClassifier: InfraClassifier;
  private config: InfraSignalConfig;
  private db: pg.Pool;
  private keypair: Keypair | null = null;

  // Pending signals waiting for stabilization
  private pendingSignals: Map<string, PendingSignal> = new Map();
  private activePositionCount = 0;

  constructor(
    connection: Connection,
    absorptionDetector: AbsorptionDetector,
    stabilizationChecker: StabilizationChecker,
    infraClassifier: InfraClassifier,
    config: InfraSignalConfig,
    dbConnectionString: string
  ) {
    super();
    this.connection = connection;
    this.absorptionDetector = absorptionDetector;
    this.stabilizationChecker = stabilizationChecker;
    this.infraClassifier = infraClassifier;
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
   * Start the entry manager
   */
  start(): void {
    log.info('Starting entry manager...', {
      minSignalStrength: this.config.minSignalStrength,
      maxPositions: this.config.maxConcurrentPositions,
      buyAmountSOL: this.config.buyAmountSOL,
    });

    // Listen for absorption events
    this.absorptionDetector.on('absorption', (data: {
      sellEvent: LargeSellEvent;
      absorptionAmountSOL: number;
      absorptionWallet: string;
      absorptionDelayMs: number;
      infraWallet?: InfraWallet;
    }) => {
      this.handleAbsorption(data);
    });

    // Listen for stabilization events
    this.stabilizationChecker.on('stabilized', (data: {
      tokenMint: string;
      sellEvent: LargeSellEvent;
      result: StabilizationResult;
    }) => {
      this.handleStabilization(data);
    });

    // Listen for expired stabilization
    this.stabilizationChecker.on('stabilizationExpired', (data: {
      tokenMint: string;
      sellEvent: LargeSellEvent;
    }) => {
      this.handleStabilizationExpired(data);
    });
  }

  /**
   * Handle absorption event - create pending signal
   */
  private async handleAbsorption(data: {
    sellEvent: LargeSellEvent;
    absorptionAmountSOL: number;
    absorptionWallet: string;
    absorptionDelayMs: number;
    infraWallet?: InfraWallet;
  }): Promise<void> {
    const { sellEvent, absorptionAmountSOL, absorptionWallet, absorptionDelayMs, infraWallet } = data;

    // Check if max positions reached
    if (this.activePositionCount >= this.config.maxConcurrentPositions) {
      log.info(`Max positions reached (${this.activePositionCount}), skipping signal`);
      return;
    }

    // Calculate signal strength
    const strength = this.calculateSignalStrength(
      sellEvent,
      absorptionAmountSOL,
      absorptionDelayMs,
      infraWallet
    );

    if (strength < this.config.minSignalStrength) {
      log.info(`Signal strength too low (${strength}), skipping`);
      return;
    }

    // Get current price as defended level
    const currentPrice = this.stabilizationChecker.getCurrentPrice(sellEvent.tokenMint);
    const defendedLevel = currentPrice || sellEvent.priceBefore || 0;

    // Create signal
    const signal: InfraSignal = {
      tokenMint: sellEvent.tokenMint,
      poolAddress: sellEvent.poolAddress,
      signalType: 'absorption',
      strength,
      sellEventId: sellEvent.id,
      infraWallet: absorptionWallet,
      infraWalletType: infraWallet?.behaviorType,
      priceAtSignal: defendedLevel,
      defendedLevel,
      stabilizationConfirmed: false,
      higherLowFormed: false,
      status: 'active',
      createdAt: new Date(),
    };

    // Store pending signal
    const key = sellEvent.signature;
    this.pendingSignals.set(key, {
      signal,
      sellEvent,
      absorptionWallet,
      infraWallet,
    });

    // Persist signal to database
    await this.persistSignal(signal);

    log.info('📊 SIGNAL GENERATED - Waiting for stabilization', {
      token: sellEvent.tokenMint.slice(0, 8) + '...',
      strength,
      defendedLevel: defendedLevel.toFixed(8),
      infraType: infraWallet?.behaviorType || 'unknown',
    });

    // Start monitoring for stabilization
    this.stabilizationChecker.monitorForStabilization(
      sellEvent.tokenMint,
      sellEvent,
      defendedLevel
    );
  }

  /**
   * Calculate signal strength based on various factors
   */
  private calculateSignalStrength(
    sellEvent: LargeSellEvent,
    absorptionAmountSOL: number,
    absorptionDelayMs: number,
    infraWallet?: InfraWallet
  ): number {
    let strength = 0;

    // Absorption ratio (max 30 points)
    const absorptionRatio = absorptionAmountSOL / sellEvent.sellAmountSOL;
    strength += Math.min(absorptionRatio * 30, 30);

    // Response speed (max 25 points)
    if (absorptionDelayMs < 5000) strength += 25;
    else if (absorptionDelayMs < 15000) strength += 20;
    else if (absorptionDelayMs < 30000) strength += 10;

    // Infra wallet reputation (max 25 points)
    if (infraWallet) {
      if (infraWallet.behaviorType === 'defensive') strength += 25;
      else if (infraWallet.behaviorType === 'aggressive') strength += 20;
      else if (infraWallet.behaviorType === 'cyclical') strength += 15;
      
      // Bonus for high win rate
      if (infraWallet.winRate > 0.7) strength += 5;
      
      // Bonus for experience
      if (infraWallet.totalAbsorptions > 10) strength += 5;
    } else {
      strength += 10; // Unknown wallet - neutral
    }

    // Sell size significance (max 15 points)
    if (sellEvent.liquidityPct >= 2) strength += 15;
    else if (sellEvent.liquidityPct >= 1.5) strength += 10;
    else strength += 5;

    return Math.min(strength, 100);
  }

  /**
   * Handle stabilization confirmed - execute entry
   */
  private async handleStabilization(data: {
    tokenMint: string;
    sellEvent: LargeSellEvent;
    result: StabilizationResult;
  }): Promise<void> {
    const { tokenMint, sellEvent, result } = data;

    // Find pending signal
    const pending = this.pendingSignals.get(sellEvent.signature);
    if (!pending) {
      log.warn(`No pending signal found for ${tokenMint.slice(0, 8)}...`);
      return;
    }

    // Update signal with stabilization data
    pending.signal.stabilizationConfirmed = true;
    pending.signal.stabilizationTimeMs = result.stabilizationTimeMs;
    pending.signal.higherLowFormed = result.higherLowFormed;
    pending.signal.status = 'confirmed';
    pending.signal.confirmedAt = new Date();

    log.info('🎯 SIGNAL CONFIRMED - Executing entry', {
      token: tokenMint.slice(0, 8) + '...',
      strength: pending.signal.strength,
      stabilizationTimeMs: result.stabilizationTimeMs,
      higherLowFormed: result.higherLowFormed,
    });

    // Remove from pending
    this.pendingSignals.delete(sellEvent.signature);

    // Execute entry
    await this.executeEntry(pending, result);
  }

  /**
   * Handle stabilization expired - invalidate signal
   */
  private async handleStabilizationExpired(data: {
    tokenMint: string;
    sellEvent: LargeSellEvent;
  }): Promise<void> {
    const { tokenMint, sellEvent } = data;

    const pending = this.pendingSignals.get(sellEvent.signature);
    if (!pending) return;

    log.info(`Signal expired for ${tokenMint.slice(0, 8)}... - no stabilization`);

    pending.signal.status = 'expired';
    pending.signal.invalidatedAt = new Date();

    // Update in database
    await this.updateSignalStatus(pending.signal);

    this.pendingSignals.delete(sellEvent.signature);
  }

  /**
   * Execute buy entry
   */
  private async executeEntry(
    pending: PendingSignal,
    stabilization: StabilizationResult
  ): Promise<void> {
    if (!this.keypair) {
      log.error('Cannot execute: keypair not set');
      return;
    }

    const { signal } = pending;
    const tokenMint = signal.tokenMint;

    try {
      // Calculate entry price (slightly above defended level)
      const entryPriceTarget = signal.defendedLevel * (1 + this.config.entryAboveDefensePct / 100);
      
      // Get current price
      const currentPrice = stabilization.currentPrice || 
        this.stabilizationChecker.getCurrentPrice(tokenMint) ||
        await this.stabilizationChecker.fetchCurrentPrice(tokenMint);

      if (!currentPrice) {
        log.error(`Cannot get current price for ${tokenMint.slice(0, 8)}...`);
        return;
      }

      // Check if price is still favorable
      if (currentPrice > entryPriceTarget * 1.05) {
        log.warn(`Price moved too high (${currentPrice} > ${entryPriceTarget * 1.05}), skipping entry`);
        signal.status = 'invalidated';
        signal.invalidatedAt = new Date();
        await this.updateSignalStatus(signal);
        return;
      }

      const amountLamports = Math.floor(this.config.buyAmountSOL * LAMPORTS_PER_SOL);

      log.info('💰 Executing BUY order', {
        token: tokenMint.slice(0, 8) + '...',
        amountSOL: this.config.buyAmountSOL,
        entryPriceTarget: entryPriceTarget.toFixed(8),
        currentPrice: currentPrice.toFixed(8),
      });

      if (this.config.paperTradingMode) {
        // Paper trading - simulate execution
        log.info('📝 PAPER TRADE EXECUTED', {
          token: tokenMint.slice(0, 8) + '...',
          amountSOL: this.config.buyAmountSOL,
          price: currentPrice.toFixed(8),
        });

        signal.entryPrice = currentPrice;
        await this.updateSignalStatus(signal);

        // Emit entry event
        this.activePositionCount++;
        this.emit('entryExecuted', {
          signal,
          amountSOL: this.config.buyAmountSOL,
          entryPrice: currentPrice,
          signature: 'PAPER_TRADE',
          isPaper: true,
        });

        return;
      }

      // Live trading - get Jupiter order
      const order = await this.getJupiterOrder(
        NATIVE_SOL,
        tokenMint,
        amountLamports,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        log.error('Failed to get Jupiter order');
        return;
      }

      // Deserialize and sign
      const transactionBuf = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);

      // Execute via Jupiter Ultra API
      const result = await this.executeJupiterTransaction(
        Buffer.from(transaction.serialize()).toString('base64'),
        order.requestId
      );

      if (!result || result.status !== 'Success') {
        log.error('Jupiter execution failed', { status: result?.status });
        return;
      }

      log.info('🟢 LIVE BUY EXECUTED', {
        token: tokenMint.slice(0, 8) + '...',
        signature: result.signature,
        amountIn: result.inputAmountResult,
        amountOut: result.outputAmountResult,
      });

      signal.entryPrice = currentPrice;
      await this.updateSignalStatus(signal);

      // Record trade
      await this.recordTrade(signal, result);

      // Emit entry event
      this.activePositionCount++;
      this.emit('entryExecuted', {
        signal,
        amountSOL: this.config.buyAmountSOL,
        amountToken: parseFloat(result.outputAmountResult || '0'),
        entryPrice: currentPrice,
        signature: result.signature,
        isPaper: false,
      });

    } catch (error) {
      log.error(`Entry execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get Jupiter Ultra order
   */
  private async getJupiterOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    taker: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found');
      }

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
      log.error(`Failed to get Jupiter order: ${error instanceof Error ? error.message : String(error)}`);
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
      log.error(`Failed to execute transaction: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Persist signal to database
   */
  private async persistSignal(signal: InfraSignal): Promise<number | null> {
    try {
      const result = await this.db.query(
        `INSERT INTO infra_signals (
          token_mint, pool_address, signal_type, strength,
          sell_event_id, infra_wallet, infra_wallet_type,
          price_at_signal, defended_level, stabilization_confirmed,
          higher_low_formed, signal_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          signal.tokenMint,
          signal.poolAddress,
          signal.signalType,
          signal.strength,
          signal.sellEventId || null,
          signal.infraWallet || null,
          signal.infraWalletType || null,
          signal.priceAtSignal,
          signal.defendedLevel,
          signal.stabilizationConfirmed,
          signal.higherLowFormed,
          signal.status,
          signal.createdAt,
        ]
      );

      if (result.rows.length > 0) {
        signal.id = result.rows[0].id;
        return result.rows[0].id;
      }
      return null;
    } catch (error) {
      log.error(`Failed to persist signal: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Update signal status in database
   */
  private async updateSignalStatus(signal: InfraSignal): Promise<void> {
    if (!signal.id) return;

    try {
      await this.db.query(
        `UPDATE infra_signals SET
          signal_status = $1,
          stabilization_confirmed = $2,
          stabilization_time_ms = $3,
          higher_low_formed = $4,
          entry_price = $5,
          confirmed_at = $6,
          invalidated_at = $7
        WHERE id = $8`,
        [
          signal.status,
          signal.stabilizationConfirmed,
          signal.stabilizationTimeMs || null,
          signal.higherLowFormed,
          signal.entryPrice || null,
          signal.confirmedAt || null,
          signal.invalidatedAt || null,
          signal.id,
        ]
      );
    } catch (error) {
      log.error(`Failed to update signal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record trade to database
   */
  private async recordTrade(signal: InfraSignal, result: any): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO infra_trades (
          signal_id, token_mint, action, reason,
          signature, amount_sol, price, status, executed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          signal.id,
          signal.tokenMint,
          'buy',
          `Signal strength: ${signal.strength}, Infra type: ${signal.infraWalletType || 'unknown'}`,
          result.signature,
          this.config.buyAmountSOL,
          signal.entryPrice,
          'success',
        ]
      );
    } catch (error) {
      log.error(`Failed to record trade: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decrement position count (called by position monitor on exit)
   */
  decrementPositionCount(): void {
    if (this.activePositionCount > 0) {
      this.activePositionCount--;
    }
  }

  /**
   * Stop the entry manager
   */
  stop(): void {
    log.info('Stopping entry manager...');
    this.db.end();
  }

  /**
   * Get statistics
   */
  getStats(): { pendingSignals: number; activePositions: number } {
    return {
      pendingSignals: this.pendingSignals.size,
      activePositions: this.activePositionCount,
    };
  }
}


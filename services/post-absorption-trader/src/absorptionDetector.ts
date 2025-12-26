import { config } from './config';
import logger from './logger';
import {
  Transaction,
  SellPressureEvent,
  AbsorptionEvent,
} from './types';

/**
 * AbsorptionDetector identifies when infrastructure wallets absorb large sell pressure
 * 
 * Key Concept: We look for patterns where:
 * 1. Large sell pressure occurs on a token
 * 2. Infrastructure wallets step in and buy
 * 3. The buy volume is significant relative to the sell pressure
 * 
 * This is NOT front-running - we detect AFTER the absorption has occurred
 */
export class AbsorptionDetector {
  // Track recent transactions by token
  private recentTransactions: Map<string, Transaction[]> = new Map();
  
  // Track detected absorption events
  private absorptionEvents: Map<string, AbsorptionEvent> = new Map();
  
  // Track tokens on cooldown (recently processed)
  private tokenCooldowns: Map<string, number> = new Map();

  constructor() {
    // Clean up old data periodically
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Process a new transaction from any wallet
   */
  processTransaction(tx: Transaction): void {
    const token = tx.token;
    
    // Add to recent transactions
    if (!this.recentTransactions.has(token)) {
      this.recentTransactions.set(token, []);
    }
    this.recentTransactions.get(token)!.push(tx);

    // If this is an infra wallet BUY, check for absorption
    if (tx.type === 'buy' && this.isInfraWallet(tx.wallet)) {
      this.checkForAbsorption(token);
    }
  }

  /**
   * Check if a wallet is an infrastructure wallet
   */
  private isInfraWallet(wallet: string): boolean {
    return config.infraWallets.includes(wallet);
  }

  /**
   * Check if we've detected an absorption event for this token
   */
  private checkForAbsorption(token: string): void {
    // Check cooldown
    if (this.isOnCooldown(token)) {
      return;
    }

    const now = Date.now() / 1000;
    const transactions = this.recentTransactions.get(token) || [];

    // Get recent transactions within the absorption window
    const windowStart = now - config.absorption.absorptionWindowSec;
    const recentTxs = transactions.filter(tx => tx.blockTime >= windowStart);

    if (recentTxs.length === 0) {
      return;
    }

    // Identify sell pressure
    const sellPressure = this.identifySellPressure(recentTxs, now);
    
    if (!sellPressure) {
      return; // No significant sell pressure
    }

    // Identify infra wallet absorption
    const infraBuys = this.identifyInfraBuys(recentTxs, sellPressure.endTime, now);
    
    if (infraBuys.length === 0) {
      return; // No infra wallet activity
    }

    // Calculate absorption metrics
    const totalInfraBuyVolumeUsd = infraBuys.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const totalInfraBuyVolumeSol = infraBuys.reduce((sum, tx) => sum + tx.amountSol, 0);
    const absorptionRatio = totalInfraBuyVolumeUsd / sellPressure.totalSellVolumeUsd;

    // Check if absorption meets criteria
    if (totalInfraBuyVolumeUsd < config.absorption.minInfraBuyVolumeUsd) {
      logger.debug(`[AbsorptionDetector] Token ${token.slice(0, 8)}: Infra buy volume too low ($${totalInfraBuyVolumeUsd.toFixed(2)} < $${config.absorption.minInfraBuyVolumeUsd})`);
      return;
    }

    if (absorptionRatio < config.absorption.minAbsorptionRatio) {
      logger.debug(`[AbsorptionDetector] Token ${token.slice(0, 8)}: Absorption ratio too low (${(absorptionRatio * 100).toFixed(1)}% < ${config.absorption.minAbsorptionRatio * 100}%)`);
      return;
    }

    // Calculate price impact
    const priceBeforeSell = sellPressure.sellTransactions[0].priceUsd;
    const priceAtAbsorption = infraBuys[infraBuys.length - 1].priceUsd;
    const priceImpactPercent = ((priceAtAbsorption - priceBeforeSell) / priceBeforeSell) * 100;

    // Create absorption event
    const absorptionEvent: AbsorptionEvent = {
      id: `${token}-${now}`,
      token,
      tokenSymbol: sellPressure.tokenSymbol,
      sellPressure,
      infraWalletBuys: infraBuys,
      totalInfraBuyVolumeUsd,
      totalInfraBuyVolumeSol,
      absorptionRatio,
      detectedAt: now,
      absorptionStartTime: infraBuys[0].blockTime,
      absorptionEndTime: infraBuys[infraBuys.length - 1].blockTime,
      absorptionDurationSec: infraBuys[infraBuys.length - 1].blockTime - infraBuys[0].blockTime,
      priceBeforeSell,
      priceAtAbsorption,
      priceImpactPercent,
      status: 'detected',
    };

    this.absorptionEvents.set(token, absorptionEvent);
    this.setTokenCooldown(token);

    logger.info(`[AbsorptionDetector] 🎯 ABSORPTION DETECTED: ${token.slice(0, 8)}...`);
    logger.info(`  - Sell Pressure: $${sellPressure.totalSellVolumeUsd.toFixed(2)} (${sellPressure.sellTransactions.length} txs)`);
    logger.info(`  - Infra Absorption: $${totalInfraBuyVolumeUsd.toFixed(2)} (${infraBuys.length} buys)`);
    logger.info(`  - Absorption Ratio: ${(absorptionRatio * 100).toFixed(1)}%`);
    logger.info(`  - Price Impact: ${priceImpactPercent.toFixed(2)}%`);
  }

  /**
   * Identify sell pressure within a transaction set
   */
  private identifySellPressure(
    transactions: Transaction[],
    currentTime: number
  ): SellPressureEvent | null {
    const windowStart = currentTime - config.absorption.sellPressureWindowSec;
    
    // Get all sell transactions in the window
    const sells = transactions.filter(
      tx => tx.type === 'sell' && tx.blockTime >= windowStart && !this.isInfraWallet(tx.wallet)
    );

    if (sells.length === 0) {
      return null;
    }

    const totalSellVolumeUsd = sells.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const totalSellVolumeSol = sells.reduce((sum, tx) => sum + tx.amountSol, 0);

    // Check if sell pressure is significant
    if (totalSellVolumeUsd < config.absorption.minSellVolumeUsd) {
      return null;
    }

    const averagePrice = totalSellVolumeSol > 0 
      ? totalSellVolumeUsd / totalSellVolumeSol 
      : sells[0].priceUsd;

    return {
      token: sells[0].token,
      tokenSymbol: sells[0].tokenSymbol,
      totalSellVolumeUsd,
      totalSellVolumeSol,
      sellTransactions: sells,
      startTime: sells[0].blockTime,
      endTime: sells[sells.length - 1].blockTime,
      averagePrice,
    };
  }

  /**
   * Identify infrastructure wallet buys after sell pressure
   */
  private identifyInfraBuys(
    transactions: Transaction[],
    afterTime: number,
    beforeTime: number
  ): Transaction[] {
    return transactions.filter(
      tx =>
        tx.type === 'buy' &&
        this.isInfraWallet(tx.wallet) &&
        tx.blockTime >= afterTime &&
        tx.blockTime <= beforeTime
    );
  }

  /**
   * Get detected absorption event for a token
   */
  getAbsorptionEvent(token: string): AbsorptionEvent | undefined {
    return this.absorptionEvents.get(token);
  }

  /**
   * Get all active absorption events
   */
  getActiveAbsorptionEvents(): AbsorptionEvent[] {
    return Array.from(this.absorptionEvents.values()).filter(
      event => event.status === 'detected' || event.status === 'monitoring'
    );
  }

  /**
   * Update absorption event status
   */
  updateAbsorptionEventStatus(
    token: string,
    status: AbsorptionEvent['status'],
    rejectionReason?: string
  ): void {
    const event = this.absorptionEvents.get(token);
    if (event) {
      event.status = status;
      if (rejectionReason) {
        event.rejectionReason = rejectionReason;
      }
      logger.info(`[AbsorptionDetector] Updated ${token.slice(0, 8)} status: ${status}`);
    }
  }

  /**
   * Check if token is on cooldown
   */
  private isOnCooldown(token: string): boolean {
    const cooldownUntil = this.tokenCooldowns.get(token);
    if (!cooldownUntil) {
      return false;
    }
    const now = Date.now() / 1000;
    return now < cooldownUntil;
  }

  /**
   * Set cooldown for a token
   */
  private setTokenCooldown(token: string): void {
    const now = Date.now() / 1000;
    const cooldownUntil = now + config.entry.tokenCooldownSec;
    this.tokenCooldowns.set(token, cooldownUntil);
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now() / 1000;
    const maxAge = config.absorption.absorptionWindowSec * 2;

    // Clean up old transactions
    for (const [token, txs] of this.recentTransactions) {
      const filtered = txs.filter(tx => now - tx.blockTime < maxAge);
      if (filtered.length === 0) {
        this.recentTransactions.delete(token);
      } else {
        this.recentTransactions.set(token, filtered);
      }
    }

    // Clean up expired cooldowns
    for (const [token, cooldownUntil] of this.tokenCooldowns) {
      if (now >= cooldownUntil) {
        this.tokenCooldowns.delete(token);
      }
    }

    // Clean up old absorption events
    for (const [token, event] of this.absorptionEvents) {
      if (
        (event.status === 'expired' || event.status === 'rejected' || event.status === 'entered') &&
        now - event.detectedAt > 3600
      ) {
        this.absorptionEvents.delete(token);
      }
    }
  }
}

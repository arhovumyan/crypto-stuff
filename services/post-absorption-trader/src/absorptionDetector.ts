import { config } from './config';
import logger from './logger';
import {
  Transaction,
  SellPressureEvent,
  AbsorptionEvent,
  MarketData,
} from './types';
import { MarketDataService } from './marketDataService';

/**
 * AbsorptionDetector identifies when infrastructure wallets absorb price dips
 * 
 * NEW APPROACH (infra-only monitoring):
 * Since we only track infra wallets, we can't see non-infra sells directly.
 * Instead, we detect absorption by:
 * 1. Observing when infra wallets BUY a token
 * 2. Checking if the token's price recently dropped (from market data APIs)
 * 3. If price dropped significantly AND infra is buying → this is absorption
 * 
 * This is NOT front-running - we detect AFTER the absorption has occurred
 */
export class AbsorptionDetector {
  private marketDataService: MarketDataService;
  
  // Track recent infra transactions by token
  private recentTransactions: Map<string, Transaction[]> = new Map();
  
  // Track detected absorption events
  private absorptionEvents: Map<string, AbsorptionEvent> = new Map();
  
  // Track tokens on cooldown (recently processed)
  private tokenCooldowns: Map<string, number> = new Map();
  
  // Track price history for tokens (to detect drops)
  private priceHistory: Map<string, Array<{ price: number; timestamp: number }>> = new Map();

  constructor() {
    this.marketDataService = new MarketDataService();
    
    // Clean up old data periodically
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Process a new transaction from infra wallet
   */
  async processTransaction(tx: Transaction): Promise<void> {
    const token = tx.token;
    
    // Add to recent transactions
    if (!this.recentTransactions.has(token)) {
      this.recentTransactions.set(token, []);
    }
    this.recentTransactions.get(token)!.push(tx);

    // If this is an infra wallet BUY, check for absorption opportunity
    if (tx.type === 'buy' && this.isInfraWallet(tx.wallet)) {
      await this.checkForAbsorption(token, tx);
    }
  }

  /**
   * Check if a wallet is an infrastructure wallet
   */
  private isInfraWallet(wallet: string): boolean {
    return config.infraWallets.includes(wallet);
  }

  /**
   * Check if this infra buy represents an absorption event
   * We detect absorption by checking if price recently dropped
   */
  private async checkForAbsorption(token: string, buyTx: Transaction): Promise<void> {
    // Check cooldown
    if (this.isOnCooldown(token)) {
      return;
    }

    const now = Date.now() / 1000;
    const transactions = this.recentTransactions.get(token) || [];

    // Get recent infra buys within the absorption window
    const windowStart = now - config.absorption.absorptionWindowSec;
    const recentInfraBuys = transactions.filter(
      tx => tx.type === 'buy' && 
            tx.blockTime >= windowStart && 
            this.isInfraWallet(tx.wallet)
    );

    if (recentInfraBuys.length === 0) {
      return;
    }

    // Calculate total infra buy volume
    const totalInfraBuyVolumeUsd = recentInfraBuys.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const totalInfraBuyVolumeSol = recentInfraBuys.reduce((sum, tx) => sum + tx.amountSol, 0);

    // Check minimum buy volume (using SOL, not USD)
    if (totalInfraBuyVolumeSol < config.absorption.minInfraBuyVolumeSol) {
      logger.debug(`[AbsorptionDetector] ⏭️ ${token.slice(0, 8)}: Buy volume ${totalInfraBuyVolumeSol.toFixed(3)} SOL < ${config.absorption.minInfraBuyVolumeSol} SOL (skipping)`);
      return;
    }

    // Fetch real market data to check for price drop
    logger.info(`[AbsorptionDetector] Checking infra BUY: ${token.slice(0, 8)} (${totalInfraBuyVolumeSol.toFixed(4)} SOL)`);
    const marketData = await this.marketDataService.fetchMarketData(token);
    
    if (!marketData) {
      logger.info(`[AbsorptionDetector] ❌ Could not fetch market data for ${token.slice(0, 8)}`);
      return;
    }
    
    logger.info(`[AbsorptionDetector] 📊 ${token.slice(0, 8)}: Price $${marketData.priceUsd.toFixed(6)}, 24h: ${marketData.priceChange24hPercent.toFixed(1)}%, Liq: $${marketData.liquidityUsd.toFixed(0)}`);

    // Check if price recently dropped (using 24h change as proxy for recent drop)
    const priceDropPercent = -marketData.priceChange24hPercent; // Negative change = drop
    
    // Also check our own price history if available
    const recentPriceDrop = this.checkRecentPriceDrop(token, marketData.priceUsd);

    // Use the larger of the two drop indicators
    const effectiveDrop = Math.max(priceDropPercent, recentPriceDrop);

    // Check if this qualifies as absorption
    // Option 1: Traditional absorption = price dropped + infra buying
    // Option 2: Strong infra accumulation = high buy volume regardless of drop
    const minDropPercent = config.absorption.minPriceDropPercent || 3;
    const minStrongBuySol = config.absorption.minInfraBuyVolumeSol * 5; // 5x normal = strong signal
    
    const isTraditionalAbsorption = effectiveDrop >= minDropPercent;
    const isStrongAccumulation = totalInfraBuyVolumeSol >= minStrongBuySol;
    
    if (!isTraditionalAbsorption && !isStrongAccumulation) {
      logger.info(
        `[AbsorptionDetector] ⏭️ ${token.slice(0, 8)}: Drop ${effectiveDrop.toFixed(1)}% < ${minDropPercent}% and buy ${totalInfraBuyVolumeSol.toFixed(4)} SOL < ${minStrongBuySol.toFixed(4)} SOL (skipping)`
      );
      return;
    }
    
    const signalType = isTraditionalAbsorption ? 'DIP_ABSORPTION' : 'STRONG_ACCUMULATION';
    logger.info(`[AbsorptionDetector] ✅ Signal type: ${signalType}`);

    // Check liquidity requirement
    if (marketData.liquidityUsd > 0 && marketData.liquidityUsd < config.entry.minLiquidityUsd) {
      logger.info(
        `[AbsorptionDetector] ⏭️ ${token.slice(0, 8)}: Liq $${marketData.liquidityUsd.toFixed(0)} < $${config.entry.minLiquidityUsd} (skipping)`
      );
      return;
    }

    // Calculate inferred sell pressure (estimate from price drop and infra buy volume)
    const estimatedSellVolumeUsd = totalInfraBuyVolumeUsd / (config.absorption.minAbsorptionRatio || 0.3);
    
    // Create synthetic sell pressure event (inferred from price action)
    const sellPressure: SellPressureEvent = {
      token,
      tokenSymbol: buyTx.tokenSymbol,
      totalSellVolumeUsd: estimatedSellVolumeUsd,
      totalSellVolumeSol: estimatedSellVolumeUsd / 100, // Estimate
      sellTransactions: [], // We don't have actual sell txs
      startTime: now - 300, // Assume sell happened in last 5 min
      endTime: now - 60,
      averagePrice: marketData.priceUsd * (1 + effectiveDrop / 100), // Price before drop
    };

    // Calculate absorption ratio
    const absorptionRatio = totalInfraBuyVolumeUsd / estimatedSellVolumeUsd;

    // Create absorption event
    const absorptionEvent: AbsorptionEvent = {
      id: `${token}-${now}`,
      token,
      tokenSymbol: buyTx.tokenSymbol,
      sellPressure,
      infraWalletBuys: recentInfraBuys,
      totalInfraBuyVolumeUsd,
      totalInfraBuyVolumeSol,
      absorptionRatio,
      detectedAt: now,
      absorptionStartTime: recentInfraBuys[0].blockTime,
      absorptionEndTime: recentInfraBuys[recentInfraBuys.length - 1].blockTime,
      absorptionDurationSec: recentInfraBuys[recentInfraBuys.length - 1].blockTime - recentInfraBuys[0].blockTime,
      priceBeforeSell: sellPressure.averagePrice,
      priceAtAbsorption: marketData.priceUsd,
      priceImpactPercent: -effectiveDrop,
      status: 'detected',
    };

    this.absorptionEvents.set(token, absorptionEvent);
    this.setTokenCooldown(token);

    logger.info(`[AbsorptionDetector] 🎯 ABSORPTION DETECTED: ${token.slice(0, 8)}...`);
    logger.info(`  - Price Drop: ${effectiveDrop.toFixed(1)}%`);
    logger.info(`  - Current Price: $${marketData.priceUsd.toFixed(6)}`);
    logger.info(`  - Liquidity: $${marketData.liquidityUsd.toFixed(0)}`);
    logger.info(`  - Infra Buying: ${totalInfraBuyVolumeSol.toFixed(4)} SOL (${recentInfraBuys.length} buys)`);
    logger.info(`  - Infra Wallets: ${[...new Set(recentInfraBuys.map(tx => tx.wallet.slice(0, 8)))].join(', ')}`);
  }

  /**
   * Check our own price history for recent drops
   */
  private checkRecentPriceDrop(token: string, currentPrice: number): number {
    const history = this.priceHistory.get(token) || [];
    
    // Add current price to history
    history.push({ price: currentPrice, timestamp: Date.now() / 1000 });
    
    // Keep only last 30 minutes
    const cutoff = Date.now() / 1000 - 1800;
    const filtered = history.filter(h => h.timestamp >= cutoff);
    this.priceHistory.set(token, filtered);

    if (filtered.length < 2) {
      return 0;
    }

    // Find highest price in history
    const highestPrice = Math.max(...filtered.map(h => h.price));
    
    // Calculate drop from highest
    const dropPercent = ((highestPrice - currentPrice) / highestPrice) * 100;
    
    return dropPercent;
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
    
    // Clean up old price history
    const priceHistoryCutoff = now - 1800; // 30 minutes
    for (const [token, history] of this.priceHistory) {
      const filtered = history.filter(h => h.timestamp >= priceHistoryCutoff);
      if (filtered.length === 0) {
        this.priceHistory.delete(token);
      } else {
        this.priceHistory.set(token, filtered);
      }
    }
  }
}

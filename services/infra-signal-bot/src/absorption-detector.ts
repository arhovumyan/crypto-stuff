/**
 * Absorption Detector
 * Monitors for infra buybacks after large sell events
 */

import { EventEmitter } from 'events';
import pg from 'pg';
import { createLogger } from './logger.js';
import { RawTrade, LargeSellEvent, InfraSignalConfig, InfraWallet } from './types.js';
import { TradeFeed } from './trade-feed.js';
import { SellDetector } from './sell-detector.js';

const log = createLogger('absorption-detector');
const { Pool } = pg;

interface AbsorptionCandidate {
  sellEvent: LargeSellEvent;
  buybacks: RawTrade[];
  totalBuybackSOL: number;
  startTime: number;
}

export class AbsorptionDetector extends EventEmitter {
  private tradeFeed: TradeFeed;
  private sellDetector: SellDetector;
  private config: InfraSignalConfig;
  private db: pg.Pool;

  // Track pending absorptions
  private absorptionCandidates: Map<string, AbsorptionCandidate> = new Map();
  private knownInfraWallets: Map<string, InfraWallet> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    tradeFeed: TradeFeed,
    sellDetector: SellDetector,
    config: InfraSignalConfig,
    dbConnectionString: string
  ) {
    super();
    this.tradeFeed = tradeFeed;
    this.sellDetector = sellDetector;
    this.config = config;
    this.db = new Pool({ connectionString: dbConnectionString });
  }

  /**
   * Start monitoring for absorptions
   */
  async start(): Promise<void> {
    log.info('Starting absorption detector...', {
      absorptionWindowMs: this.config.absorptionWindowMs,
      minAbsorptionRatio: this.config.minAbsorptionRatio,
    });

    // Load known infra wallets from database
    await this.loadInfraWallets();

    // Listen for large sells
    this.sellDetector.on('largeSell', (sellEvent: LargeSellEvent) => {
      this.startTrackingAbsorption(sellEvent);
    });

    // Listen for buys to check for absorption
    this.tradeFeed.on('trade', (trade: RawTrade) => {
      if (trade.type === 'buy') {
        this.checkForAbsorption(trade);
      }
    });

    // Periodically check for expired absorption windows
    this.checkInterval = setInterval(() => {
      this.checkExpiredCandidates();
    }, 5000);
  }

  /**
   * Seed pre-configured infra wallets into the database
   */
  private async seedKnownInfraWallets(): Promise<void> {
    if (!this.config.knownInfraWallets || this.config.knownInfraWallets.length === 0) {
      return;
    }

    try {
      for (const address of this.config.knownInfraWallets) {
        // Insert or update the wallet (upsert)
        await this.db.query(
          `INSERT INTO infra_wallets (
            address, 
            behavior_type, 
            confidence_score, 
            notes
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (address) 
          DO UPDATE SET 
            updated_at = NOW()`,
          [
            address,
            'unknown', // Will be classified later
            100, // Pre-seeded wallets are trusted
            'Pre-configured infra wallet from environment'
          ]
        );
      }

      log.info(`✅ Seeded ${this.config.knownInfraWallets.length} pre-configured infra wallets into database`, {
        wallets: this.config.knownInfraWallets.map(w => w.slice(0, 8) + '...'),
      });
    } catch (error) {
      log.error(`Failed to seed known infra wallets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load known infra wallets from database
   */
  private async loadInfraWallets(): Promise<void> {
    try {
      // First, seed pre-configured infra wallets into database
      if (this.config.knownInfraWallets && this.config.knownInfraWallets.length > 0) {
        await this.seedKnownInfraWallets();
      }

      // Then load all infra wallets from database
      const result = await this.db.query(
        `SELECT * FROM infra_wallets WHERE is_blacklisted = false`
      );

      for (const row of result.rows) {
        const wallet: InfraWallet = {
          id: row.id,
          address: row.address,
          behaviorType: row.behavior_type,
          confidenceScore: parseFloat(row.confidence_score || '0'),
          totalDefenses: row.total_defenses,
          totalAbsorptions: row.total_absorptions,
          avgDefenseSizeSOL: parseFloat(row.avg_defense_size_sol || '0'),
          avgResponseTimeMs: row.avg_response_time_ms,
          winRate: parseFloat(row.win_rate || '0'),
          distributionFrequency: parseFloat(row.distribution_frequency || '0'),
          avgDistributionSizePct: parseFloat(row.avg_distribution_size_pct || '0'),
          firstSeenAt: new Date(row.first_seen_at),
          lastSeenAt: new Date(row.last_seen_at),
          totalTrades: row.total_trades,
          isBlacklisted: row.is_blacklisted,
        };
        this.knownInfraWallets.set(row.address, wallet);
      }

      log.info(`✅ Loaded ${this.knownInfraWallets.size} known infra wallets from database`, {
        wallets: Array.from(this.knownInfraWallets.keys()).map(w => w.slice(0, 8) + '...'),
      });

      // Add any remaining manual infra wallets from config (not in DB)
      if (this.config.knownInfraWallets) {
        for (const addr of this.config.knownInfraWallets) {
          if (!this.knownInfraWallets.has(addr)) {
            this.knownInfraWallets.set(addr, {
              address: addr,
              behaviorType: 'unknown',
              confidenceScore: 100, // Manual = trusted
              totalDefenses: 0,
              totalAbsorptions: 0,
              avgDefenseSizeSOL: 0,
              avgResponseTimeMs: 0,
              winRate: 0,
              distributionFrequency: 0,
              avgDistributionSizePct: 0,
              firstSeenAt: new Date(),
              lastSeenAt: new Date(),
              totalTrades: 0,
              isBlacklisted: false,
            });
          }
        }
        log.info(`Added ${this.config.knownInfraWallets.length} manual infra wallets`);
      }
    } catch (error) {
      log.error(`Failed to load infra wallets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start tracking a large sell for potential absorption
   */
  private startTrackingAbsorption(sellEvent: LargeSellEvent): void {
    const key = sellEvent.signature;
    
    this.absorptionCandidates.set(key, {
      sellEvent,
      buybacks: [],
      totalBuybackSOL: 0,
      startTime: Date.now(),
    });

    log.info(`Tracking absorption for sell ${key.slice(0, 8)}...`, {
      token: sellEvent.tokenMint.slice(0, 8) + '...',
      sellAmountSOL: sellEvent.sellAmountSOL.toFixed(4),
    });
  }

  /**
   * Check if a buy is absorbing a tracked sell
   */
  private checkForAbsorption(trade: RawTrade): void {
    // Find candidates for this token
    for (const [key, candidate] of this.absorptionCandidates) {
      if (candidate.sellEvent.tokenMint !== trade.tokenMint) continue;
      if (candidate.sellEvent.status !== 'pending') continue;

      // Check if within absorption window
      const elapsed = Date.now() - candidate.startTime;
      if (elapsed > this.config.absorptionWindowMs) continue;

      // Check if buyer is a known infra wallet OR if buy is significant
      const isInfraWallet = this.knownInfraWallets.has(trade.traderWallet);
      const isSignificantBuy = trade.amountSOL >= candidate.sellEvent.sellAmountSOL * 0.1;

      if (!isInfraWallet && !isSignificantBuy) continue;

      // Track this buyback
      candidate.buybacks.push(trade);
      candidate.totalBuybackSOL += trade.amountSOL;

      log.info(`💰 Buyback detected for sell ${key.slice(0, 8)}...`, {
        buyer: trade.traderWallet.slice(0, 8) + '...',
        isInfra: isInfraWallet ? '✅ YES' : '❌ NO',
        buyAmountSOL: trade.amountSOL.toFixed(4) + ' SOL',
        totalBuybackSOL: candidate.totalBuybackSOL.toFixed(4) + ' SOL',
        targetSOL: (candidate.sellEvent.sellAmountSOL * this.config.minAbsorptionRatio).toFixed(4) + ' SOL',
        progress: ((candidate.totalBuybackSOL / (candidate.sellEvent.sellAmountSOL * this.config.minAbsorptionRatio)) * 100).toFixed(1) + '%',
      });

      // Check if absorption threshold reached
      const absorptionRatio = candidate.totalBuybackSOL / candidate.sellEvent.sellAmountSOL;
      
      if (absorptionRatio >= this.config.minAbsorptionRatio) {
        this.confirmAbsorption(candidate, trade);
      }
    }
  }

  /**
   * Confirm absorption and emit signal
   */
  private async confirmAbsorption(
    candidate: AbsorptionCandidate,
    triggerTrade: RawTrade
  ): Promise<void> {
    const sellEvent = candidate.sellEvent;
    const absorptionDelayMs = Date.now() - candidate.startTime;

    // Find the primary absorber (largest buy or infra wallet)
    let primaryAbsorber = triggerTrade.traderWallet;
    let maxBuy = triggerTrade.amountSOL;
    
    for (const buy of candidate.buybacks) {
      if (this.knownInfraWallets.has(buy.traderWallet)) {
        primaryAbsorber = buy.traderWallet;
        break;
      }
      if (buy.amountSOL > maxBuy) {
        maxBuy = buy.amountSOL;
        primaryAbsorber = buy.traderWallet;
      }
    }

    log.info('🛡️ ✅ ABSORPTION CONFIRMED', {
      token: sellEvent.tokenMint.slice(0, 8) + '...',
      sellAmountSOL: sellEvent.sellAmountSOL.toFixed(4) + ' SOL',
      absorptionAmountSOL: candidate.totalBuybackSOL.toFixed(4) + ' SOL',
      ratio: (candidate.totalBuybackSOL / sellEvent.sellAmountSOL * 100).toFixed(1) + '%',
      delayMs: absorptionDelayMs + 'ms',
      buyers: candidate.buybacks.length,
      absorberWallet: primaryAbsorber.slice(0, 8) + '...',
      isKnownInfra: this.knownInfraWallets.has(primaryAbsorber) ? '✅ YES' : '❌ NO (NEW!)',
    });
    
    for (const buy of candidate.buybacks) {
      if (this.knownInfraWallets.has(buy.traderWallet)) {
        primaryAbsorber = buy.traderWallet;
        break;
      }
      if (buy.amountSOL > maxBuy) {
        maxBuy = buy.amountSOL;
        primaryAbsorber = buy.traderWallet;
      }
    }

    // Update sell event
    await this.sellDetector.updateSellStatus(sellEvent.signature, {
      wasAbsorbed: true,
      absorptionAmountSOL: candidate.totalBuybackSOL,
      absorptionWallet: primaryAbsorber,
      absorptionDelayMs,
      status: 'absorbed',
    });

    // Update or create infra wallet record
    await this.updateInfraWallet(primaryAbsorber, candidate);

    // Remove from candidates
    this.absorptionCandidates.delete(sellEvent.signature);

    // Emit absorption event for signal generation
    this.emit('absorption', {
      sellEvent,
      absorptionAmountSOL: candidate.totalBuybackSOL,
      absorptionWallet: primaryAbsorber,
      absorptionDelayMs,
      buybacks: candidate.buybacks,
      infraWallet: this.knownInfraWallets.get(primaryAbsorber),
    });
  }

  /**
   * Update infra wallet stats after absorption
   */
  private async updateInfraWallet(
    walletAddress: string,
    candidate: AbsorptionCandidate
  ): Promise<void> {
    try {
      const existing = this.knownInfraWallets.get(walletAddress);
      
      if (existing) {
        // Update existing wallet
        existing.totalAbsorptions++;
        existing.lastSeenAt = new Date();
        existing.avgDefenseSizeSOL = 
          (existing.avgDefenseSizeSOL * (existing.totalAbsorptions - 1) + candidate.totalBuybackSOL) / 
          existing.totalAbsorptions;
        
        const delayMs = Date.now() - candidate.startTime;
        existing.avgResponseTimeMs = 
          (existing.avgResponseTimeMs * (existing.totalAbsorptions - 1) + delayMs) / 
          existing.totalAbsorptions;

        await this.db.query(
          `UPDATE infra_wallets 
           SET total_absorptions = $1, 
               last_seen_at = NOW(),
               avg_defense_size_sol = $2,
               avg_response_time_ms = $3,
               total_trades = total_trades + 1
           WHERE address = $4`,
          [
            existing.totalAbsorptions,
            existing.avgDefenseSizeSOL,
            existing.avgResponseTimeMs,
            walletAddress,
          ]
        );
      } else {
        // Create new infra wallet record
        const newWallet: InfraWallet = {
          address: walletAddress,
          behaviorType: 'unknown',
          confidenceScore: 30, // Low initial confidence
          totalDefenses: 0,
          totalAbsorptions: 1,
          avgDefenseSizeSOL: candidate.totalBuybackSOL,
          avgResponseTimeMs: Date.now() - candidate.startTime,
          winRate: 0,
          distributionFrequency: 0,
          avgDistributionSizePct: 0,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          totalTrades: 1,
          isBlacklisted: false,
        };

        this.knownInfraWallets.set(walletAddress, newWallet);

        await this.db.query(
          `INSERT INTO infra_wallets (
            address, behavior_type, confidence_score, total_absorptions,
            avg_defense_size_sol, avg_response_time_ms, first_seen_at, 
            last_seen_at, total_trades
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 1)
          ON CONFLICT (address) DO UPDATE SET
            total_absorptions = infra_wallets.total_absorptions + 1,
            last_seen_at = NOW(),
            total_trades = infra_wallets.total_trades + 1`,
          [
            walletAddress,
            'unknown',
            30,
            1,
            candidate.totalBuybackSOL,
            Date.now() - candidate.startTime,
          ]
        );

        log.info('🎯 NEW INFRA WALLET DISCOVERED!', {
          wallet: walletAddress,
          walletShort: walletAddress.slice(0, 8) + '...',
          behaviorType: 'unknown',
          reason: 'Absorbed large sell',
          absorptionCount: 1,
        });
      }
    } catch (error) {
      log.error(`Failed to update infra wallet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check for expired absorption candidates
   */
  private async checkExpiredCandidates(): Promise<void> {
    const now = Date.now();

    for (const [key, candidate] of this.absorptionCandidates) {
      if (candidate.sellEvent.status !== 'pending') continue;

      const elapsed = now - candidate.startTime;
      
      if (elapsed > this.config.absorptionWindowMs) {
        // Absorption window expired
        log.info(`Absorption window expired for ${key.slice(0, 8)}...`, {
          token: candidate.sellEvent.tokenMint.slice(0, 8) + '...',
          totalBuybackSOL: candidate.totalBuybackSOL.toFixed(4),
          targetSOL: candidate.sellEvent.sellAmountSOL.toFixed(4),
        });

        await this.sellDetector.updateSellStatus(candidate.sellEvent.signature, {
          wasAbsorbed: false,
          absorptionAmountSOL: candidate.totalBuybackSOL,
          status: 'not_absorbed',
        });

        this.absorptionCandidates.delete(key);

        // Emit non-absorption event
        this.emit('noAbsorption', {
          sellEvent: candidate.sellEvent,
          partialAbsorptionSOL: candidate.totalBuybackSOL,
        });
      }
    }
  }

  /**
   * Get known infra wallet
   */
  getInfraWallet(address: string): InfraWallet | undefined {
    return this.knownInfraWallets.get(address);
  }

  /**
   * Check if address is known infra wallet
   */
  isInfraWallet(address: string): boolean {
    return this.knownInfraWallets.has(address);
  }

  /**
   * Get all known infra wallets
   */
  getAllInfraWallets(): InfraWallet[] {
    return Array.from(this.knownInfraWallets.values());
  }

  /**
   * Stop the detector
   */
  stop(): void {
    log.info('Stopping absorption detector...');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.db.end();
  }

  /**
   * Get statistics
   */
  getStats(): { pendingAbsorptions: number; knownInfraWallets: number } {
    return {
      pendingAbsorptions: this.absorptionCandidates.size,
      knownInfraWallets: this.knownInfraWallets.size,
    };
  }
}


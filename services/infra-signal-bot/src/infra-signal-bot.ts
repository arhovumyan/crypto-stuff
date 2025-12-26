/**
 * Infrastructure Signal Bot
 * Main orchestrator that coordinates all components for 
 * confirmation-based trading using infra trader behavior as signals
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { createLogger } from './logger.js';
import { InfraSignalConfig, DEFAULT_CONFIG } from './types.js';
import { TradeFeed } from './trade-feed.js';
import { SellDetector } from './sell-detector.js';
import { AbsorptionDetector } from './absorption-detector.js';
import { InfraClassifier } from './infra-classifier.js';
import { StabilizationChecker } from './stabilization-checker.js';
import { EntryManager } from './entry-manager.js';
import { PositionMonitor } from './position-monitor.js';

const log = createLogger('infra-signal-bot');

export class InfraSignalBot {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private config: InfraSignalConfig;
  private dbConnectionString: string;

  // Components
  private tradeFeed: TradeFeed;
  private sellDetector: SellDetector;
  private absorptionDetector: AbsorptionDetector;
  private infraClassifier: InfraClassifier;
  private stabilizationChecker: StabilizationChecker;
  private entryManager: EntryManager;
  private positionMonitor: PositionMonitor;

  // Stats
  private isRunning = false;
  private startTime: Date | null = null;
  private statsInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<InfraSignalConfig>, dbConnectionString: string) {
    // Merge with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as InfraSignalConfig;

    this.dbConnectionString = dbConnectionString;
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');

    // Initialize components
    this.tradeFeed = new TradeFeed(
      this.config.rpcUrl,
      this.config.wsUrl,
      this.config.heliusApiKey || ''
    );

    this.sellDetector = new SellDetector(
      this.tradeFeed,
      this.config,
      dbConnectionString
    );

    this.absorptionDetector = new AbsorptionDetector(
      this.tradeFeed,
      this.sellDetector,
      this.config,
      dbConnectionString
    );

    this.infraClassifier = new InfraClassifier(
      this.tradeFeed,
      this.config,
      dbConnectionString
    );

    this.stabilizationChecker = new StabilizationChecker(
      this.tradeFeed,
      this.config
    );

    this.entryManager = new EntryManager(
      this.connection,
      this.absorptionDetector,
      this.stabilizationChecker,
      this.infraClassifier,
      this.config,
      dbConnectionString
    );

    this.positionMonitor = new PositionMonitor(
      this.connection,
      this.tradeFeed,
      this.absorptionDetector,
      this.stabilizationChecker,
      this.entryManager,
      this.config,
      dbConnectionString
    );
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Bot is already running');
      return;
    }

    this.printBanner();
    this.printConfig();

    // Initialize wallet
    await this.initializeWallet();

    // Check balance
    await this.checkBalance();

    // Connect to trade feed
    log.info('Connecting to trade feed...');
    await this.tradeFeed.connect();

    // Start all components
    log.info('Starting components...');
    this.sellDetector.start();
    await this.absorptionDetector.start();
    this.infraClassifier.start();
    this.stabilizationChecker.start();
    this.entryManager.start();
    this.positionMonitor.start();

    // Start stats reporting
    this.startStatsReporting();

    this.isRunning = true;
    this.startTime = new Date();

    log.info('');
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('🎯 INFRA SIGNAL BOT IS LIVE!');
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('');
    log.info('Monitoring for:');
    log.info(`  • Large sells (${this.config.minSellLiquidityPct}-${this.config.maxSellLiquidityPct}% of pool liquidity)`);
    log.info(`  • Infra absorption within ${this.config.absorptionWindowMs / 1000}s`);
    log.info(`  • Price stabilization within ${this.config.stabilizationTimeframeMs / 60000} min`);
    log.info('');
    log.info('Entry criteria:');
    log.info(`  • Min signal strength: ${this.config.minSignalStrength}/100`);
    log.info(`  • Entry above defense: +${this.config.entryAboveDefensePct}%`);
    log.info(`  • Buy amount: ${this.config.buyAmountSOL} SOL`);
    log.info('');
    log.info('Exit strategy:');
    log.info(`  • Take profit: +${this.config.takeProfitPct}%`);
    log.info(`  • Stop loss: -${this.config.stopLossPct}%`);
    log.info(`  • Exit on infra distribution`);
    log.info('');
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('');
  }

  /**
   * Print startup banner
   */
  private printBanner(): void {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║            🔮 INFRASTRUCTURE SIGNAL TRADING BOT 🔮                        ║
║                                                                            ║
║        Confirmation-Based Trading Using Infra Behavior as Signals          ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  /**
   * Print configuration
   */
  private printConfig(): void {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('⚙️  CONFIGURATION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Trading Mode:         ${this.config.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER'}`);
    console.log(`Buy Amount:           ${this.config.buyAmountSOL} SOL`);
    console.log(`Max Positions:        ${this.config.maxConcurrentPositions}`);
    console.log('');
    console.log('📉 SELL DETECTION:');
    console.log(`  Min Sell Size:      ${this.config.minSellLiquidityPct}% of pool liquidity`);
    console.log(`  Max Sell Size:      ${this.config.maxSellLiquidityPct}% of pool liquidity`);
    console.log(`  Detection Window:   ${this.config.sellDetectionWindowMs / 1000}s`);
    console.log('');
    console.log('🛡️ ABSORPTION DETECTION:');
    console.log(`  Absorption Window:  ${this.config.absorptionWindowMs / 1000}s`);
    console.log(`  Min Absorption:     ${this.config.minAbsorptionRatio * 100}% of sell`);
    console.log('');
    console.log('📊 STABILIZATION:');
    console.log(`  Timeframe:          ${this.config.stabilizationTimeframeMs / 60000} min`);
    console.log(`  Min Higher Lows:    ${this.config.minHigherLows}`);
    console.log(`  Price Tolerance:    ${this.config.priceStabilizationPct}%`);
    console.log('');
    console.log('💰 ENTRY/EXIT:');
    console.log(`  Min Signal Strength: ${this.config.minSignalStrength}/100`);
    console.log(`  Take Profit:        +${this.config.takeProfitPct}%`);
    console.log(`  Stop Loss:          -${this.config.stopLossPct}%`);
    if (this.config.trailingStopPct) {
      console.log(`  Trailing Stop:      ${this.config.trailingStopPct}%`);
    }
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  }

  /**
   * Initialize wallet from seed phrase
   */
  private async initializeWallet(): Promise<void> {
    const seedPhrase = 
      process.env.COPY_WALLET_SEED_PHRASE || 
      process.env.COPY_WALLET_SEED_PHREASE;

    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in environment');
    }

    const trimmed = seedPhrase.trim();

    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase');
    }

    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    // Pass keypair to components that need it
    this.entryManager.setKeypair(this.keypair);
    this.positionMonitor.setKeypair(this.keypair);

    log.info('💼 Wallet initialized', {
      address: this.keypair.publicKey.toBase58(),
    });
  }

  /**
   * Check wallet balance with retry logic
   */
  private async checkBalance(): Promise<void> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    // In paper trading mode, skip balance check if RPC is rate limited
    if (this.config.paperTradingMode) {
      try {
        const balance = await this.connection.getBalance(this.keypair.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        log.info('💰 Wallet Balance', {
          address: this.keypair.publicKey.toBase58().slice(0, 8) + '...',
          balance: balanceSOL.toFixed(4) + ' SOL',
        });

        if (balanceSOL < this.config.buyAmountSOL) {
          log.warn('⚠️  WARNING: Insufficient balance for trading!', {
            balance: balanceSOL.toFixed(4),
            required: this.config.buyAmountSOL,
          });
        }
      } catch (error: any) {
        // In paper trading, balance check failure is not fatal
        if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          log.warn('⚠️  Could not check balance (RPC rate limited) - continuing in paper trading mode', {
            address: this.keypair.publicKey.toBase58().slice(0, 8) + '...',
          });
        } else {
          // Re-throw non-rate-limit errors
          throw error;
        }
      }
    } else {
      // Live trading: retry with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const balance = await this.connection.getBalance(this.keypair.publicKey);
          const balanceSOL = balance / LAMPORTS_PER_SOL;

          log.info('💰 Wallet Balance', {
            address: this.keypair.publicKey.toBase58().slice(0, 8) + '...',
            balance: balanceSOL.toFixed(4) + ' SOL',
          });

          if (balanceSOL < this.config.buyAmountSOL) {
            log.warn('⚠️  WARNING: Insufficient balance for trading!', {
              balance: balanceSOL.toFixed(4),
              required: this.config.buyAmountSOL,
            });
          }
          return; // Success
        } catch (error: any) {
          lastError = error;
          if (error.message?.includes('429') || error.message?.includes('rate limit')) {
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            log.warn(`RPC rate limited, retrying in ${delay}ms... (attempt ${attempt + 1}/3)`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw error; // Non-rate-limit error, fail immediately
          }
        }
      }
      // If all retries failed
      throw new Error(`Failed to check balance after 3 attempts: ${lastError?.message}`);
    }
  }

  /**
   * Start periodic stats reporting
   */
  private startStatsReporting(): void {
    this.statsInterval = setInterval(() => {
      this.printStats();
    }, 60000); // Every minute
  }

  /**
   * Print current statistics
   */
  private printStats(): void {
    const sellStats = this.sellDetector.getStats();
    const absorptionStats = this.absorptionDetector.getStats();
    const entryStats = this.entryManager.getStats();
    const positionStats = this.positionMonitor.getStats();
    const classifierStats = this.infraClassifier.getStats();
    const stabilizerStats = this.stabilizationChecker.getStats();

    const uptimeMs = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const uptimeMin = Math.floor(uptimeMs / 60000);

    log.info('');
    log.info('════════════════════════════════════════════════════════════');
    log.info('📊 STATS REPORT');
    log.info('════════════════════════════════════════════════════════════');
    log.info(`Uptime: ${uptimeMin} minutes`);
    log.info('');
    log.info('Detection:');
    log.info(`  Tokens Tracked:      ${sellStats.tokensTracked}`);
    log.info(`  Large Sells:         ${sellStats.totalSells} (${sellStats.pendingSells} pending)`);
    log.info(`  Pending Absorptions: ${absorptionStats.pendingAbsorptions}`);
    log.info(`  Known Infra Wallets: ${absorptionStats.knownInfraWallets}`);
    log.info('');
    log.info('Classification:');
    log.info(`  Wallets Tracked:     ${classifierStats.walletsTracked}`);
    log.info(`  Classified:          ${classifierStats.classifiedWallets}`);
    log.info(`  By Type:             D:${classifierStats.byType.defensive} C:${classifierStats.byType.cyclical} A:${classifierStats.byType.aggressive} P:${classifierStats.byType.passive}`);
    log.info('');
    log.info('Signals:');
    log.info(`  Pending Signals:     ${entryStats.pendingSignals}`);
    log.info(`  Tokens Monitoring:   ${stabilizerStats.tokensMonitored}`);
    log.info('');
    log.info('Positions:');
    log.info(`  Open Positions:      ${positionStats.openPositions}`);
    log.info(`  Unrealized P&L:      ${positionStats.totalPnlSOL.toFixed(4)} SOL (${positionStats.totalPnlPct.toFixed(2)}%)`);
    log.info('════════════════════════════════════════════════════════════');
    log.info('');
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn('Bot is not running');
      return;
    }

    log.info('🛑 Stopping Infra Signal Bot...');

    // Stop stats reporting
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Stop all components in reverse order
    this.positionMonitor.stop();
    this.entryManager.stop();
    this.stabilizationChecker.stop();
    this.infraClassifier.stop();
    this.absorptionDetector.stop();
    this.sellDetector.stop();
    this.tradeFeed.disconnect();

    // Print final stats
    this.printStats();

    this.isRunning = false;
    log.info('✅ Infra Signal Bot stopped');
  }

  /**
   * Check if bot is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get current positions
   */
  getPositions(): any[] {
    return this.positionMonitor.getOpenPositions();
  }

  /**
   * Get known infra wallets
   */
  getInfraWallets(): any[] {
    return this.absorptionDetector.getAllInfraWallets();
  }
}


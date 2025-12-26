/**
 * Strict Solana Token Sniper
 * Main orchestrator - coordinates all components
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { TokenMonitor, TokenLaunch } from './token-monitor.js';
import { GateValidator, GateConfig } from './gate-validator.js';
import { ExecutionEngine, ExecutionConfig } from './execution-engine.js';
import { PositionManager, PositionConfig } from './position-manager.js';
import { SniperStats } from './sniper-stats.js';
import { RejectionLogger } from './rejection-logger.js';

const log = createLogger('sniper');

export interface SniperConfig {
  // RPC
  rpcUrl: string;
  heliusApiKey: string;
  
  // Trading
  buyAmountSOL: number;
  enableLiveTrading: boolean;
  
  // Gates
  gates: GateConfig;
  
  // Execution
  execution: ExecutionConfig;
  
  // Position management
  positions: PositionConfig;
  
  // Stats interval (seconds)
  statsIntervalSeconds: number;
}

export class SniperBot {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private monitor: TokenMonitor;
  private validator: GateValidator;
  private executor: ExecutionEngine;
  private positionManager: PositionManager;
  private stats: SniperStats;
  private rejectionLogger: RejectionLogger;
  private config: SniperConfig;
  private isRunning = false;
  private processedTokens: Set<string> = new Set();
  private statsInterval: NodeJS.Timeout | null = null;

  constructor(config: SniperConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.monitor = new TokenMonitor(config.rpcUrl, config.heliusApiKey);
    this.executor = new ExecutionEngine(this.connection, config.execution);
    this.stats = new SniperStats();
    this.rejectionLogger = new RejectionLogger();
    
    // These will be fully initialized after wallet setup
    this.validator = new GateValidator(this.connection, this.monitor, config.gates);
    this.positionManager = new PositionManager(this.connection, this.executor, config.positions);
  }

  /**
   * Start the sniper bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Sniper already running');
      return;
    }

    this.printBanner();
    this.printConfig();
    
    // Log rejection log directory
    log.info(`📝 Rejection logs will be saved to: ${this.rejectionLogger.getLogDir()}`);

    // Initialize wallet
    await this.initializeWallet();

    // Check balance
    await this.checkBalance();

    // Start token monitor
    await this.monitor.start();

    // Start main loop
    this.isRunning = true;
    this.mainLoop();

    // Start stats reporting
    this.startStatsReporting();

    log.info('🎯 SNIPER IS LIVE AND HUNTING!');
    log.info('');
  }

  /**
   * Print startup banner
   */
  private printBanner(): void {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║              🎯 STRICT SOLANA TOKEN SNIPER 🎯                 ║
║                                                                ║
║           High-Quality Launch Detection & Execution            ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  }

  /**
   * Print configuration
   */
  private printConfig(): void {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('⚙️  CONFIGURATION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Buy Amount:           ${this.config.buyAmountSOL} SOL`);
    console.log(`Trading Mode:         ${this.config.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER'}`);
    console.log('');
    console.log('🚪 GATE THRESHOLDS:');
    console.log(`  Min Liquidity:      ${this.config.gates.minLiquiditySOL} SOL`);
    console.log(`  Gate B Mode:        ${this.config.gates.gateBMode || 'strict'} ${this.config.gates.enableGateB === false ? '(DISABLED)' : ''}`);
    console.log(`  Gate C Mode:        ${this.config.gates.gateCMode || 'strict'} ${this.config.gates.enableGateC === false ? '(DISABLED)' : ''}`);
    console.log(`  Gate D Retries:     ${this.config.gates.gateDRetries || 12}x @ ${((this.config.gates.gateDRetryDelayMs || 5000) / 1000)}s each (~${((this.config.gates.gateDRetries || 12) * (this.config.gates.gateDRetryDelayMs || 5000) / 1000)}s max)`);
    console.log(`  Max Price Impact:   ${this.config.gates.maxPriceImpactPct}%`);
    console.log(`  Max Slippage:       ${this.config.gates.maxSlippageBps / 100}%`);
    console.log(`  Max Round Trip Loss: ${this.config.gates.maxRoundTripLossPct}%`);
    console.log(`  Min Early Swaps:    ${this.config.gates.minEarlySwaps}`);
    console.log(`  Min Unique Wallets: ${this.config.gates.minUniqueWallets}`);
    console.log('');
    console.log('💰 EXIT STRATEGY:');
    console.log(`  TP1: ${this.config.positions.takeProfit1Pct}% @ +${this.config.positions.takeProfit1At}%`);
    console.log(`  TP2: ${this.config.positions.takeProfit2Pct}% @ +${this.config.positions.takeProfit2At}%`);
    console.log(`  Stop Loss: -${this.config.positions.stopLossPct}%`);
    console.log(`  Time Stop: ${this.config.positions.timeStopMinutes}min if < +${this.config.positions.timeStopMinGainPct}%`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  }

  /**
   * Initialize wallet from seed phrase
   */
  private async initializeWallet(): Promise<void> {
    const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE || process.env.COPY_WALLET_SEED_PHREASE;

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

    log.info('💼 Wallet initialized', {
      publicKey: this.keypair.publicKey.toBase58()
    });
  }

  /**
   * Check wallet balance
   */
  private async checkBalance(): Promise<void> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    log.info('💰 Wallet Balance', {
      address: this.keypair.publicKey.toBase58(),
      balance: balanceSOL.toFixed(4) + ' SOL'
    });

    if (balanceSOL < this.config.buyAmountSOL) {
      log.warn('⚠️  WARNING: Insufficient balance for trading!', {
        balance: balanceSOL,
        required: this.config.buyAmountSOL
      });
    }
  }

  /**
   * Main processing loop
   */
  private async mainLoop(): Promise<void> {
    log.info('🔄 Starting main processing loop');
    
    let loopCount = 0;

    while (this.isRunning) {
      try {
        loopCount++;
        
        if (loopCount % 12 === 0) { // Every minute (5s * 12 = 60s)
          const activePositions = this.positionManager.getActivePositions();
          log.info(`💓 Heartbeat | Loop #${loopCount} | Active positions: ${activePositions.length} | Monitored tokens: ${this.monitor.getAllTokens().size}`);
        }
        
        await this.processTokens();
        await this.sleep(5000); // Check every 5 seconds
      } catch (error) {
        log.error('Error in main loop', {
          error: error instanceof Error ? error.message : String(error)
        });
        await this.sleep(10000);
      }
    }
  }

  /**
   * Process detected tokens
   */
  private async processTokens(): Promise<void> {
    const tokens = this.monitor.getAllTokens();

    if (tokens.size === 0) {
      return; // Nothing to process yet
    }

    for (const [mint, launch] of tokens) {
      // Skip if already processed
      if (this.processedTokens.has(mint)) continue;

      // Skip if max positions reached
      const activePositions = this.positionManager.getActivePositions();
      if (activePositions.length >= 3) { // Max 3 concurrent positions
        log.warn(`⚠️  Max positions reached (${activePositions.length}/3) - skipping ${mint.slice(0, 8)}...`);
        
        // Log skipped token to rejection file
        const age = Date.now() / 1000 - launch.timestamp;
        this.rejectionLogger.logRejection({
          tokenMint: launch.mint,
          poolAddress: launch.poolAddress,
          reason: `Max positions reached (${activePositions.length}/3) - skipped`,
          liquidity: launch.liquiditySOL,
          age: age,
          timestamp: Date.now(),
          rejectionType: 'other'
        });
        continue;
      }

      // Mark as processing
      this.processedTokens.add(mint);
      this.stats.recordLaunch();

      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`🎯 PROCESSING NEW TOKEN`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Process this launch
      await this.processLaunch(launch);
      
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  }

  /**
   * Process a single launch
   */
  private async processLaunch(launch: TokenLaunch): Promise<void> {
    if (!this.keypair) {
      log.error('Cannot trade without wallet');
      return;
    }

    log.info('📋 Token Details:', {
      mint: launch.mint,
      liquidity: `${launch.liquiditySOL.toFixed(2)} SOL`,
      age: `${((Date.now() / 1000 - launch.timestamp) / 60).toFixed(1)}min`
    });

    log.info('🚪 Starting gate validation...');

    // Run all gates
    const validation = await this.validator.validate(
      launch,
      this.config.buyAmountSOL,
      this.keypair.publicKey.toBase58()
    );

    // Log all gate results with details
    log.info('📊 Gate Results:');
    for (const gate of validation.allGates) {
      if (gate.passed) {
        log.info(`  ✅ Gate ${gate.gate}: PASSED`);
      } else {
        log.warn(`  ❌ Gate ${gate.gate}: FAILED - ${gate.reason}`);
        
        this.stats.recordRejection({
          tokenMint: launch.mint,
          gate: gate.gate,
          reason: gate.reason || 'Unknown',
          timestamp: Date.now()
        });
        
        // Log to rejection file
        const age = Date.now() / 1000 - launch.timestamp;
        this.rejectionLogger.logRejection({
          tokenMint: launch.mint,
          poolAddress: launch.poolAddress,
          gate: gate.gate,
          reason: gate.reason || 'Unknown',
          liquidity: launch.liquiditySOL,
          age: age,
          timestamp: Date.now(),
          rejectionType: 'gate_rejection'
          // detectionLayer not available in TokenLaunch interface, skip it
        });
      }
    }

    if (!validation.passed) {
      log.warn(`🚫 REJECTED | Failed at Gate ${validation.failedGate}`, {
        mint: launch.mint.slice(0, 8) + '...',
        reason: validation.reason
      });
      return;
    }

    log.info('🎉 ✅ ALL GATES PASSED! 🎉');
    log.info(`💰 Executing BUY order for ${this.config.buyAmountSOL} SOL...`);

    // Execute buy
    const result = await this.executor.executeBuy(
      launch.mint,
      this.config.buyAmountSOL,
      this.config.gates.maxSlippageBps,
      this.keypair,
      !this.config.enableLiveTrading
    );

    if (result.success && result.amountOut) {
      // Only record successful trades
      this.stats.recordTrade({
        signature: result.signature || 'unknown',
        tokenMint: launch.mint,
        action: 'buy',
        amountSOL: this.config.buyAmountSOL,
        success: true,
        timestamp: Date.now()
      });

      log.info('🎊 BUY SUCCESSFUL! 🎊', {
        mint: launch.mint.slice(0, 8) + '...',
        signature: result.signature,
        amountOut: result.amountOut,
        priceImpact: result.priceImpact?.toFixed(2) + '%'
      });

      // Open position
      await this.positionManager.openPosition(
        launch.mint,
        result.amountOut,
        this.config.buyAmountSOL,
        result.signature || 'unknown'
      );
    } else {
      // Log execution failure to rejection log (not trades.log)
      log.error('❌ BUY FAILED', {
        mint: launch.mint.slice(0, 8) + '...',
        error: result.error
      });
      
      // Log to rejection file
      const age = Date.now() / 1000 - launch.timestamp;
      this.rejectionLogger.logRejection({
        tokenMint: launch.mint,
        poolAddress: launch.poolAddress,
        reason: result.error || 'Buy execution failed',
        liquidity: launch.liquiditySOL,
        age: age,
        timestamp: Date.now(),
        rejectionType: 'execution_failed'
      });
    }
  }

  /**
   * Start periodic stats reporting
   */
  private startStatsReporting(): void {
    this.statsInterval = setInterval(() => {
      this.stats.printSummary();
    }, this.config.statsIntervalSeconds * 1000);
  }

  /**
   * Stop the sniper bot
   */
  async stop(): Promise<void> {
    log.info('🛑 Stopping sniper bot...');
    this.isRunning = false;

    // Stop stats reporting
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Stop components
    this.monitor.stop();
    this.positionManager.stop();

    // Print final stats
    this.stats.printSummary();
    
    // Write rejection log summary
    const breakdown = this.stats.getRejectionBreakdown();
    const breakdownMap = new Map<string, number>();
    for (const [gate, count] of Object.entries(breakdown)) {
      breakdownMap.set(gate, count);
    }
    this.rejectionLogger.writeSummary(
      this.stats.getTotalLaunches(),
      this.stats.getTotalRejections(),
      breakdownMap
    );
    
    log.info(`📝 Rejection log saved to: ${this.rejectionLogger.getLogDir()}`);

    log.info('✅ Sniper bot stopped');
  }

  /**
   * Get current statistics
   */
  getStats(): SniperStats {
    return this.stats;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

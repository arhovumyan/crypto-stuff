/**
 * Simulation Coordinator
 * Main orchestrator for replay simulations
 * Ties together all sandbox components with existing strategy modules
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { Pool } from 'pg';
import { createLogger } from '../logger.js';
import { ReplayConfig, SimulatedTrade, HistoricalSwapEvent, VirtualPosition, DEFAULT_EXECUTION_CONFIG } from './types.js';
import { ReplayTradeFeed } from './replay-trade-feed.js';
import { FillSimulator } from './fill-simulator.js';
import { VirtualPortfolioManager } from './virtual-portfolio.js';
import { AttributionEngine } from './attribution-engine.js';

// Import existing strategy modules
import { SellDetector } from '../sell-detector.js';
import { AbsorptionDetector } from '../absorption-detector.js';
import { InfraClassifier } from '../infra-classifier.js';
import { StabilizationChecker } from '../stabilization-checker.js';
import { EntryManager } from '../entry-manager.js';
import { PositionMonitor } from '../position-monitor.js';
import type { InfraSignalConfig, RawTrade } from '../types.js';

const log = createLogger('simulation-coordinator');

export class SimulationCoordinator extends EventEmitter {
  private config: ReplayConfig;
  private runId: string;
  private datasetHash: string = '';
  private configHash: string = '';
  private dbPool: Pool;
  private strategyConfig: Partial<InfraSignalConfig>;
  
  // Sandbox components
  private replayFeed: ReplayTradeFeed;
  private fillSimulator: FillSimulator;
  private portfolio: VirtualPortfolioManager;
  private attribution: AttributionEngine;
  
  // Strategy components (reused from live system)
  private sellDetector?: SellDetector;
  private absorptionDetector?: AbsorptionDetector;
  private infraClassifier?: InfraClassifier;
  private stabilizationChecker?: StabilizationChecker;
  private entryManager?: EntryManager;
  private positionMonitor?: PositionMonitor;
  
  private isRunning = false;
  private startTime: Date | null = null;
  private endTime: Date | null = null;

  constructor(config: ReplayConfig, dbConnectionString: string) {
    super();
    this.config = config;
    this.runId = this.generateRunId();
    
    // Initialize database pool
    this.dbPool = new Pool({ connectionString: dbConnectionString });
    
    // Build strategy config from scenario config
    this.strategyConfig = this.buildStrategyConfig();
    
    // Initialize sandbox components
    this.replayFeed = new ReplayTradeFeed(config.speed);
    this.fillSimulator = new FillSimulator(config.execution || DEFAULT_EXECUTION_CONFIG);
    this.portfolio = new VirtualPortfolioManager({
      startingCapitalSOL: config.startingCapitalSOL,
      maxPositionSizeSOL: config.maxPositionSizeSOL,
      maxConcurrentPositions: config.maxConcurrentPositions,
      riskPerTradePct: config.riskPerTradePct,
    });
    this.attribution = new AttributionEngine(this.runId, dbConnectionString);

    log.info('Simulation coordinator initialized', {
      runId: this.runId,
      dataset: config.datasetPath,
      speed: config.speed,
      startingCapital: config.startingCapitalSOL + ' SOL',
    });
  }

  /**
   * Build strategy config from scenario config
   */
  private buildStrategyConfig(): Partial<InfraSignalConfig> {
    return {
      minSellLiquidityPct: this.config.scenario.minSellPct || 1,
      maxSellLiquidityPct: this.config.scenario.maxSellPct || 3,
      minAbsorptionRatio: this.config.scenario.minAbsorptionRatio || 0.5,
      absorptionWindowMs: (this.config.scenario.absorptionWindowSlots || 20) * 400, // ~400ms per slot
      stabilizationTimeframeMs: (this.config.scenario.stabilizationWindowSlots || 200) * 400,
      minSignalStrength: this.config.scenario.minSignalStrength || 60,
      maxConcurrentPositions: this.config.maxConcurrentPositions,
      buyAmountSOL: this.config.maxPositionSizeSOL,
      paperTradingMode: true, // Always paper mode in simulation
      sellDetectionWindowMs: 60000,
      stopLossPct: 10,
      takeProfitPct: 20,
    };
  }

  /**
   * Initialize strategy components
   */
  private async initializeStrategyComponents(): Promise<void> {
    log.info('Strategy components initialization skipped for Phase 2');
    log.info('Using simplified signal generation for now');
    
    // TODO: Wire real modules after adapting their interfaces for simulation mode
    // For now, we'll use simplified logic in handleTrade
  }

  /**
   * Handle an entry signal (simulation mode)
   */
  private async handleEntrySignal(tokenMint: string, priceSOL: number, metadata: any): Promise<void> {
    try {
      log.info('Entry signal generated', {
        token: tokenMint,
        price: priceSOL,
      });

      // Check if we have position slots
      const portfolio = this.portfolio.getPortfolio();
      if (portfolio.openPositions.length >= this.config.maxConcurrentPositions) {
        log.info('Max positions reached, skipping entry');
        return;
      }

      // Simulate entry execution
      const entrySlot = Math.floor(Date.now() / 400); // rough estimate
      const fillResult = await this.fillSimulator.simulateFill(
        'buy',
        this.config.maxPositionSizeSOL,
        tokenMint,
        entrySlot
      );

      if (!fillResult.success) {
        log.info('Fill simulation failed', {
          token: tokenMint,
          reason: fillResult.failureReason,
        });
        return;
      }

      // Open virtual position
      const position = await this.portfolio.openPosition(
        tokenMint,
        metadata.poolAddress || tokenMint,
        entrySlot,
        fillResult, // FillResult object
        this.config.maxPositionSizeSOL
      );

      if (position) {
        log.info('Virtual position opened', { token: tokenMint, entry: fillResult.fillPrice.toFixed(8) + ' SOL', size: this.config.maxPositionSizeSOL + ' SOL' });
      }

    } catch (error) {
      log.error('Error handling entry signal', { err: error });
    }
  }

  /**
   * Run simulation
   */
  async run(): Promise<void> {
    try {
      this.isRunning = true;
      this.startTime = new Date();

      log.info('🚀 Starting simulation', {
        runId: this.runId,
        dataset: this.config.datasetPath,
      });

      // 1. Load dataset
      await this.loadDataset();

      // 2. Compute hashes (for determinism)
      await this.computeHashes();

      // 3. Initialize strategy components (ENABLED NOW)
      await this.initializeStrategyComponents();

      // 4. Start replay
      await this.startReplay();

      // 5. Set end time
      this.endTime = new Date();
      
      // 6. Generate report
      await this.generateReport();

      this.isRunning = false;

      log.info('✅ Simulation complete', {
        runId: this.runId,
        duration: ((this.endTime.getTime() - this.startTime.getTime()) / 1000).toFixed(1) + 's',
      });

      this.emit('complete', this.runId);
    } catch (error) {
      this.isRunning = false;
      log.error('Simulation failed', { error });
      this.emit('error', error);
      throw error;
    } finally {
      // Clean up
      await this.cleanup();
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      await this.dbPool.end();
      log.info('Database pool closed');
    } catch (error) {
      log.error('Error during cleanup', { error });
    }
  }

  /**
   * Load dataset from file
   */
  private async loadDataset(): Promise<void> {
    log.info('Loading dataset', { path: this.config.datasetPath });
    
    await this.replayFeed.loadDataset(
      this.config.datasetPath,
      this.config.startSlot,
      this.config.endSlot
    );

    log.info('Dataset loaded');
  }

  /**
   * Compute hashes for determinism
   */
  private async computeHashes(): Promise<void> {
    // Dataset hash (simplified - would hash file contents in production)
    this.datasetHash = crypto
      .createHash('sha256')
      .update(this.config.datasetPath)
      .digest('hex')
      .slice(0, 16);

    // Config hash
    this.configHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(this.config))
      .digest('hex')
      .slice(0, 16);

    log.info('Hashes computed', {
      datasetHash: this.datasetHash,
      configHash: this.configHash,
    });
  }

  /**
   * Start replay
   */
  private async startReplay(): Promise<void> {
    log.info('Starting replay');

    // Listen for trades
    this.replayFeed.on('trade', async (trade) => {
      await this.handleTrade(trade);
    });

    // Listen for completion
    this.replayFeed.on('complete', () => {
      log.info('Replay complete');
    });

    // Start the feed
    await this.replayFeed.start();
  }

  /**
   * Handle a trade from replay
   */
  private async handleTrade(event: HistoricalSwapEvent): Promise<void> {
    try {
      // Simplified signal generation for Phase 2
      // TODO: Wire real detection modules in Phase 3
      
      // Update open positions with current price
      const portfolio = this.portfolio.getPortfolio();
      for (const position of portfolio.openPositions) {
        if (position.tokenMint === event.tokenMint) {
          // Update position MAE/MFE
          this.portfolio.updatePosition(
            position.positionId,
            event.poolState.priceSOL
          );

          // Check exit conditions
          await this.checkPositionExit(position, event);
        }
      }

      // Simple signal logic: detect large sells
      if (event.side === 'sell') {
        const liquidityUSD = event.poolState.liquidityUSD || 0;
        if (liquidityUSD > 0) {
          const sellPct = (event.amountInSOL * event.poolState.priceSOL * 150) / liquidityUSD * 100; // rough USD conversion
          
          const minSell = this.strategyConfig.minSellLiquidityPct || 1;
          const maxSell = this.strategyConfig.maxSellLiquidityPct || 3;
          if (sellPct >= minSell && sellPct <= maxSell) {
            log.info('Large sell detected', {
              token: event.tokenMint,
              sellPct: sellPct.toFixed(2) + '%',
              amountSOL: event.amountInSOL.toFixed(4),
            });

            // For now, generate entry signal immediately (in real system, would wait for absorption + stabilization)
            // This is just to test the simulation pipeline
            // await this.handleEntrySignal(event.tokenMint, event.poolState.priceSOL, {
            //   largeSell: event,
            //   detectionTime: event.blockTime,
            // });
          }
        }
      }

    } catch (error) {
      log.error('Error handling trade', { error });
    }
  }

  /**
   * Check if a position should be exited
   */
  private async checkPositionExit(position: VirtualPosition, currentEvent: HistoricalSwapEvent): Promise<void> {
    const currentPrice = currentEvent.poolState.priceSOL;
    const pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    let exitReason: string | null = null;

    // Check stop loss
    const stopLoss = this.strategyConfig.stopLossPct || 10;
    if (pnlPct <= -stopLoss) {
      exitReason = 'stop_loss';
    }

    // Check take profit
    const takeProfit = this.strategyConfig.takeProfitPct || 20;
    if (pnlPct >= takeProfit) {
      exitReason = 'take_profit';
    }

    // Check time stop (simplified - use 20 minutes = ~3000 slots at 400ms/slot)
    const holdTimeSlots = currentEvent.slot - position.entrySlot;
    if (holdTimeSlots >= 3000) {
      exitReason = 'time_stop';
    }

    // Check infra distribution (simplified - would need full position monitor logic)
    // TODO: Integrate with PositionMonitor distribution detection

    if (exitReason) {
      // Simulate exit execution
      const fillResult = await this.fillSimulator.simulateFill(
        'sell',
        position.entryAmountSOL,
        position.tokenMint,
        currentEvent.slot
      );

      if (fillResult.success) {
        // Close position
        const closedPosition = await this.portfolio.closePosition(
          position.positionId,
          currentEvent.slot,
          exitReason,
          fillResult
        );

        if (closedPosition) {
          const pnlSOL = closedPosition.pnlSOL || 0;
          const pnlPct = closedPosition.pnlPct || 0;
          log.info('Virtual position closed', {
            token: closedPosition.tokenMint,
            exit: fillResult.fillPrice.toFixed(8) + ' SOL',
            pnl: pnlSOL.toFixed(4) + ' SOL',
            pnlPct: pnlPct.toFixed(2) + '%',
            reason: exitReason,
          });
        }
      }
    }
  }

  /**
   * Generate final report
   */
  private async generateReport(): Promise<void> {
    if (!this.startTime || !this.endTime) {
      throw new Error('Simulation not complete');
    }

    log.info('Generating report');

    const report = await this.attribution.generateReport(
      this.config.datasetPath,
      this.datasetHash,
      this.configHash,
      this.startTime,
      this.endTime,
      this.portfolio.getPortfolio()
    );

    // Export to files
    await this.attribution.exportReport(report, this.config.outputDir);

    log.info('Report exported', { outputDir: this.config.outputDir });
  }

  /**
   * Generate run ID
   */
  private generateRunId(): string {
    return `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Stop simulation
   */
  stop(): void {
    this.isRunning = false;
    this.replayFeed.stop();
    log.info('Simulation stopped');
  }

  /**
   * Get progress
   */
  getProgress(): { current: number; total: number; percentage: number } {
    return this.replayFeed.getProgress();
  }

  /**
   * Get run ID
   */
  getRunId(): string {
    return this.runId;
  }
}


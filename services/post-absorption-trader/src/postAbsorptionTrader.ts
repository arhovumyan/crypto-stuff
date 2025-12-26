import { config } from './config';
import logger from './logger';
import { WalletListener } from './walletListener';
import { AbsorptionDetector } from './absorptionDetector';
import { StabilizationMonitor } from './stabilizationMonitor';
import { TradingExecutor } from './tradingExecutor';

/**
 * PostAbsorptionTrader - Main orchestrator
 * 
 * This is NOT a copy trading bot. This is a post-absorption trading system.
 * 
 * What it does:
 * 1. Monitors infrastructure wallets for liquidity absorption events
 * 2. Detects when they absorb large sell pressure
 * 3. Waits for price stabilization
 * 4. Enters positions AFTER confirmation
 * 5. Manages exits with profit targets and stop losses
 * 
 * This is second-order flow trading - we trade the equilibrium that forms
 * after infrastructure wallets neutralize sell imbalances.
 */
export class PostAbsorptionTrader {
  private walletListener: WalletListener;
  private absorptionDetector: AbsorptionDetector;
  private stabilizationMonitor: StabilizationMonitor;
  private tradingExecutor: TradingExecutor;

  constructor() {
    this.walletListener = new WalletListener();
    this.absorptionDetector = new AbsorptionDetector();
    this.stabilizationMonitor = new StabilizationMonitor();
    this.tradingExecutor = new TradingExecutor();
  }

  /**
   * Start the trading system
   */
  async start(): Promise<void> {
    logger.info('='.repeat(80));
    logger.info('[PostAbsorptionTrader] Starting Post-Absorption Trading System');
    logger.info('='.repeat(80));
    logger.info('');
    logger.info('📖 STRATEGY: Post-Liquidity Absorption Trading');
    logger.info('');
    logger.info('We trade AFTER infrastructure wallets absorb large sell pressure.');
    logger.info('This is NOT copy trading. This is NOT front-running.');
    logger.info('We wait for absorption + stabilization, then enter the new equilibrium.');
    logger.info('');
    logger.info('='.repeat(80));
    logger.info('');

    // Set up transaction handler
    this.walletListener.onTransaction((tx) => {
      this.absorptionDetector.processTransaction(tx);
    });

    // Start wallet listener
    await this.walletListener.start();

    // Start main monitoring loop
    this.startMonitoringLoop();

    logger.info('[PostAbsorptionTrader] System started successfully');
    logger.info('');
  }

  /**
   * Main monitoring loop
   * Continuously checks for absorption events and manages positions
   */
  private startMonitoringLoop(): void {
    setInterval(async () => {
      try {
        await this.processAbsorptionEvents();
        await this.printStatus();
      } catch (error) {
        logger.error('[PostAbsorptionTrader] Error in monitoring loop:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Process detected absorption events
   */
  private async processAbsorptionEvents(): Promise<void> {
    const events = this.absorptionDetector.getActiveAbsorptionEvents();

    for (const event of events) {
      try {
        if (event.status === 'detected') {
          // Start monitoring for stabilization
          logger.info(`[PostAbsorptionTrader] Starting stabilization monitoring for ${event.token.slice(0, 8)}...`);
          await this.stabilizationMonitor.startMonitoring(event);
          this.absorptionDetector.updateAbsorptionEventStatus(event.token, 'monitoring');
        } else if (event.status === 'monitoring') {
          // Check if stabilized
          const analysis = await this.stabilizationMonitor.checkStabilization(event);

          if (analysis.isStable) {
            logger.info(`[PostAbsorptionTrader] Stabilization confirmed for ${event.token.slice(0, 8)}... - attempting entry`);
            
            // Try to enter position
            const position = await this.tradingExecutor.enterPosition(event, analysis);
            
            if (position) {
              this.absorptionDetector.updateAbsorptionEventStatus(event.token, 'entered');
              this.stabilizationMonitor.stopMonitoring(event.token);
            } else {
              this.absorptionDetector.updateAbsorptionEventStatus(
                event.token,
                'rejected',
                'Failed to enter position (risk limits or execution error)'
              );
              this.stabilizationMonitor.stopMonitoring(event.token);
            }
          } else {
            // Check if monitoring period expired
            const now = Date.now() / 1000;
            const monitoringTime = now - event.detectedAt;
            const maxMonitoringTime = config.stabilization.monitorDurationSec * 3; // 3x normal duration

            if (monitoringTime > maxMonitoringTime) {
              logger.warn(`[PostAbsorptionTrader] Stabilization monitoring timed out for ${event.token.slice(0, 8)}...`);
              this.absorptionDetector.updateAbsorptionEventStatus(
                event.token,
                'expired',
                'Stabilization not achieved within time limit'
              );
              this.stabilizationMonitor.stopMonitoring(event.token);
            }
          }
        }
      } catch (error) {
        logger.error(`[PostAbsorptionTrader] Error processing absorption event for ${event.token}:`, error);
      }
    }
  }

  /**
   * Print system status
   */
  private async printStatus(): Promise<void> {
    const riskMetrics = this.tradingExecutor.getRiskMetrics();
    const openPositions = this.tradingExecutor.getOpenPositions();
    const activeAbsorptions = this.absorptionDetector.getActiveAbsorptionEvents();

    // Only print if there's activity
    if (openPositions.length > 0 || activeAbsorptions.length > 0) {
      logger.info('');
      logger.info('━'.repeat(80));
      logger.info('[Status Update]');
      logger.info(`  📊 Active Absorptions: ${activeAbsorptions.length}`);
      logger.info(`  💼 Open Positions: ${riskMetrics.openPositions}/${config.entry.maxPositions}`);
      logger.info(`  💰 Daily P&L: $${riskMetrics.dailyPnlUsd.toFixed(2)} (${riskMetrics.dailyTradeCount} trades)`);
      logger.info(`  📈 Portfolio Exposure: $${riskMetrics.totalExposureUsd.toFixed(2)}`);
      
      if (openPositions.length > 0) {
        logger.info('');
        logger.info('  Open Positions:');
        openPositions.forEach(pos => {
          const holdTime = (Date.now() / 1000 - pos.entryTime) / 60; // minutes
          logger.info(`    - ${pos.tokenSymbol || pos.token.slice(0, 8)}: ${pos.unrealizedPnlPercent?.toFixed(2)}% (${holdTime.toFixed(0)}m hold)`);
        });
      }
      
      logger.info('━'.repeat(80));
      logger.info('');
    }
  }

  /**
   * Stop the trading system
   */
  async stop(): Promise<void> {
    logger.info('[PostAbsorptionTrader] Stopping system...');
    await this.walletListener.stop();
    logger.info('[PostAbsorptionTrader] System stopped');
  }
}

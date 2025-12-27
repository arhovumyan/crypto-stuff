/**
 * Main Orchestrator
 * Coordinates all components and manages the bot lifecycle
 */

import { config } from './config';
import { Logger } from './logger';
import { PumpfunDiscovery, TokenCreationEvent } from './discovery';
import { TokenTracker, TrackedToken } from './token-tracker';
import { JupiterExecutor } from './jupiter-executor';
import { PositionManager } from './position-manager';

class PumpTraderBot {
  private discovery: PumpfunDiscovery;
  private tracker: TokenTracker;
  private executor: JupiterExecutor;
  private positionManager: PositionManager;
  private isRunning: boolean = false;

  constructor() {
    this.discovery = new PumpfunDiscovery();
    this.tracker = new TokenTracker();
    this.executor = new JupiterExecutor();
    this.positionManager = new PositionManager(this.executor);
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      Logger.error('Bot is already running', new Error('Already running'));
      return;
    }

    Logger.systemStart();
    Logger.setLevel(config.logLevel);

    console.log(`Wallet Address: ${this.executor.getWalletAddress()}`);
    console.log(`Buy Amount: ${config.buyAmountSol} SOL per trade`);
    console.log(`Profit Target: ${config.profitTargetMultiplier}x (${((config.profitTargetMultiplier - 1) * 100).toFixed(0)}%)`);
    console.log(`Max Slippage: ${config.slippageBps / 100}%`);
    console.log('');

    this.isRunning = true;

    // Set up token tracker callback
    this.tracker.onReadyToBuy = (token) => this.handleReadyToBuy(token);

    // Start discovery
    await this.discovery.start((event) => this.handleTokenCreation(event));

    // Set up graceful shutdown
    this.setupShutdownHandlers();
  }

  /**
   * Handle new token creation event
   */
  private async handleTokenCreation(event: TokenCreationEvent): Promise<void> {
    try {
      await this.tracker.discoverToken(event.mint, event.signature);
    } catch (error: any) {
      Logger.error(`Error handling token creation for ${event.mint}`, error);
    }
  }

  /**
   * Handle token ready to buy
   */
  private async handleReadyToBuy(token: TrackedToken): Promise<void> {
    try {
      // Check if we already have a position for this token
      if (this.positionManager.hasPosition(token.mint)) {
        Logger.debug(`Already have position for ${token.mint}, skipping`);
        return;
      }

      // Check max positions limit
      const currentPositions = this.positionManager.getPositions();
      if (currentPositions.length >= 3) {
        Logger.debug(`Already at max positions (${currentPositions.length}), skipping ${token.mint}`);
        return;
      }

      // Execute buy
      const success = await this.positionManager.openPosition(
        token.mint,
        config.buyAmountSol
      );

      if (success) {
        // Position opened successfully and is now being monitored
      }

    } catch (error: any) {
      Logger.error(`Error handling ready to buy for ${token.mint}`, error);
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (!this.isRunning) return;

      Logger.systemShutdown();
      this.isRunning = false;

      // Stop discovery
      this.discovery.stop();

      // Stop position monitoring
      this.positionManager.stopMonitoring();

      // Log final state
      const positions = this.positionManager.getPositions();
      if (positions.length > 0) {
        console.log('\n⚠️  WARNING: Shutting down with open positions:');
        positions.forEach(pos => {
          console.log(`  - ${pos.mint}: ${pos.tokenBalance} tokens (invested ${pos.solInvested} SOL)`);
        });
        console.log('\nThese positions will NOT be automatically closed.');
        console.log('You can restart the bot to continue monitoring them.\n');
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      Logger.error('Uncaught exception', error);
      shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('Unhandled rejection', reason);
    });
  }

  /**
   * Get bot status
   */
  getStatus(): object {
    return {
      isRunning: this.isRunning,
      trackedTokens: this.tracker.getAllTokens().length,
      openPositions: this.positionManager.getPositions().length,
      positions: this.positionManager.getPositions().map(pos => ({
        mint: pos.mint,
        invested: pos.solInvested,
        tokens: pos.tokenBalance,
        entryTime: pos.entryTime,
      })),
    };
  }
}

// Main entry point
async function main() {
  const bot = new PumpTraderBot();
  await bot.start();
}

// Run the bot
if (require.main === module) {
  main().catch((error) => {
    Logger.error('Fatal error starting bot', error);
    process.exit(1);
  });
}

export { PumpTraderBot };

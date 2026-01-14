import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config';
import { createModuleLogger } from './logger';
import { Database } from './database';
import { MarketDataModule } from './modules/MarketData';
import { SignalEngine } from './modules/SignalEngine';
import { RiskManager } from './modules/RiskManager';
import { ExecutionEngine } from './modules/ExecutionEngine';
import { PositionTracker } from './modules/PositionTracker';
import {
  MarketUpdate,
  TradeIntent,
  ExitIntent,
  FillEvent,
  Side,
} from './types';

const mainLogger = createModuleLogger('Orchestrator');

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export class DeathShotBot {
  private connection: Connection;
  private wallet: Keypair;
  private database: Database;

  // Modules
  private marketData!: MarketDataModule;
  private signalEngine!: SignalEngine;
  private riskManager!: RiskManager;
  private executionEngine!: ExecutionEngine;
  private positionTracker!: PositionTracker;

  private isRunning = false;
  private monitoredMarkets: Set<string> = new Set();

  constructor() {
    // Initialize connection
    this.connection = new Connection(config.rpc.httpUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.rpc.wsUrl,
    });

    // Initialize wallet
    if (!config.wallet.privateKey) {
      mainLogger.warn('⚠️  No wallet configured - running in monitoring-only mode');
      mainLogger.warn('Set COPY_WALLET_PRIVATE_KEY in .env to enable trading');
      // Create a dummy wallet for monitoring-only mode
      this.wallet = Keypair.generate();
    } else {
      try {
        const privateKeyBytes = bs58.decode(config.wallet.privateKey);
        if (privateKeyBytes.length !== 64) {
          throw new Error(`Expected 64 bytes, got ${privateKeyBytes.length}`);
        }
        this.wallet = Keypair.fromSecretKey(privateKeyBytes);
      } catch (err) {
        mainLogger.error({ error: err }, '❌ Invalid wallet private key format');
        mainLogger.error('Private key must be a base58-encoded 64-byte secret key (88 chars)');
        mainLogger.error('Found in .env: COPY_WALLET_PRIVATE_KEY=' + config.wallet.privateKey.slice(0, 20) + '...');
        mainLogger.error('This looks like a PUBLIC key (44 chars), not a SECRET key (88 chars)');
        mainLogger.warn('Continuing in monitoring-only mode with dummy wallet');
        this.wallet = Keypair.generate();
      }
    }

    // Initialize database
    this.database = new Database();
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    mainLogger.info('🚀 Starting DeathShot Trading Bot');
    mainLogger.info({ walletAddress: this.wallet.publicKey.toBase58() }, 'Wallet configured');

    // Connect to database
    await this.database.connect();

    // Initialize modules
    this.marketData = new MarketDataModule(this.connection, this.database);
    this.signalEngine = new SignalEngine(config.signal);
    this.riskManager = new RiskManager(config.risk, this.database);
    this.executionEngine = new ExecutionEngine(
      this.connection,
      this.wallet,
      this.database,
      config.trading.paperTrading
    );
    this.positionTracker = new PositionTracker(config.exit, this.database);

    // Start modules
    await this.marketData.start();
    await this.signalEngine.start();
    await this.riskManager.start();
    await this.executionEngine.start();
    await this.positionTracker.start();

    // Wire up event handlers
    this.setupEventHandlers();

    this.isRunning = true;

    mainLogger.info('✅ DeathShot Trading Bot started successfully');

    // Display status
    this.displayStatus();
  }

  async stop(): Promise<void> {
    mainLogger.info('🛑 Stopping DeathShot Trading Bot');

    this.isRunning = false;

    // Stop modules
    await this.positionTracker.stop();
    await this.executionEngine.stop();
    await this.riskManager.stop();
    await this.signalEngine.stop();
    await this.marketData.stop();

    // Disconnect database
    await this.database.disconnect();

    mainLogger.info('✅ DeathShot Trading Bot stopped');
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  private setupEventHandlers(): void {
    // MarketData -> SignalEngine
    this.marketData.on('marketUpdate', (market: MarketUpdate) => {
      this.signalEngine.onMarketUpdate(market);
      this.positionTracker.updateMarketData(market);
    });

    // MarketData health
    this.marketData.on('marketUnhealthy', (marketId: string) => {
      mainLogger.warn({ marketId }, 'Market unhealthy');
      this.riskManager.setSystemHealth(false);
    });

    // SignalEngine -> RiskManager
    this.signalEngine.on('tradeIntent', async (intent: TradeIntent) => {
      await this.handleTradeIntent(intent);
    });

    // PositionTracker -> ExecutionEngine (exits)
    this.positionTracker.on('exitIntent', async (exitIntent: ExitIntent) => {
      await this.handleExitIntent(exitIntent);
    });

    // ExecutionEngine -> PositionTracker (fills)
    this.executionEngine.on('fillEvent', async (fill: FillEvent) => {
      await this.positionTracker.onFillEvent(fill);
    });

    // PositionTracker -> RiskManager (position updates)
    this.positionTracker.on('positionOpened', (position) => {
      this.riskManager.addPosition(position);
    });

    this.positionTracker.on('positionClosed', (position) => {
      this.riskManager.updatePosition(position);
    });

    this.positionTracker.on('positionFailed', (position) => {
      this.riskManager.removePosition(position.id);
    });

    // Risk Manager emergency
    this.riskManager.on('emergencyStop', () => {
      mainLogger.error('🚨 EMERGENCY STOP TRIGGERED');
      // You could call this.stop() here if desired
    });
  }

  // ============================================================================
  // BUSINESS LOGIC
  // ============================================================================

  private async handleTradeIntent(intent: TradeIntent): Promise<void> {
    mainLogger.info({
      intentId: intent.intentId,
      marketId: intent.marketId,
      dropPct: intent.dropPct.toFixed(2),
      sizeSol: intent.sizeSol,
    }, 'Processing trade intent');

    // Pass through RiskManager
    const decision = await this.riskManager.evaluate(intent);

    if (decision.type === 'REJECTED') {
      mainLogger.warn({
        intentId: intent.intentId,
        reasons: decision.reasons,
      }, 'Trade intent rejected');
      return;
    }

    // Execute the trade
    await this.executeEntry(intent);
  }

  private async executeEntry(intent: TradeIntent): Promise<void> {
    // For MVP, we'll assume we're buying a specific token with SOL
    // In production, you'd parse the market ID to determine input/output mints

    // Example: Assume we're buying a token (output) with SOL (input)
    const inputMint = SOL_MINT; // Paying with SOL
    const outputMint = this.parseTokenMintFromMarket(intent.marketId);

    if (!outputMint) {
      mainLogger.error({ marketId: intent.marketId }, 'Could not determine output mint');
      return;
    }

    // Create position
    const position = await this.positionTracker.createPosition(
      intent.intentId,
      intent.marketId,
      'pending'
    );

    // Execute swap
    const result = await this.executionEngine.executeSwap(
      intent,
      inputMint,
      outputMint,
      position.id
    );

    if (result.status === 'FAILED') {
      mainLogger.error({
        positionId: position.id,
        reason: result.reason,
      }, 'Entry execution failed');

      await this.positionTracker.failPosition(position.id, result.reason);
    }
  }

  private async handleExitIntent(exitIntent: ExitIntent): Promise<void> {
    mainLogger.info({
      positionId: exitIntent.positionId,
      marketId: exitIntent.marketId,
      exitReason: exitIntent.exitReason,
    }, 'Processing exit intent');

    const position = this.positionTracker.getPosition(exitIntent.positionId);
    if (!position) {
      mainLogger.error({ positionId: exitIntent.positionId }, 'Position not found');
      return;
    }

    if (position.state.type !== 'OPEN') {
      mainLogger.warn({ positionId: position.id, state: position.state.type }, 'Position not open');
      return;
    }

    // Create exit trade intent
    const exitTradeIntent: TradeIntent = {
      intentId: `exit_${Date.now()}`,
      timestamp: new Date(),
      marketId: exitIntent.marketId,
      side: Side.Sell,
      sizeSol: position.state.entryAmount,
      referencePrice: position.state.entryPrice,
      currentPrice: exitIntent.currentPrice,
      dropPct: 0,
      liquiditySol: 0,
      estimatedSlippage: 0,
      reasonCodes: [`EXIT_${exitIntent.exitReason}`],
    };

    // Pass through RiskManager (yes, exits also go through risk checks)
    const decision = await this.riskManager.evaluate(exitTradeIntent);

    if (decision.type === 'REJECTED') {
      mainLogger.warn({
        positionId: position.id,
        reasons: decision.reasons,
      }, 'Exit intent rejected');
      return;
    }

    // Execute the exit
    await this.executeExit(position.id, exitIntent, exitTradeIntent);
  }

  private async executeExit(
    positionId: string,
    exitIntent: ExitIntent,
    tradeIntent: TradeIntent
  ): Promise<void> {
    // For exit, we're selling the token back to SOL
    const inputMint = this.parseTokenMintFromMarket(exitIntent.marketId);
    const outputMint = SOL_MINT;

    if (!inputMint) {
      mainLogger.error({ marketId: exitIntent.marketId }, 'Could not determine input mint');
      return;
    }

    // Mark position as pending close
    await this.positionTracker.markPositionPendingClose(positionId, 'pending');

    // Execute swap
    const result = await this.executionEngine.executeSwap(
      tradeIntent,
      inputMint,
      outputMint,
      positionId
    );

    if (result.status === 'FAILED') {
      mainLogger.error({
        positionId,
        reason: result.reason,
      }, 'Exit execution failed');

      await this.positionTracker.failPosition(positionId, result.reason);
    }
  }

  // ============================================================================
  // MARKET MANAGEMENT
  // ============================================================================

  async addMarket(
    marketId: string,
    poolAddress: string,
    baseVault: string,
    quoteVault: string
  ): Promise<void> {
    if (this.monitoredMarkets.has(marketId)) {
      mainLogger.warn({ marketId }, 'Market already monitored');
      return;
    }

    await this.marketData.addMarket(marketId, {
      poolAddress: new PublicKey(poolAddress),
      baseVault: new PublicKey(baseVault),
      quoteVault: new PublicKey(quoteVault),
    });

    this.monitoredMarkets.add(marketId);

    mainLogger.info({ marketId }, 'Market added to monitoring');
  }

  removeMarket(marketId: string): void {
    this.marketData.removeMarket(marketId);
    this.monitoredMarkets.delete(marketId);

    mainLogger.info({ marketId }, 'Market removed from monitoring');
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private parseTokenMintFromMarket(marketId: string): PublicKey | null {
    // In MVP, you'd parse the market ID to extract the token mint
    // For now, we'll return a placeholder
    // In production, marketId might be "RAYDIUM_SOL_BONK" or contain the mint address
    try {
      // If marketId is a PublicKey
      return new PublicKey(marketId);
    } catch {
      // If not, you'd need a lookup table or naming convention
      mainLogger.warn({ marketId }, 'Could not parse token mint from market ID');
      return null;
    }
  }

  // ============================================================================
  // STATUS & MONITORING
  // ============================================================================

  private displayStatus(): void {
    const riskState = this.riskManager.getRiskState();

    mainLogger.info('═══════════════════════════════════════════');
    mainLogger.info('📊 DEATHSHOT TRADING BOT STATUS');
    mainLogger.info('═══════════════════════════════════════════');
    mainLogger.info(`🔑 Wallet: ${this.wallet.publicKey.toBase58()}`);
    mainLogger.info(`📈 Markets Monitored: ${this.monitoredMarkets.size}`);
    mainLogger.info(`📊 Open Positions: ${riskState.openPositions}`);
    mainLogger.info(`💰 Daily PnL: ${riskState.dailyPnlSol.toFixed(4)} SOL`);
    mainLogger.info(`🔄 Hourly Trades: ${riskState.hourlyTradeCount}`);
    mainLogger.info(`🏥 System Health: ${riskState.systemHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    mainLogger.info(`📝 Mode: ${config.trading.paperTrading ? '📄 PAPER TRADING' : '🔴 LIVE TRADING'}`);
    mainLogger.info('═══════════════════════════════════════════');
  }

  getStatus(): any {
    const riskState = this.riskManager.getRiskState();
    const openPositions = this.positionTracker.getOpenPositions();

    return {
      isRunning: this.isRunning,
      wallet: this.wallet.publicKey.toBase58(),
      marketsMonitored: this.monitoredMarkets.size,
      openPositions: riskState.openPositions,
      dailyPnlSol: riskState.dailyPnlSol,
      hourlyTradeCount: riskState.hourlyTradeCount,
      systemHealthy: riskState.systemHealthy,
      paperTrading: config.trading.paperTrading,
      positions: openPositions.map((p) => ({
        id: p.id,
        marketId: p.marketId,
        state: p.state.type,
        ...(p.state.type === 'OPEN' && {
          entryPrice: p.state.entryPrice,
          entryAmount: p.state.entryAmount,
          unrealizedPnl: this.positionTracker.getUnrealizedPnL(p.id),
        }),
      })),
    };
  }

  // Public API for dynamic configuration
  updateSignalConfig(config: any): void {
    this.signalEngine.updateConfig(config);
  }

  updateRiskConfig(config: any): void {
    this.riskManager.updateConfig(config);
  }

  updateExitConfig(config: any): void {
    this.positionTracker.updateExitConfig(config);
  }
}

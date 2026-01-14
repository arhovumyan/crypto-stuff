import { EventEmitter } from 'events';
import {
  Position,
  PositionStateType,
  ExitConfig,
  ExitIntent,
  ExitReason,
  FillEvent,
  MarketUpdate,
} from '../types';
import { createModuleLogger } from '../logger';
import { Database } from '../database';

const logger = createModuleLogger('PositionTracker');

const MIN_EXIT_LIQUIDITY_SOL = 500; // Minimum liquidity to safely exit

export class PositionTracker extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private exitConfig: ExitConfig;
  private database: Database;
  private marketData: Map<string, MarketUpdate> = new Map();

  constructor(exitConfig: ExitConfig, database: Database) {
    super();
    this.exitConfig = exitConfig;
    this.database = database;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    logger.info('Starting PositionTracker module');
    logger.info({ config: this.exitConfig }, 'Exit configuration');

    // Load open positions from database
    await this.loadOpenPositions();

    // Start monitoring loop
    this.startMonitoring();
  }

  async stop(): Promise<void> {
    logger.info('Stopping PositionTracker module');
  }

  // ============================================================================
  // POSITION MANAGEMENT
  // ============================================================================

  async createPosition(intentId: string, marketId: string, txSignature: string): Promise<Position> {
    const position: Position = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      intentId,
      marketId,
      state: {
        type: PositionStateType.PendingOpen,
        txSignature,
      },
      metadata: {
        createdAt: new Date().toISOString(),
      },
    };

    this.positions.set(position.id, position);
    await this.database.createPosition(position);

    logger.info({ positionId: position.id, marketId, intentId }, 'Position created');

    return position;
  }

  async onFillEvent(fill: FillEvent): Promise<void> {
    const position = this.positions.get(fill.positionId);
    if (!position) {
      logger.warn({ fillPositionId: fill.positionId }, 'Fill event for unknown position');
      return;
    }

    switch (position.state.type) {
      case PositionStateType.PendingOpen:
        // Entry fill - position is now open
        position.state = {
          type: PositionStateType.Open,
          entryPrice: fill.price,
          entryAmount: fill.amount,
          entryTime: fill.timestamp,
        };

        await this.database.updatePosition(position);

        logger.info({
          positionId: position.id,
          entryPrice: fill.price,
          entryAmount: fill.amount,
        }, 'Position opened');

        this.emit('positionOpened', position);
        break;

      case PositionStateType.PendingClose:
        // Exit fill - position is now closed
        const entryState = position.metadata.entryState as any;
        const realizedPnl = this.computeRealizedPnL(
          entryState.entryPrice,
          entryState.entryAmount,
          fill.price
        );

        position.state = {
          type: PositionStateType.Closed,
          exitPrice: fill.price,
          realizedPnlSol: realizedPnl,
          exitReason: fill.exitReason || ExitReason.EmergencyExit,
        };

        await this.database.updatePosition(position);
        await this.database.recordClosedPosition(position);

        logger.info({
          positionId: position.id,
          exitPrice: fill.price,
          realizedPnl: realizedPnl.toFixed(4),
          exitReason: position.state.exitReason,
        }, 'Position closed');

        this.emit('positionClosed', position);

        // Remove from tracking
        this.positions.delete(position.id);
        break;

      default:
        logger.warn({ positionId: position.id, state: position.state.type }, 'Unexpected state for fill event');
    }
  }

  updateMarketData(market: MarketUpdate): void {
    this.marketData.set(market.id, market);
  }

  // ============================================================================
  // EXIT MONITORING
  // ============================================================================

  private startMonitoring(): void {
    // Check exit conditions every 2 seconds
    setInterval(() => {
      this.monitorExits();
    }, 2000);
  }

  private async monitorExits(): Promise<void> {
    const exitIntents: ExitIntent[] = [];

    for (const position of this.positions.values()) {
      if (position.state.type !== PositionStateType.Open) {
        continue;
      }

      const market = this.marketData.get(position.marketId);
      if (!market) {
        continue; // No market data available
      }

      const currentPrice = this.getCurrentPrice(market);
      if (!currentPrice) {
        continue;
      }

      const { entryPrice, entryTime } = position.state;

      // Calculate unrealized PnL
      const unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      // Time held
      const timeHeldSeconds = (Date.now() - entryTime.getTime()) / 1000;

      // Check exit conditions
      let exitReason: ExitReason | null = null;

      // 1. Take profit
      if (unrealizedPnlPct >= this.exitConfig.takeProfitPct) {
        exitReason = ExitReason.TakeProfit;
        logger.info({
          positionId: position.id,
          unrealizedPnlPct: unrealizedPnlPct.toFixed(2),
          takeProfitPct: this.exitConfig.takeProfitPct,
        }, 'Take profit triggered');
      }

      // 2. Stop loss
      if (unrealizedPnlPct <= -this.exitConfig.stopLossPct) {
        exitReason = ExitReason.StopLoss;
        logger.info({
          positionId: position.id,
          unrealizedPnlPct: unrealizedPnlPct.toFixed(2),
          stopLossPct: this.exitConfig.stopLossPct,
        }, 'Stop loss triggered');
      }

      // 3. Time stop
      if (timeHeldSeconds > this.exitConfig.timeStopSeconds) {
        exitReason = ExitReason.TimeStop;
        logger.info({
          positionId: position.id,
          timeHeldSeconds: timeHeldSeconds.toFixed(0),
          timeStopSeconds: this.exitConfig.timeStopSeconds,
        }, 'Time stop triggered');
      }

      // 4. Liquidity collapse
      if (market.liquiditySol < MIN_EXIT_LIQUIDITY_SOL) {
        exitReason = ExitReason.LiquidityCollapse;
        logger.warn({
          positionId: position.id,
          liquiditySol: market.liquiditySol.toFixed(2),
          minRequired: MIN_EXIT_LIQUIDITY_SOL,
        }, 'Liquidity collapse detected');
      }

      if (exitReason) {
        exitIntents.push({
          positionId: position.id,
          marketId: position.marketId,
          exitReason,
          currentPrice,
        });
      }
    }

    // Emit exit intents
    for (const intent of exitIntents) {
      this.emit('exitIntent', intent);
    }
  }

  // ============================================================================
  // CALCULATIONS
  // ============================================================================

  private computeRealizedPnL(entryPrice: number, entryAmount: number, exitPrice: number): number {
    // Calculate value at entry vs exit
    // entryAmount is in SOL
    // We bought tokens at entryPrice, now selling at exitPrice
    const valueOut = entryAmount * (exitPrice / entryPrice);
    const realizedPnl = valueOut - entryAmount;

    return realizedPnl;
  }

  private getCurrentPrice(market: MarketUpdate): number | undefined {
    if (market.window.data.length === 0) return undefined;
    return market.window.data[market.window.data.length - 1].price;
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  private async loadOpenPositions(): Promise<void> {
    try {
      const positions = await this.database.getOpenPositions();
      for (const position of positions) {
        this.positions.set(position.id, position);
      }
      logger.info({ count: positions.length }, 'Loaded open positions for tracking');
    } catch (err) {
      logger.error({ err }, 'Failed to load open positions');
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.state.type === PositionStateType.Open
    );
  }

  getPositionsByMarket(marketId: string): Position[] {
    return Array.from(this.positions.values()).filter((p) => p.marketId === marketId);
  }

  async markPositionPendingClose(positionId: string, txSignature: string): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warn({ positionId }, 'Cannot mark unknown position as pending close');
      return;
    }

    if (position.state.type !== PositionStateType.Open) {
      logger.warn({ positionId, state: position.state.type }, 'Position not in OPEN state');
      return;
    }

    // Store entry state in metadata for later PnL calculation
    position.metadata.entryState = position.state;

    position.state = {
      type: PositionStateType.PendingClose,
      txSignature,
    };

    await this.database.updatePosition(position);

    logger.info({ positionId, txSignature }, 'Position marked as pending close');
  }

  async failPosition(positionId: string, reason: string): Promise<void> {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warn({ positionId }, 'Cannot fail unknown position');
      return;
    }

    position.state = {
      type: PositionStateType.Failed,
      reason,
    };

    await this.database.updatePosition(position);

    logger.error({ positionId, reason }, 'Position failed');

    this.emit('positionFailed', position);

    // Remove from tracking
    this.positions.delete(positionId);
  }

  updateExitConfig(config: Partial<ExitConfig>): void {
    this.exitConfig = { ...this.exitConfig, ...config };
    logger.info({ newConfig: this.exitConfig }, 'Exit configuration updated');
  }

  getUnrealizedPnL(positionId: string): number | null {
    const position = this.positions.get(positionId);
    if (!position || position.state.type !== PositionStateType.Open) {
      return null;
    }

    const market = this.marketData.get(position.marketId);
    if (!market) {
      return null;
    }

    const currentPrice = this.getCurrentPrice(market);
    if (!currentPrice) {
      return null;
    }

    const { entryPrice, entryAmount } = position.state;
    return this.computeRealizedPnL(entryPrice, entryAmount, currentPrice);
  }
}

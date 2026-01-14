import { EventEmitter } from 'events';
import {
  TradeIntent,
  RiskConfig,
  RiskState,
  RiskDecision,
  Position,
  PositionStateType,
} from '../types';
import { createModuleLogger } from '../logger';
import { Database } from '../database';

const logger = createModuleLogger('RiskManager');

export class RiskManager extends EventEmitter {
  private config: RiskConfig;
  private state: RiskState;
  private database: Database;
  private systemHealthy = true;

  constructor(config: RiskConfig, database: Database) {
    super();
    this.config = config;
    this.database = database;
    this.state = {
      openPositions: new Map(),
      dailyPnlSol: 0,
      dailyPnlResetTime: new Date(),
      hourlyTradeCount: [],
    };
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    logger.info('Starting RiskManager module');
    logger.info({ config: this.config }, 'Risk configuration');

    // Load open positions from database
    await this.loadOpenPositions();

    // Update daily PnL
    await this.updateDailyPnL();
  }

  async stop(): Promise<void> {
    logger.info('Stopping RiskManager module');
  }

  // ============================================================================
  // RISK EVALUATION
  // ============================================================================

  async evaluate(intent: TradeIntent): Promise<RiskDecision> {
    const rejectionReasons: string[] = [];

    // Check 1: Trade size limit
    if (intent.sizeSol > this.config.maxSolPerTrade) {
      rejectionReasons.push(
        `Trade size ${intent.sizeSol.toFixed(2)} SOL exceeds max ${this.config.maxSolPerTrade} SOL`
      );
    }

    // Check 2: Concurrent position limit
    if (this.state.openPositions.size >= this.config.maxConcurrentPositions) {
      rejectionReasons.push(
        `Already at max concurrent positions: ${this.state.openPositions.size}/${this.config.maxConcurrentPositions}`
      );
    }

    // Check 3: Per-token exposure
    const currentExposure = this.getTokenExposure(intent.marketId);
    const newExposure = currentExposure + intent.sizeSol;

    if (newExposure > this.config.maxExposurePerToken) {
      rejectionReasons.push(
        `Token exposure would exceed limit: ${currentExposure.toFixed(2)} + ${intent.sizeSol.toFixed(2)} > ${this.config.maxExposurePerToken} SOL`
      );
    }

    // Check 4: Daily loss limit
    await this.updateDailyPnL();

    if (this.state.dailyPnlSol < -this.config.maxDailyLossSol) {
      rejectionReasons.push(
        `Daily loss limit breached: ${this.state.dailyPnlSol.toFixed(2)} SOL < -${this.config.maxDailyLossSol} SOL`
      );
    }

    // Check 5: Rate limiting
    this.pruneHourlyTrades();

    if (this.state.hourlyTradeCount.length >= this.config.maxHourlyTrades) {
      rejectionReasons.push(
        `Hourly trade limit reached: ${this.state.hourlyTradeCount.length}/${this.config.maxHourlyTrades}`
      );
    }

    // Check 6: System health
    if (!this.systemHealthy) {
      rejectionReasons.push('System unhealthy (stale data or RPC degraded)');
    }

    // Decision
    if (rejectionReasons.length === 0) {
      this.state.hourlyTradeCount.push(new Date());

      logger.info({
        intentId: intent.intentId,
        marketId: intent.marketId,
        sizeSol: intent.sizeSol,
      }, 'Trade intent approved');

      // Save approved intent to database
      await this.database.saveTradeIntent(intent, 'APPROVED');

      return { type: 'APPROVED', intent };
    } else {
      logger.warn({
        intentId: intent.intentId,
        marketId: intent.marketId,
        reasons: rejectionReasons,
      }, 'Trade intent rejected');

      // Save rejected intent to database
      await this.database.logRejection(intent, rejectionReasons);

      return {
        type: 'REJECTED',
        intent,
        reasons: rejectionReasons,
      };
    }
  }

  // ============================================================================
  // POSITION TRACKING
  // ============================================================================

  addPosition(position: Position): void {
    this.state.openPositions.set(position.id, position);
    logger.debug({ positionId: position.id, marketId: position.marketId }, 'Position added to risk tracking');
  }

  updatePosition(position: Position): void {
    if (position.state.type === PositionStateType.Closed || position.state.type === PositionStateType.Failed) {
      this.state.openPositions.delete(position.id);
      logger.debug({ positionId: position.id }, 'Position removed from risk tracking');

      // Update daily PnL if closed
      if (position.state.type === PositionStateType.Closed) {
        this.state.dailyPnlSol += position.state.realizedPnlSol;
        logger.info({
          positionId: position.id,
          realizedPnl: position.state.realizedPnlSol.toFixed(4),
          dailyPnl: this.state.dailyPnlSol.toFixed(4),
        }, 'Daily PnL updated');
      }
    } else {
      this.state.openPositions.set(position.id, position);
    }
  }

  removePosition(positionId: string): void {
    this.state.openPositions.delete(positionId);
    logger.debug({ positionId }, 'Position forcibly removed from risk tracking');
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  private async loadOpenPositions(): Promise<void> {
    try {
      const positions = await this.database.getOpenPositions();
      for (const position of positions) {
        this.state.openPositions.set(position.id, position);
      }
      logger.info({ count: positions.length }, 'Loaded open positions from database');
    } catch (err) {
      logger.error({ err }, 'Failed to load open positions');
    }
  }

  private async updateDailyPnL(): Promise<void> {
    const now = new Date();

    // Reset daily PnL at midnight UTC
    if (now.toDateString() !== this.state.dailyPnlResetTime.toDateString()) {
      logger.info({ previousPnl: this.state.dailyPnlSol.toFixed(4) }, 'Resetting daily PnL');
      this.state.dailyPnlSol = 0;
      this.state.dailyPnlResetTime = now;
    }

    // Fetch actual PnL from database
    try {
      const dbPnl = await this.database.getDailyPnL();
      this.state.dailyPnlSol = dbPnl;
    } catch (err) {
      logger.error({ err }, 'Failed to fetch daily PnL from database');
    }
  }

  private pruneHourlyTrades(): void {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

    const before = this.state.hourlyTradeCount.length;
    this.state.hourlyTradeCount = this.state.hourlyTradeCount.filter((time) => time > cutoff);
    const after = this.state.hourlyTradeCount.length;

    if (before !== after) {
      logger.debug({ before, after }, 'Pruned hourly trade count');
    }
  }

  private getTokenExposure(marketId: string): number {
    let exposure = 0;

    for (const position of this.state.openPositions.values()) {
      if (position.marketId === marketId && position.state.type === PositionStateType.Open) {
        exposure += position.state.entryAmount;
      }
    }

    return exposure;
  }

  // ============================================================================
  // SYSTEM HEALTH
  // ============================================================================

  setSystemHealth(healthy: boolean): void {
    if (this.systemHealthy !== healthy) {
      this.systemHealthy = healthy;
      logger.warn({ healthy }, 'System health changed');

      if (!healthy) {
        this.emit('systemUnhealthy');
      }
    }
  }

  isSystemHealthy(): boolean {
    return this.systemHealthy;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getRiskState(): {
    openPositions: number;
    dailyPnlSol: number;
    hourlyTradeCount: number;
    systemHealthy: boolean;
  } {
    return {
      openPositions: this.state.openPositions.size,
      dailyPnlSol: this.state.dailyPnlSol,
      hourlyTradeCount: this.state.hourlyTradeCount.length,
      systemHealthy: this.systemHealthy,
    };
  }

  getOpenPositions(): Position[] {
    return Array.from(this.state.openPositions.values());
  }

  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ newConfig: this.config }, 'Risk configuration updated');
  }

  // Emergency circuit breaker
  emergencyStop(): void {
    logger.error('EMERGENCY STOP ACTIVATED - All trading halted');
    this.systemHealthy = false;
    this.emit('emergencyStop');
  }

  resetDailyPnL(): void {
    logger.info({ oldPnl: this.state.dailyPnlSol }, 'Manually resetting daily PnL');
    this.state.dailyPnlSol = 0;
    this.state.dailyPnlResetTime = new Date();
  }
}

import { Pool } from 'pg';
import { config } from './config';
import { createModuleLogger } from './logger';
import {
  TradeIntent,
  Position,
  MarketSnapshotRow,
} from './types';

const logger = createModuleLogger('Database');

export class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database error');
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      logger.info('Database connected successfully');
      client.release();
    } catch (err) {
      logger.error({ err }, 'Failed to connect to database');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    logger.info('Database disconnected');
  }

  // ============================================================================
  // MARKET SNAPSHOTS
  // ============================================================================

  async saveMarketSnapshot(snapshot: MarketSnapshotRow): Promise<void> {
    const query = `
      INSERT INTO ds_market_snapshots 
        (time, market_id, price, base_reserve, quote_reserve, liquidity_estimate, volume_proxy)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (time, market_id) DO UPDATE SET
        price = EXCLUDED.price,
        base_reserve = EXCLUDED.base_reserve,
        quote_reserve = EXCLUDED.quote_reserve,
        liquidity_estimate = EXCLUDED.liquidity_estimate,
        volume_proxy = EXCLUDED.volume_proxy
    `;

    try {
      await this.pool.query(query, [
        snapshot.time,
        snapshot.marketId,
        snapshot.price,
        snapshot.baseReserve,
        snapshot.quoteReserve,
        snapshot.liquidityEstimate,
        snapshot.volumeProxy,
      ]);
    } catch (err) {
      logger.error({ err, snapshot }, 'Failed to save market snapshot');
    }
  }

  // ============================================================================
  // TRADE INTENTS
  // ============================================================================

  async saveTradeIntent(intent: TradeIntent, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string): Promise<void> {
    const query = `
      INSERT INTO ds_trade_intents 
        (intent_id, created_at, market_id, side, size_sol, reference_price, current_price, 
         price_drop_pct, liquidity, estimated_slippage, reason_codes, risk_decision, rejection_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    try {
      await this.pool.query(query, [
        intent.intentId,
        intent.timestamp,
        intent.marketId,
        intent.side,
        intent.sizeSol,
        intent.referencePrice,
        intent.currentPrice,
        intent.dropPct,
        intent.liquiditySol,
        intent.estimatedSlippage,
        JSON.stringify(intent.reasonCodes),
        decision,
        rejectionReason || null,
      ]);
    } catch (err) {
      logger.error({ err, intent }, 'Failed to save trade intent');
    }
  }

  async logRejection(intent: TradeIntent, reasons: string[]): Promise<void> {
    await this.saveTradeIntent(intent, 'REJECTED', reasons.join('; '));
  }

  // ============================================================================
  // POSITIONS
  // ============================================================================

  async createPosition(position: Position): Promise<void> {
    const query = `
      INSERT INTO ds_positions 
        (position_id, intent_id, market_id, state, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `;

    try {
      await this.pool.query(query, [
        position.id,
        position.intentId,
        position.marketId,
        position.state.type,
        JSON.stringify(position.metadata),
      ]);
    } catch (err) {
      logger.error({ err, position }, 'Failed to create position');
      throw err;
    }
  }

  async updatePosition(position: Position): Promise<void> {
    let query: string;
    let params: any[];

    switch (position.state.type) {
      case 'PENDING_OPEN':
        query = `
          UPDATE positions 
          SET state = $1, entry_tx_sig = $2, metadata = $3
          WHERE position_id = $4
        `;
        params = [position.state.type, position.state.txSignature, JSON.stringify(position.metadata), position.id];
        break;

      case 'OPEN':
        query = `
          UPDATE positions 
          SET state = $1, entry_price = $2, entry_amount = $3, entry_time = $4, metadata = $5
          WHERE position_id = $6
        `;
        params = [
          position.state.type,
          position.state.entryPrice,
          position.state.entryAmount,
          position.state.entryTime,
          JSON.stringify(position.metadata),
          position.id,
        ];
        break;

      case 'PENDING_CLOSE':
        query = `
          UPDATE positions 
          SET state = $1, exit_tx_sig = $2, metadata = $3
          WHERE position_id = $4
        `;
        params = [position.state.type, position.state.txSignature, JSON.stringify(position.metadata), position.id];
        break;

      case 'CLOSED':
        query = `
          UPDATE positions 
          SET state = $1, exit_price = $2, realized_pnl_sol = $3, exit_reason = $4, exit_time = NOW(), metadata = $5
          WHERE position_id = $6
        `;
        params = [
          position.state.type,
          position.state.exitPrice,
          position.state.realizedPnlSol,
          position.state.exitReason,
          JSON.stringify(position.metadata),
          position.id,
        ];
        break;

      case 'FAILED':
        query = `
          UPDATE positions 
          SET state = $1, metadata = $2
          WHERE position_id = $3
        `;
        params = [position.state.type, JSON.stringify({ ...position.metadata, failureReason: position.state.reason }), position.id];
        break;

      default:
        throw new Error(`Unknown position state: ${(position.state as any).type}`);
    }

    try {
      await this.pool.query(query, params);
    } catch (err) {
      logger.error({ err, position }, 'Failed to update position');
      throw err;
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    const query = `
      SELECT * FROM ds_positions 
      WHERE state = 'OPEN'
      ORDER BY entry_time DESC
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows.map(this.rowToPosition);
    } catch (err) {
      logger.error({ err }, 'Failed to get open positions');
      return [];
    }
  }

  async getPositionsByMarket(marketId: string): Promise<Position[]> {
    const query = `
      SELECT * FROM ds_positions 
      WHERE market_id = $1 AND state IN ('OPEN', 'PENDING_OPEN', 'PENDING_CLOSE')
      ORDER BY created_at DESC
    `;

    try {
      const result = await this.pool.query(query, [marketId]);
      return result.rows.map(this.rowToPosition);
    } catch (err) {
      logger.error({ err, marketId }, 'Failed to get positions by market');
      return [];
    }
  }

  async recordClosedPosition(position: Position): Promise<void> {
    await this.updatePosition(position);
    logger.info({ positionId: position.id, state: position.state }, 'Position closed and recorded');
  }

  // ============================================================================
  // EXECUTION LOGS
  // ============================================================================

  async logExecution(
    positionId: string,
    eventType: 'BUY' | 'SELL' | 'SIMULATION' | 'ERROR',
    status: string,
    signature?: string,
    details?: any
  ): Promise<void> {
    const query = `
      INSERT INTO ds_execution_logs (position_id, event_type, signature, status, details)
      VALUES ($1, $2, $3, $4, $5)
    `;

    try {
      await this.pool.query(query, [positionId, eventType, signature || null, status, JSON.stringify(details || {})]);
    } catch (err) {
      logger.error({ err, positionId, eventType }, 'Failed to log execution');
    }
  }

  // ============================================================================
  // METRICS
  // ============================================================================

  async saveMetric(name: string, value: number, labels?: Record<string, any>): Promise<void> {
    const query = `
      INSERT INTO ds_system_metrics (metric_name, metric_value, metric_labels)
      VALUES ($1, $2, $3)
    `;

    try {
      await this.pool.query(query, [name, value, JSON.stringify(labels || {})]);
    } catch (err) {
      logger.error({ err, name, value }, 'Failed to save metric');
    }
  }

  async getDailyPnL(): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(realized_pnl_sol), 0) as total_pnl
      FROM ds_positions
      WHERE state = 'CLOSED' 
        AND exit_time >= CURRENT_DATE
    `;

    try {
      const result = await this.pool.query(query);
      return parseFloat(result.rows[0].total_pnl);
    } catch (err) {
      logger.error({ err }, 'Failed to get daily PnL');
      return 0;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private rowToPosition(row: any): Position {
    let state: any;

    switch (row.state) {
      case 'PENDING_OPEN':
        state = { type: row.state, txSignature: row.entry_tx_sig };
        break;
      case 'OPEN':
        state = {
          type: row.state,
          entryPrice: parseFloat(row.entry_price),
          entryAmount: parseFloat(row.entry_amount),
          entryTime: row.entry_time,
        };
        break;
      case 'PENDING_CLOSE':
        state = { type: row.state, txSignature: row.exit_tx_sig };
        break;
      case 'CLOSED':
        state = {
          type: row.state,
          exitPrice: parseFloat(row.exit_price),
          realizedPnlSol: parseFloat(row.realized_pnl_sol),
          exitReason: row.exit_reason,
        };
        break;
      case 'FAILED':
        state = { type: row.state, reason: row.metadata?.failureReason || 'Unknown' };
        break;
      default:
        throw new Error(`Unknown position state: ${row.state}`);
    }

    return {
      id: row.position_id,
      intentId: row.intent_id,
      marketId: row.market_id,
      state,
      metadata: row.metadata || {},
    };
  }
}

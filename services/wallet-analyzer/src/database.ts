import { Pool, PoolClient } from 'pg';
import { logger } from './logger';

export interface TrackedWallet {
  id: number;
  address: string;
  label?: string;
  discoveredAt: Date;
  lastAnalyzedAt?: Date;
  isActive: boolean;
  notes?: string;
}

export interface WalletTransaction {
  id?: number;
  walletId: number;
  signature: string;
  blockTime: Date;
  slot: number;
  transactionType: string;
  tokenMint: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  solAmount: number;
  tokenAmount: number;
  pricePerTokenSol: number;
  pricePerTokenUsd: number;
  dexProgram?: string;
  dexName?: string;
  feeLamports: number;
  success: boolean;
  marketContextId?: number;
  rawTransaction?: any;
}

export interface TokenSnapshot {
  id?: number;
  tokenMint: string;
  timestamp: Date;
  symbol?: string;
  name?: string;
  decimals?: number;
  priceUsd: number;
  priceSol: number;
  marketCapUsd: number;
  fdvUsd?: number;
  liquidityUsd: number;
  volume24hUsd: number;
  volumeChange24h?: number;
  priceChange24h?: number;
  priceChange1h?: number;
  holderCount?: number;
  top10HoldersPct?: number;
  poolAddress?: string;
  dexName?: string;
  tokenAgeSeconds?: number;
  rawData?: any;
}

export interface MatchedTrade {
  id?: number;
  walletId: number;
  buyTransactionId: number;
  sellTransactionId?: number;
  tokenMint: string;
  entryTime: Date;
  entryPriceSol: number;
  entryPriceUsd: number;
  entryAmountSol: number;
  entryMcapUsd?: number;
  entryLiquidityUsd?: number;
  entryVolume24hUsd?: number;
  exitTime?: Date;
  exitPriceSol?: number;
  exitPriceUsd?: number;
  exitAmountSol?: number;
  exitMcapUsd?: number;
  holdTimeSeconds?: number;
  profitLossSol?: number;
  profitLossUsd?: number;
  returnPercentage?: number;
  feesPaidSol?: number;
  netProfitSol?: number;
  netReturnPercentage?: number;
  entryDayOfWeek?: string;
  entryHourOfDay?: number;
  isWinner?: boolean;
  tradeCategory?: string;
}

export class Database {
  private pool: Pool;
  
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
    logger.info('Database pool created');
  }
  
  async query(text: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { duration, rows: res.rowCount });
      return res;
    } catch (error: any) {
      logger.error('Database query error', { 
        error: error.message,
        query: text.substring(0, 100)
      });
      throw error;
    }
  }
  
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }
  
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
  
  // ============================================================================
  // TRACKED WALLETS
  // ============================================================================
  
  async addTrackedWallet(address: string, label?: string): Promise<TrackedWallet> {
    const result = await this.query(
      `INSERT INTO tracked_wallets (address, label) 
       VALUES ($1, $2) 
       ON CONFLICT (address) DO UPDATE SET label = $2
       RETURNING *`,
      [address, label]
    );
    
    return result.rows[0];
  }
  
  async getTrackedWallet(address: string): Promise<TrackedWallet | null> {
    const result = await this.query(
      'SELECT * FROM tracked_wallets WHERE address = $1',
      [address]
    );
    
    return result.rows[0] || null;
  }
  
  async getAllTrackedWallets(): Promise<TrackedWallet[]> {
    const result = await this.query(
      'SELECT * FROM tracked_wallets WHERE is_active = true ORDER BY id'
    );
    
    return result.rows;
  }
  
  async updateLastAnalyzed(walletId: number): Promise<void> {
    await this.query(
      'UPDATE tracked_wallets SET last_analyzed_at = NOW() WHERE id = $1',
      [walletId]
    );
  }
  
  // ============================================================================
  // TRANSACTIONS
  // ============================================================================
  
  async insertTransaction(tx: WalletTransaction): Promise<number> {
    const result = await this.query(
      `INSERT INTO wallet_transactions (
        wallet_id, signature, block_time, slot, transaction_type,
        token_mint, token_symbol, token_name, token_decimals,
        sol_amount, token_amount, price_per_token_sol, price_per_token_usd,
        dex_program, dex_name, fee_lamports, success, market_context_id, raw_transaction
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (signature) DO NOTHING
      RETURNING id`,
      [
        tx.walletId, tx.signature, tx.blockTime, tx.slot, tx.transactionType,
        tx.tokenMint, tx.tokenSymbol, tx.tokenName, tx.tokenDecimals,
        tx.solAmount, tx.tokenAmount, tx.pricePerTokenSol, tx.pricePerTokenUsd,
        tx.dexProgram, tx.dexName, tx.feeLamports, tx.success, tx.marketContextId,
        tx.rawTransaction ? JSON.stringify(tx.rawTransaction) : null
      ]
    );
    
    return result.rows[0]?.id || 0;
  }
  
  async bulkInsertTransactions(transactions: WalletTransaction[]): Promise<number> {
    if (transactions.length === 0) return 0;
    
    const client = await this.getClient();
    let inserted = 0;
    
    try {
      await client.query('BEGIN');
      
      for (const tx of transactions) {
        const result = await client.query(
          `INSERT INTO wallet_transactions (
            wallet_id, signature, block_time, slot, transaction_type,
            token_mint, token_symbol, token_name, token_decimals,
            sol_amount, token_amount, price_per_token_sol, price_per_token_usd,
            dex_program, dex_name, fee_lamports, success, market_context_id, raw_transaction
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (signature) DO NOTHING
          RETURNING id`,
          [
            tx.walletId, tx.signature, tx.blockTime, tx.slot, tx.transactionType,
            tx.tokenMint, tx.tokenSymbol, tx.tokenName, tx.tokenDecimals,
            tx.solAmount, tx.tokenAmount, tx.pricePerTokenSol, tx.pricePerTokenUsd,
            tx.dexProgram, tx.dexName, tx.feeLamports, tx.success, tx.marketContextId,
            tx.rawTransaction ? JSON.stringify(tx.rawTransaction) : null
          ]
        );
        
        if (result.rows.length > 0) inserted++;
      }
      
      await client.query('COMMIT');
      logger.info('Bulk inserted transactions', { total: transactions.length, inserted });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    return inserted;
  }
  
  async getTransactionsByWallet(walletId: number, limit = 1000): Promise<WalletTransaction[]> {
    const result = await this.query(
      `SELECT * FROM wallet_transactions 
       WHERE wallet_id = $1 
       ORDER BY block_time DESC 
       LIMIT $2`,
      [walletId, limit]
    );
    
    return result.rows;
  }
  
  async getTransactionCount(walletId: number): Promise<number> {
    const result = await this.query(
      'SELECT COUNT(*) as count FROM wallet_transactions WHERE wallet_id = $1',
      [walletId]
    );
    
    return parseInt(result.rows[0].count);
  }
  
  // ============================================================================
  // TOKEN SNAPSHOTS
  // ============================================================================
  
  async insertTokenSnapshot(snapshot: TokenSnapshot): Promise<number> {
    const result = await this.query(
      `INSERT INTO token_snapshots (
        token_mint, timestamp, symbol, name, decimals,
        price_usd, price_sol, market_cap_usd, fdv_usd,
        liquidity_usd, volume_24h_usd, volume_change_24h,
        price_change_24h, price_change_1h, holder_count,
        top_10_holders_pct, pool_address, dex_name, token_age_seconds, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id`,
      [
        snapshot.tokenMint, snapshot.timestamp, snapshot.symbol, snapshot.name, snapshot.decimals,
        snapshot.priceUsd, snapshot.priceSol, snapshot.marketCapUsd, snapshot.fdvUsd,
        snapshot.liquidityUsd, snapshot.volume24hUsd, snapshot.volumeChange24h,
        snapshot.priceChange24h, snapshot.priceChange1h, snapshot.holderCount,
        snapshot.top10HoldersPct, snapshot.poolAddress, snapshot.dexName, snapshot.tokenAgeSeconds,
        snapshot.rawData ? JSON.stringify(snapshot.rawData) : null
      ]
    );
    
    return result.rows[0].id;
  }
  
  async getTokenSnapshotNear(tokenMint: string, timestamp: Date): Promise<TokenSnapshot | null> {
    const result = await this.query(
      `SELECT * FROM token_snapshots 
       WHERE token_mint = $1 
       AND timestamp <= $2
       ORDER BY timestamp DESC 
       LIMIT 1`,
      [tokenMint, timestamp]
    );
    
    return result.rows[0] || null;
  }
  
  // ============================================================================
  // MATCHED TRADES
  // ============================================================================
  
  async insertMatchedTrade(trade: MatchedTrade): Promise<number> {
    const result = await this.query(
      `INSERT INTO matched_trades (
        wallet_id, buy_transaction_id, sell_transaction_id, token_mint,
        entry_time, entry_price_sol, entry_price_usd, entry_amount_sol,
        entry_mcap_usd, entry_liquidity_usd, entry_volume_24h_usd,
        exit_time, exit_price_sol, exit_price_usd, exit_amount_sol, exit_mcap_usd,
        hold_time_seconds, profit_loss_sol, profit_loss_usd, return_percentage,
        fees_paid_sol, net_profit_sol, net_return_percentage,
        entry_day_of_week, entry_hour_of_day, is_winner, trade_category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING id`,
      [
        trade.walletId, trade.buyTransactionId, trade.sellTransactionId, trade.tokenMint,
        trade.entryTime, trade.entryPriceSol, trade.entryPriceUsd, trade.entryAmountSol,
        trade.entryMcapUsd, trade.entryLiquidityUsd, trade.entryVolume24hUsd,
        trade.exitTime, trade.exitPriceSol, trade.exitPriceUsd, trade.exitAmountSol, trade.exitMcapUsd,
        trade.holdTimeSeconds, trade.profitLossSol, trade.profitLossUsd, trade.returnPercentage,
        trade.feesPaidSol, trade.netProfitSol, trade.netReturnPercentage,
        trade.entryDayOfWeek, trade.entryHourOfDay, trade.isWinner, trade.tradeCategory
      ]
    );
    
    return result.rows[0].id;
  }
  
  async getMatchedTradesByWallet(walletId: number): Promise<MatchedTrade[]> {
    const result = await this.query(
      `SELECT * FROM matched_trades 
       WHERE wallet_id = $1 
       ORDER BY entry_time DESC`,
      [walletId]
    );
    
    return result.rows;
  }
  
  async getOpenTrades(walletId: number): Promise<MatchedTrade[]> {
    const result = await this.query(
      `SELECT * FROM matched_trades 
       WHERE wallet_id = $1 AND sell_transaction_id IS NULL 
       ORDER BY entry_time DESC`,
      [walletId]
    );
    
    return result.rows;
  }
  
  // ============================================================================
  // ANALYTICS QUERIES
  // ============================================================================
  
  async getWalletSummary(walletId: number): Promise<any> {
    const result = await this.query(
      `SELECT * FROM v_wallet_summary WHERE id = $1`,
      [walletId]
    );
    
    return result.rows[0] || null;
  }
  
  async calculatePerformanceMetrics(walletId: number): Promise<any> {
    const result = await this.query(
      `SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN NOT is_winner THEN 1 ELSE 0 END) as losing_trades,
        AVG(CASE WHEN is_winner THEN 1.0 ELSE 0.0 END) as win_rate,
        SUM(profit_loss_sol) as total_profit_sol,
        AVG(return_percentage) as avg_return_pct,
        AVG(hold_time_seconds) as avg_hold_time_seconds,
        MAX(return_percentage) as best_trade_pct,
        MIN(return_percentage) as worst_trade_pct,
        SUM(fees_paid_sol) as total_fees_sol
      FROM matched_trades 
      WHERE wallet_id = $1 AND sell_transaction_id IS NOT NULL`,
      [walletId]
    );
    
    return result.rows[0];
  }
}

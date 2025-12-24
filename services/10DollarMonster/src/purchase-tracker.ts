/**
 * Purchase Tracker for 10DollarMonster
 * Tracks token purchases to avoid duplicate buys
 */

import pg from 'pg';
import pino from 'pino';

const { Pool } = pg;

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss Z',
      ignore: 'pid,hostname',
      messageFormat: '{context} | {msg}',
    },
  },
});

export interface PurchaseRecord {
  leaderTradeId: number;
  leaderWallet: string;
  leaderSignature: string;
  tokenMint: string;
  tokenSymbol: string;
  solAmount: number;
  ourSignature: string | null;
  status: 'success' | 'failed' | 'skipped';
  failureReason?: string;
}

export class PurchaseTracker {
  private db: Pool;

  constructor(dbConnectionString: string) {
    this.db = new Pool({
      connectionString: dbConnectionString,
    });
  }

  /**
   * Check if we've already purchased this token
   */
  async hasPurchased(tokenMint: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `SELECT COUNT(*) as count 
         FROM ten_dollar_purchases 
         WHERE token_mint = $1 AND status = 'success'`,
        [tokenMint]
      );
      
      return parseInt(result.rows[0].count) > 0;
    } catch (error: any) {
      logger.error({
        context: 'Error checking purchase history',
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Record a purchase attempt
   */
  async recordPurchase(record: PurchaseRecord): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO ten_dollar_purchases 
         (leader_trade_id, leader_wallet, leader_signature, token_mint, token_symbol, 
          sol_amount, our_signature, status, failure_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          record.leaderTradeId,
          record.leaderWallet,
          record.leaderSignature,
          record.tokenMint,
          record.tokenSymbol,
          record.solAmount,
          record.ourSignature,
          record.status,
          record.failureReason || null,
        ]
      );

      logger.info({
        context: 'Purchase recorded',
        tokenSymbol: record.tokenSymbol,
        status: record.status,
      });
    } catch (error: any) {
      logger.error({
        context: 'Failed to record purchase',
        error: error.message,
      });
    }
  }

  /**
   * Get all purchases
   */
  async getAllPurchases(): Promise<any[]> {
    try {
      const result = await this.db.query(
        `SELECT * FROM ten_dollar_purchases 
         ORDER BY created_at DESC 
         LIMIT 100`
      );
      return result.rows;
    } catch (error: any) {
      logger.error({
        context: 'Error fetching purchases',
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Ensure the table exists
   */
  async ensureTable(): Promise<void> {
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ten_dollar_purchases (
          id SERIAL PRIMARY KEY,
          leader_trade_id INTEGER NOT NULL,
          leader_wallet TEXT NOT NULL,
          leader_signature TEXT NOT NULL,
          token_mint TEXT NOT NULL,
          token_symbol TEXT NOT NULL,
          sol_amount DECIMAL(20, 9) NOT NULL,
          our_signature TEXT,
          status TEXT NOT NULL,
          failure_reason TEXT,
          created_at TIMESTAMP NOT NULL,
          UNIQUE(token_mint)
        )
      `);

      logger.info({ context: 'Purchase tracking table ready' });
    } catch (error: any) {
      logger.error({
        context: 'Failed to ensure table',
        error: error.message,
      });
      throw error;
    }
  }
}

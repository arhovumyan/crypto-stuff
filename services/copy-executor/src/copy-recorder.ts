/**
 * Copy Trade Recorder
 * Saves copy trade attempts and results to database
 */

import pg from 'pg';
import pino from 'pino';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

// Initialize logger
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

// Initialize database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface CopyAttempt {
  leaderTradeId: number;
  leaderWallet: string;
  leaderSignature: string;
  tokenIn: string;
  tokenInSymbol: string;
  amountIn: string;
  tokenOut: string;
  tokenOutSymbol: string;
  amountOut: string;
  copyPercentage: number;
  calculatedAmountIn: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  failureReason?: string;
  ourSignature?: string;
  jupiterQuote?: any;
  executedAt?: Date;
}

export class CopyRecorder {
  /**
   * Record copy trade attempt
   */
  async recordCopyAttempt(attempt: CopyAttempt): Promise<number> {
    const client = await db.connect();

    try {
      const result = await client.query(
        `
        INSERT INTO copy_attempts (
          leader_trade_id,
          status,
          reason,
          quote_json,
          our_signature,
          amount_in,
          amount_out,
          expected_out,
          executed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        `,
        [
          attempt.leaderTradeId,
          attempt.status,
          attempt.failureReason || null,
          attempt.jupiterQuote ? JSON.stringify(attempt.jupiterQuote) : null,
          attempt.ourSignature || null,
          parseFloat(attempt.calculatedAmountIn),
          attempt.amountOut ? parseFloat(attempt.amountOut) : null,
          attempt.jupiterQuote ? parseFloat(attempt.jupiterQuote.outAmount) / 1000000000 : null,
          attempt.executedAt || new Date(),
        ]
      );

      const id = result.rows[0].id;

      logger.info({
        context: 'COPY ATTEMPT RECORDED',
        id,
        leaderTradeId: attempt.leaderTradeId,
        status: attempt.status,
        tokenIn: attempt.tokenInSymbol,
        tokenOut: attempt.tokenOutSymbol,
        amountIn: attempt.calculatedAmountIn,
        signature: attempt.ourSignature || 'N/A',
      });

      return id;
    } catch (error: any) {
      logger.error({
        context: 'Failed to record copy attempt',
        error: error.message,
        leaderTradeId: attempt.leaderTradeId,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update copy attempt status
   */
  async updateCopyAttempt(
    id: number,
    updates: {
      status?: string;
      failureReason?: string;
      ourSignature?: string;
    }
  ): Promise<void> {
    const client = await db.connect();

    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.status) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }

      if (updates.failureReason) {
        setClauses.push(`failure_reason = $${paramIndex++}`);
        values.push(updates.failureReason);
      }

      if (updates.ourSignature) {
        setClauses.push(`our_signature = $${paramIndex++}`);
        values.push(updates.ourSignature);
      }

      if (setClauses.length === 0) {
        return;
      }

      values.push(id);

      await client.query(
        `UPDATE copy_attempts SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      logger.info({
        context: 'Copy attempt updated',
        id,
        ...updates,
      });
    } catch (error: any) {
      logger.error({
        context: 'Failed to update copy attempt',
        error: error.message,
        id,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get token balance from positions
   */
  async getTokenBalance(wallet: string, tokenMint: string): Promise<number> {
    try {
      const result = await db.query(
        `SELECT size FROM positions WHERE token_mint = $1`,
        [tokenMint]
      );

      if (result.rows.length === 0) {
        return 0;
      }

      return parseFloat(result.rows[0].size);
    } catch (error: any) {
      logger.error({
        context: 'Failed to get token balance',
        error: error.message,
        wallet,
        tokenMint,
      });
      return 0;
    }
  }

  /**
   * Update position after successful buy
   */
  async updatePosition(
    wallet: string,
    tokenMint: string,
    tokenSymbol: string,
    amountChange: number,
    costBasis: number,
    copyAttemptId: number
  ): Promise<void> {
    try {
      // Check if position exists
      const existing = await db.query(
        `SELECT size, avg_cost FROM positions WHERE token_mint = $1`,
        [tokenMint]
      );

      if (existing.rows.length > 0) {
        // Update existing position
        const position = existing.rows[0];
        const currentSize = parseFloat(position.size);
        const currentAvgCost = parseFloat(position.avg_cost || 0);
        const newSize = currentSize + amountChange;
        const totalCost = (currentSize * currentAvgCost) + costBasis;
        const newAvgCost = totalCost / newSize;

        await db.query(
          `UPDATE positions 
           SET size = $1, avg_cost = $2, last_trade_at = NOW(), trade_count = trade_count + 1, updated_at = NOW()
           WHERE token_mint = $3`,
          [newSize, newAvgCost, tokenMint]
        );

        logger.info({
          context: 'Position updated (buy)',
          token: tokenSymbol,
          newSize,
          avgCost: newAvgCost,
        });
      } else {
        // Create new position
        await db.query(
          `INSERT INTO positions (
            token_mint, token_symbol, size, avg_cost, first_trade_at, last_trade_at, trade_count
          ) VALUES ($1, $2, $3, $4, NOW(), NOW(), 1)`,
          [tokenMint, tokenSymbol, amountChange, costBasis / amountChange]
        );

        logger.info({
          context: 'New position created',
          token: tokenSymbol,
          size: amountChange,
          avgCost: costBasis / amountChange,
        });
      }
    } catch (error: any) {
      logger.error({
        context: 'Failed to update position',
        error: error.message,
        wallet,
        tokenMint,
      });
      throw error;
    }
  }

  /**
   * Reduce position after sell
   */
  async reducePosition(
    wallet: string,
    tokenMint: string,
    tokenSymbol: string,
    amountSold: number,
    saleValue: number
  ): Promise<void> {
    try {
      const existing = await db.query(
        `SELECT size, avg_cost FROM positions WHERE token_mint = $1`,
        [tokenMint]
      );

      if (existing.rows.length === 0) {
        logger.warn({
          context: 'No position found for sell',
          token: tokenSymbol,
        });
        return;
      }

      const position = existing.rows[0];
      const currentSize = parseFloat(position.size);
      const currentAvgCost = parseFloat(position.avg_cost || 0);
      const newSize = currentSize - amountSold;
      const costBasis = currentSize * currentAvgCost;
      const costReduction = (amountSold / currentSize) * costBasis;
      const realizedPnL = saleValue - costReduction;

      if (newSize <= 0.0001) {
        // Close position - set size to 0
        await db.query(
          `UPDATE positions 
           SET size = 0, realized_pnl = realized_pnl + $1, last_trade_at = NOW(), trade_count = trade_count + 1, updated_at = NOW()
           WHERE token_mint = $2`,
          [realizedPnL, tokenMint]
        );

        logger.info({
          context: 'Position closed (sell)',
          token: tokenSymbol,
          amountSold,
          saleValue,
          costBasis: costReduction,
          realizedPnL,
        });
      } else {
        // Reduce position
        await db.query(
          `UPDATE positions 
           SET size = $1, realized_pnl = realized_pnl + $2, last_trade_at = NOW(), trade_count = trade_count + 1, updated_at = NOW()
           WHERE token_mint = $3`,
          [newSize, realizedPnL, tokenMint]
        );

        logger.info({
          context: 'Position reduced (sell)',
          token: tokenSymbol,
          amountSold,
          remainingSize: newSize,
          saleValue,
          costReduction,
          realizedPnL,
        });
      }
    } catch (error: any) {
      logger.error({
        context: 'Failed to reduce position',
        error: error.message,
        wallet,
        tokenMint,
      });
      throw error;
    }
  }
}

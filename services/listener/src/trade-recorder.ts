import { query, createLogger, DetectedSwap, LeaderTrade } from '@copytrader/shared';

const logger = createLogger('trade-recorder');

export class TradeRecorder {
  /**
   * Save detected swap to database
   */
  async recordLeaderTrade(swap: DetectedSwap): Promise<LeaderTrade | null> {
    try {
      const result = await query<LeaderTrade>(
        `INSERT INTO leader_trades (
          leader_wallet,
          signature,
          slot,
          block_time,
          token_in_mint,
          token_in_symbol,
          token_out_mint,
          token_out_symbol,
          amount_in,
          amount_out,
          dex_program,
          raw_transaction
        ) VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (signature) DO NOTHING
        RETURNING *`,
        [
          swap.leaderWallet,
          swap.signature,
          swap.slot,
          swap.blockTime,
          swap.tokenIn.mint,
          swap.tokenIn.symbol || null, // Handle undefined symbols
          swap.tokenOut.mint,
          swap.tokenOut.symbol || null, // Handle undefined symbols
          swap.tokenIn.amount,
          swap.tokenOut.amount,
          swap.dexProgram || null,
          JSON.stringify(swap.rawTransaction),
        ]
      );

      if (result.rowCount === 0) {
        logger.debug({ signature: swap.signature }, 'Trade already recorded (duplicate)');
        return null;
      }

      const trade = result.rows[0];
      const tokenInDisplay = swap.tokenIn.symbol || (swap.tokenIn.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : swap.tokenIn.mint.slice(0, 6) + '...');
      const tokenOutDisplay = swap.tokenOut.symbol || (swap.tokenOut.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : swap.tokenOut.mint.slice(0, 6) + '...');
      
      logger.info(
        `✅ Trade saved (ID: ${trade.id}) | ${tokenInDisplay} → ${tokenOutDisplay} | ` +
        `Amount: ${swap.tokenIn.amount.toFixed(4)} → ${swap.tokenOut.amount.toFixed(6)}`
      );

      // Update last trade time for the wallet
      await this.updateWalletLastTrade(swap.leaderWallet);

      return trade as LeaderTrade;
    } catch (error) {
      // Log full error details for debugging
      logger.error(
        { 
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          signature: swap.signature,
          leaderWallet: swap.leaderWallet,
        }, 
        'Failed to record trade'
      );
      return null;
    }
  }

  /**
   * Update the last_trade_at timestamp for a wallet
   */
  private async updateWalletLastTrade(address: string): Promise<void> {
    try {
      await query(
        `UPDATE followed_wallets 
         SET last_trade_at = NOW() 
         WHERE address = $1`,
        [address]
      );
    } catch (error) {
      logger.error({ error, address }, 'Failed to update wallet last trade time');
    }
  }

  /**
   * Get all followed wallets from database AND .env file
   */
  async getFollowedWallets(): Promise<string[]> {
    try {
      // Get wallets from database
      const result = await query<{ address: string }>(
        `SELECT address FROM followed_wallets WHERE enabled = true`
      );
      const dbWallets = result.rows.map((row) => row.address);
      
      // Get wallets from .env LEADER_WALLET_* variables
      const envWallets: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const wallet = process.env[`LEADER_WALLET_${i}`];
        if (wallet && wallet.trim().length > 0) {
          envWallets.push(wallet.trim());
        }
      }
      
      // Also check WATCH_ADDRESSES for backward compatibility
      const watchAddresses = process.env.WATCH_ADDRESSES || '';
      if (watchAddresses) {
        const watchWallets = watchAddresses
          .split(',')
          .map(addr => addr.trim())
          .filter(addr => addr.length > 0);
        envWallets.push(...watchWallets);
      }
      
      // Combine and deduplicate
      const allWallets = [...new Set([...dbWallets, ...envWallets])];
      
      if (allWallets.length > 0) {
        logger.info(`Monitoring ${allWallets.length} wallet(s) (${dbWallets.length} from DB, ${envWallets.length} from .env)`);
      }
      
      return allWallets;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch followed wallets');
      
      // Fallback to .env only if database fails
      const envWallets: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const wallet = process.env[`LEADER_WALLET_${i}`];
        if (wallet && wallet.trim().length > 0) {
          envWallets.push(wallet.trim());
        }
      }
      
      logger.warn(`Using ${envWallets.length} wallet(s) from .env only (database error)`);
      return envWallets;
    }
  }

  /**
   * Get recent trades for a specific wallet
   */
  async getRecentTrades(
    walletAddress: string,
    limit: number = 10
  ): Promise<LeaderTrade[]> {
    try {
      const result = await query<LeaderTrade>(
        `SELECT * FROM leader_trades 
         WHERE leader_wallet = $1 
         ORDER BY detected_at DESC 
         LIMIT $2`,
        [walletAddress, limit]
      );
      return result.rows;
    } catch (error) {
      logger.error({ error, walletAddress }, 'Failed to fetch recent trades');
      return [];
    }
  }

  /**
   * Get statistics for all followed wallets
   */
  async getWalletStats(): Promise<any[]> {
    try {
      const result = await query(
        `SELECT 
          fw.address,
          fw.enabled,
          fw.last_trade_at,
          COUNT(lt.id) as trade_count,
          MAX(lt.detected_at) as last_detected_trade
         FROM followed_wallets fw
         LEFT JOIN leader_trades lt ON lt.leader_wallet = fw.address
         GROUP BY fw.id, fw.address, fw.enabled, fw.last_trade_at
         ORDER BY trade_count DESC`
      );
      return result.rows;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch wallet stats');
      return [];
    }
  }
}

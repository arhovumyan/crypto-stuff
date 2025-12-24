/**
 * Wallet Watch Listener
 * Monitors WATCH_ADDRESSES from .env and records their live transactions
 * This runs independently and stores trades in the database for the mirroring service to copy
 */

import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
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
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[WATCH-LISTENER] {msg}',
    },
  },
});

// Initialize database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const POLLING_INTERVAL = 120000; // Check every 2 minutes (120,000ms)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

interface ParsedTransaction {
  signature: string;
  blockTime: number;
  slot: number;
  tokenIn: string;
  tokenInSymbol: string;
  amountIn: number;
  tokenOut: string;
  tokenOutSymbol: string;
  amountOut: number;
  type: 'BUY' | 'SELL';
}

class WalletWatchListener {
  private connection: Connection;
  private watchAddresses: string[] = [];
  private processedSignatures: Set<string> = new Set();
  private lastCheckedSlot: Map<string, number> = new Map();
  private isRunning: boolean = false;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.loadWatchAddresses();
  }

  private loadWatchAddresses(): void {
    // First try WATCH_ADDRESSES for backwards compatibility
    const watchAddressesStr = process.env.WATCH_ADDRESSES || '';
    if (watchAddressesStr) {
      this.watchAddresses = watchAddressesStr
        .split(',')
        .map(addr => addr.trim())
        .filter(addr => addr.length > 0);
    }

    // Then add all LEADER_WALLET_* variables
    const leaderWallets: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const wallet = process.env[`LEADER_WALLET_${i}`];
      if (wallet && wallet.trim().length > 0) {
        leaderWallets.push(wallet.trim());
      }
    }

    // Combine and deduplicate
    this.watchAddresses = [...new Set([...this.watchAddresses, ...leaderWallets])];

    if (this.watchAddresses.length === 0) {
      logger.error('⚠️  No wallets found to watch!');
      logger.error('    Add WATCH_ADDRESSES or LEADER_WALLET_1, LEADER_WALLET_2, etc. to .env');
      process.exit(1);
    }

    logger.info(`Loaded ${this.watchAddresses.length} wallet(s) to watch:`);
    this.watchAddresses.forEach(addr => {
      logger.info(`  - ${addr}`);
    });
  }

  async start(): Promise<void> {
    logger.info('╔══════════════════════════════════════════════════╗');
    logger.info('║   🔍 Wallet Watch Listener Starting...          ║');
    logger.info('╚══════════════════════════════════════════════════╝');
    logger.info('');
    logger.info('💡 To change wallets: Edit LEADER_WALLET_* in .env and restart');
    logger.info('');
    
    try {
      // Test database connection
      await db.query('SELECT NOW()');
      logger.info('✅ Database connected');

      // Initialize last checked slot for each wallet
      for (const wallet of this.watchAddresses) {
        const currentSlot = await this.connection.getSlot();
        this.lastCheckedSlot.set(wallet, currentSlot);
        logger.info(`📍 Starting from slot ${currentSlot} for ${wallet.slice(0, 8)}...`);
      }

      this.isRunning = true;
      logger.info('✅ Listener is running. Checking every 2 minutes...\n');

      // Start polling
      await this.pollLoop();
    } catch (error) {
      logger.error({ error }, 'Failed to start listener');
      throw error;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        for (const wallet of this.watchAddresses) {
          await this.checkWalletTransactions(wallet);
        }
      } catch (error) {
        logger.error({ error }, 'Error in poll loop');
      }

      // Wait for next poll interval
      logger.debug(`💤 Waiting ${POLLING_INTERVAL / 1000} seconds until next check...`);
      await this.sleep(POLLING_INTERVAL);
    }
  }

  private async checkWalletTransactions(walletAddress: string): Promise<void> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const lastSlot = this.lastCheckedSlot.get(walletAddress) || 0;

      logger.debug(`Checking ${walletAddress.slice(0, 8)}... for new transactions...`);

      // Get recent signatures using Helius Enhanced Transactions API
      const signatures = await this.getRecentSignatures(walletAddress, lastSlot);
      
      if (signatures.length === 0) {
        logger.debug(`No new transactions for ${walletAddress.slice(0, 8)}...`);
        return;
      }

      logger.info(`Found ${signatures.length} new transaction(s) for ${walletAddress.slice(0, 8)}...`);

      // Process each signature
      for (const sig of signatures) {
        if (this.processedSignatures.has(sig.signature)) {
          continue;
        }

        await this.processTransaction(walletAddress, sig.signature, sig.slot, sig.blockTime);
        this.processedSignatures.add(sig.signature);
        
        // Update last checked slot
        if (sig.slot > lastSlot) {
          this.lastCheckedSlot.set(walletAddress, sig.slot);
        }
      }
    } catch (error) {
      logger.error({ error, wallet: walletAddress }, 'Error checking wallet transactions');
    }
  }

  private async getRecentSignatures(
    walletAddress: string,
    afterSlot: number
  ): Promise<Array<{ signature: string; slot: number; blockTime: number }>> {
    try {
      const pubkey = new PublicKey(walletAddress);
      
      // Get signatures from Solana RPC
      const signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit: 20, // Check last 20 transactions
      });

      // Filter for transactions after our last checked slot
      return signatures
        .filter(sig => sig.slot > afterSlot && sig.blockTime)
        .map(sig => ({
          signature: sig.signature,
          slot: sig.slot,
          blockTime: sig.blockTime!,
        }))
        .reverse(); // Process oldest first
    } catch (error) {
      logger.error({ error, wallet: walletAddress }, 'Error fetching signatures');
      return [];
    }
  }

  private async processTransaction(
    walletAddress: string,
    signature: string,
    slot: number,
    blockTime: number
  ): Promise<void> {
    try {
      // Use Helius Enhanced Transactions API for better parsing
      const parsedTx = await this.parseTransactionWithHelius(signature);
      
      if (!parsedTx) {
        logger.debug(`Could not parse transaction ${signature.slice(0, 16)}...`);
        return;
      }

      // Check if it's a swap (has both tokenIn and tokenOut)
      if (!parsedTx.tokenIn || !parsedTx.tokenOut) {
        logger.debug(`Transaction ${signature.slice(0, 16)}... is not a swap`);
        return;
      }

      // Determine if it's a BUY or SELL
      const isBuy = parsedTx.tokenIn === NATIVE_SOL && parsedTx.tokenOut !== NATIVE_SOL;
      const isSell = parsedTx.tokenOut === NATIVE_SOL && parsedTx.tokenIn !== NATIVE_SOL;

      if (!isBuy && !isSell) {
        logger.debug(`Transaction ${signature.slice(0, 16)}... is not a SOL swap`);
        return;
      }

      const tradeType = isBuy ? 'BUY' : 'SELL';
      const token = isBuy ? parsedTx.tokenOut : parsedTx.tokenIn;
      const tokenSymbol = isBuy ? parsedTx.tokenOutSymbol : parsedTx.tokenInSymbol;
      const amountSOL = isBuy ? parsedTx.amountIn : parsedTx.amountOut;
      const amountToken = isBuy ? parsedTx.amountOut : parsedTx.amountIn;

      // Save to database
      await this.recordTrade({
        signature,
        blockTime,
        slot,
        walletAddress,
        tokenIn: parsedTx.tokenIn,
        tokenInSymbol: parsedTx.tokenInSymbol,
        amountIn: parsedTx.amountIn,
        tokenOut: parsedTx.tokenOut,
        tokenOutSymbol: parsedTx.tokenOutSymbol,
        amountOut: parsedTx.amountOut,
        type: tradeType,
      });

      // Log the trade
      this.logTrade({
        walletAddress,
        signature,
        type: tradeType,
        token,
        tokenSymbol,
        amountSOL,
        amountToken,
        blockTime,
      });
    } catch (error) {
      logger.error({ error, signature }, 'Error processing transaction');
    }
  }

  private async parseTransactionWithHelius(signature: string): Promise<ParsedTransaction | null> {
    try {
      // Use Helius Enhanced Transactions API
      const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
      const response = await axios.post(url, {
        transactions: [signature],
      });

      if (!response.data || response.data.length === 0) {
        return null;
      }

      const tx = response.data[0];
      
      // Look for token swaps in tokenTransfers
      const tokenTransfers = tx.tokenTransfers || [];
      
      if (tokenTransfers.length < 2) {
        return null;
      }

      // Find the incoming and outgoing tokens
      let tokenIn: string | null = null;
      let tokenOut: string | null = null;
      let amountIn = 0;
      let amountOut = 0;
      let tokenInSymbol = '';
      let tokenOutSymbol = '';

      // Check native transfers (SOL)
      const nativeTransfers = tx.nativeTransfers || [];
      for (const transfer of nativeTransfers) {
        if (transfer.amount) {
          // This is simplified - you might need more logic here
          if (transfer.fromUserAccount === tx.feePayer) {
            tokenIn = NATIVE_SOL;
            amountIn = transfer.amount / 1e9; // Convert lamports to SOL
            tokenInSymbol = 'SOL';
          } else if (transfer.toUserAccount === tx.feePayer) {
            tokenOut = NATIVE_SOL;
            amountOut = transfer.amount / 1e9;
            tokenOutSymbol = 'SOL';
          }
        }
      }

      // Check token transfers
      for (const transfer of tokenTransfers) {
        if (transfer.fromUserAccount === tx.feePayer) {
          // Outgoing token
          tokenIn = transfer.mint;
          amountIn = transfer.tokenAmount || 0;
          tokenInSymbol = transfer.tokenSymbol || transfer.mint.slice(0, 8);
        } else if (transfer.toUserAccount === tx.feePayer) {
          // Incoming token
          tokenOut = transfer.mint;
          amountOut = transfer.tokenAmount || 0;
          tokenOutSymbol = transfer.tokenSymbol || transfer.mint.slice(0, 8);
        }
      }

      if (!tokenIn || !tokenOut) {
        return null;
      }

      return {
        signature,
        blockTime: tx.timestamp,
        slot: tx.slot,
        tokenIn,
        tokenInSymbol,
        amountIn,
        tokenOut,
        tokenOutSymbol,
        amountOut,
        type: tokenIn === NATIVE_SOL ? 'BUY' : 'SELL',
      };
    } catch (error) {
      logger.error({ error, signature }, 'Error parsing transaction with Helius');
      return null;
    }
  }

  private async recordTrade(trade: {
    signature: string;
    blockTime: number;
    slot: number;
    walletAddress: string;
    tokenIn: string;
    tokenInSymbol: string;
    amountIn: number;
    tokenOut: string;
    tokenOutSymbol: string;
    amountOut: number;
    type: 'BUY' | 'SELL';
  }): Promise<void> {
    try {
      await db.query(
        `INSERT INTO leader_trades 
         (leader_wallet, signature, slot, block_time, token_in_mint, token_in_symbol, 
          token_out_mint, token_out_symbol, amount_in, amount_out, detected_at)
         VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (signature) DO NOTHING`,
        [
          trade.walletAddress,
          trade.signature,
          trade.slot,
          trade.blockTime,
          trade.tokenIn,
          trade.tokenInSymbol,
          trade.tokenOut,
          trade.tokenOutSymbol,
          trade.amountIn,
          trade.amountOut,
        ]
      );
    } catch (error) {
      logger.error({ error, signature: trade.signature }, 'Error recording trade');
    }
  }

  private logTrade(trade: {
    walletAddress: string;
    signature: string;
    type: 'BUY' | 'SELL';
    token: string;
    tokenSymbol: string;
    amountSOL: number;
    amountToken: number;
    blockTime: number;
  }): void {
    const emoji = trade.type === 'BUY' ? '🟢' : '🔴';
    logger.info('');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`${emoji} ${trade.type} DETECTED`);
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`Wallet:     ${trade.walletAddress.slice(0, 12)}...${trade.walletAddress.slice(-4)}`);
    logger.info(`Token:      ${trade.tokenSymbol} (${trade.token.slice(0, 12)}...)`);
    logger.info(`Amount:     ${trade.amountSOL.toFixed(4)} SOL ↔ ${trade.amountToken.toFixed(2)} ${trade.tokenSymbol}`);
    logger.info(`Signature:  ${trade.signature.slice(0, 20)}...`);
    logger.info(`Time:       ${new Date(trade.blockTime * 1000).toLocaleString()}`);
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    logger.info('Stopping Wallet Watch Listener...');
    this.isRunning = false;
  }
}

// Main execution
const listener = new WalletWatchListener();

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('\nReceived SIGINT. Shutting down gracefully...');
  listener.stop();
  setTimeout(() => {
    db.end();
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  logger.info('\nReceived SIGTERM. Shutting down gracefully...');
  listener.stop();
  setTimeout(() => {
    db.end();
    process.exit(0);
  }, 1000);
});

// Start the listener
listener.start().catch((error) => {
  logger.error({ error }, 'Fatal error in listener');
  process.exit(1);
});

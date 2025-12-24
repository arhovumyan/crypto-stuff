import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';
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

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const POLLING_INTERVAL = 5000; // 5 seconds
const MIN_BALANCE_SOL = 0.1;

interface LeaderTrade {
  id: number;
  wallet: string;
  signature: string;
  tokenIn: string;
  tokenInSymbol: string;
  amountIn: string;
  tokenOut: string;
  tokenOutSymbol: string;
  amountOut: string;
  blockTime: number;
}

export class BuyOnlyCopier {
  private connection: Connection;
  private keypair: Keypair;
  private isRunning: boolean = false;
  private lastProcessedId: number = 0;
  private copyPercentage: number;
  private fixedBuyAmountSOL: number | null = null;
  private blacklistedTokens: Set<string> = new Set();
  private recentPurchases: Map<string, number> = new Map(); // tokenMint -> timestamp

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('SOLANA_RPC_URL not found in environment');
    }

    const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE;
    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in environment');
    }

    this.connection = new Connection(rpcUrl, 'confirmed');
    this.keypair = this.getKeypairFromSeed(seedPhrase);
    this.copyPercentage = parseFloat(process.env.COPY_PERCENTAGE || '100');

    const fixedAmount = process.env.FIXED_BUY_AMOUNT_SOL;
    if (fixedAmount) {
      this.fixedBuyAmountSOL = parseFloat(fixedAmount);
      logger.info({ fixedBuyAmount: this.fixedBuyAmountSOL }, 'Using fixed buy amount');
    }

    // Load blacklisted tokens
    const blacklistEnv = process.env.BLACKLIST_TOKENS;
    if (blacklistEnv) {
      blacklistEnv.split(',').forEach((token) => {
        const trimmed = token.trim();
        if (trimmed) {
          this.blacklistedTokens.add(trimmed);
        }
      });
      logger.info({ count: this.blacklistedTokens.size }, 'Loaded blacklisted tokens');
    }

    logger.info({
      walletAddress: this.keypair.publicKey.toBase58(),
      copyPercentage: this.copyPercentage,
    }, 'Buy-Only Copier initialized');
  }

  private getKeypairFromSeed(seedPhrase: string): Keypair {
    const seed = bip39.mnemonicToSeedSync(seedPhrase, '');
    const path = `m/44'/501'/0'/0'`;
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
  }

  async start(): Promise<void> {
    logger.info('Starting Buy-Only Copier...');
    this.isRunning = true;

    try {
      // Test database connection
      await db.query('SELECT 1');
      logger.info('Database connected successfully');

      // Get last processed trade ID
      const result = await db.query(
        'SELECT MAX(leader_trade_id) as last_id FROM copy_attempts'
      );
      this.lastProcessedId = result.rows[0].last_id || 0;

      logger.info({ lastProcessedId: this.lastProcessedId }, 'Resuming from last processed trade');

      await this.pollForNewTrades();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to start Buy-Only Copier');
      throw error;
    }
  }

  stop(): void {
    logger.info('Stopping Buy-Only Copier...');
    this.isRunning = false;
  }

  private async pollForNewTrades(): Promise<void> {
    while (this.isRunning) {
      try {
        // Clean up old entries from recentPurchases (older than 20 minutes)
        const now = Date.now();
        const twentyMinutesAgo = now - (20 * 60 * 1000);
        for (const [tokenMint, timestamp] of this.recentPurchases.entries()) {
          if (timestamp < twentyMinutesAgo) {
            this.recentPurchases.delete(tokenMint);
          }
        }

        const newTrades = await this.fetchNewBuyTrades();

        if (newTrades.length > 0) {
          logger.info({ count: newTrades.length }, 'Found new buy trades to copy');

          for (const trade of newTrades) {
            await this.processBuyTrade(trade);
            this.lastProcessedId = trade.id;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      } catch (error: any) {
        logger.error({ error: error.message }, 'Error in polling loop');
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      }
    }
  }

  private async fetchNewBuyTrades(): Promise<LeaderTrade[]> {
    // Only fetch trades where SOL is the input (buys)
    const result = await db.query(
      `SELECT id, leader_wallet, signature, token_in_mint, token_in_symbol, amount_in,
              token_out_mint, token_out_symbol, amount_out, block_time
       FROM leader_trades
       WHERE id > $1
         AND token_in_mint = $2
       ORDER BY id ASC
       LIMIT 10`,
      [this.lastProcessedId, NATIVE_SOL]
    );

    return result.rows.map((row) => ({
      id: row.id,
      wallet: row.leader_wallet,
      signature: row.signature,
      tokenIn: row.token_in_mint,
      tokenInSymbol: row.token_in_symbol || 'SOL',
      amountIn: row.amount_in,
      tokenOut: row.token_out_mint,
      tokenOutSymbol: row.token_out_symbol || 'Unknown',
      amountOut: row.amount_out,
      blockTime: row.block_time,
    }));
  }

  private async processBuyTrade(trade: LeaderTrade): Promise<void> {
    logger.info({
      id: trade.id,
      wallet: trade.wallet,
      tokenOut: trade.tokenOutSymbol,
      amountIn: trade.amountIn,
    }, 'Processing buy trade');

    try {
      // Check balance
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;

      if (balanceSOL < MIN_BALANCE_SOL) {
        logger.warn({
          currentBalance: balanceSOL,
          required: MIN_BALANCE_SOL,
          tokenOut: trade.tokenOutSymbol,
        }, 'Insufficient balance for buy');

        await this.recordAttempt({
          leaderTradeId: trade.id,
          leaderWallet: trade.wallet,
          leaderSignature: trade.signature,
          tokenIn: trade.tokenIn,
          tokenInSymbol: trade.tokenInSymbol,
          amountIn: trade.amountIn,
          tokenOut: trade.tokenOut,
          tokenOutSymbol: trade.tokenOutSymbol,
          amountOut: trade.amountOut,
          copyPercentage: this.copyPercentage,
          calculatedAmountIn: '0',
          status: 'skipped',
          failureReason: `Insufficient balance: ${balanceSOL.toFixed(4)} SOL (min: ${MIN_BALANCE_SOL} SOL)`,
        });

        return;
      }

      // Check if token is blacklisted
      if (this.blacklistedTokens.has(trade.tokenOut)) {
        logger.warn({
          token: trade.tokenOutSymbol,
          tokenMint: trade.tokenOut,
        }, 'Token is blacklisted - skipping');

        await this.recordAttempt({
          leaderTradeId: trade.id,
          leaderWallet: trade.wallet,
          leaderSignature: trade.signature,
          tokenIn: trade.tokenIn,
          tokenInSymbol: trade.tokenInSymbol,
          amountIn: trade.amountIn,
          tokenOut: trade.tokenOut,
          tokenOutSymbol: trade.tokenOutSymbol,
          amountOut: trade.amountOut,
          copyPercentage: this.copyPercentage,
          calculatedAmountIn: '0',
          status: 'skipped',
          failureReason: 'Token is blacklisted',
        });

        return;
      }

      // Check if token was purchased recently (within 20 minutes)
      const now = Date.now();
      const lastPurchaseTime = this.recentPurchases.get(trade.tokenOut);
      if (lastPurchaseTime) {
        const minutesSinceLastPurchase = (now - lastPurchaseTime) / (1000 * 60);
        if (minutesSinceLastPurchase < 20) {
          logger.warn({
            token: trade.tokenOutSymbol,
            tokenMint: trade.tokenOut,
            minutesAgo: minutesSinceLastPurchase.toFixed(1),
          }, 'Token purchased recently - skipping to avoid duplicate');

          await this.recordAttempt({
            leaderTradeId: trade.id,
            leaderWallet: trade.wallet,
            leaderSignature: trade.signature,
            tokenIn: trade.tokenIn,
            tokenInSymbol: trade.tokenInSymbol,
            amountIn: trade.amountIn,
            tokenOut: trade.tokenOut,
            tokenOutSymbol: trade.tokenOutSymbol,
            amountOut: trade.amountOut,
            copyPercentage: this.copyPercentage,
            calculatedAmountIn: '0',
            status: 'skipped',
            failureReason: `Token purchased ${minutesSinceLastPurchase.toFixed(1)} minutes ago (< 20 min cooldown)`,
          });

          return;
        }
      }

      // Calculate copy amount
      const leaderAmountIn = parseFloat(trade.amountIn);
      const copyAmountIn = this.fixedBuyAmountSOL !== null 
        ? this.fixedBuyAmountSOL 
        : leaderAmountIn * (this.copyPercentage / 100);

      // Check if token is pumping hard - skip to avoid buying tops
      const uptrendCheck = await this.isTokenInStrongUptrend(trade.tokenOut);
      if (uptrendCheck.isUptrend) {
        logger.warn({
          token: trade.tokenOutSymbol,
          tokenMint: trade.tokenOut,
          reason: uptrendCheck.reason,
        }, 'Token pumping hard - skipping buy to avoid top');

        await this.recordAttempt({
          leaderTradeId: trade.id,
          leaderWallet: trade.wallet,
          leaderSignature: trade.signature,
          tokenIn: trade.tokenIn,
          tokenInSymbol: trade.tokenInSymbol,
          amountIn: trade.amountIn,
          tokenOut: trade.tokenOut,
          tokenOutSymbol: trade.tokenOutSymbol,
          amountOut: trade.amountOut,
          copyPercentage: this.copyPercentage,
          calculatedAmountIn: copyAmountIn.toString(),
          status: 'skipped',
          failureReason: `Token in strong uptrend: ${uptrendCheck.reason}`,
        });

        return;
      }

      // Execute the buy
      const amountLamports = Math.floor(copyAmountIn * LAMPORTS_PER_SOL);

      logger.info({
        leaderAmount: leaderAmountIn,
        copyPercentage: this.copyPercentage,
        copyAmount: copyAmountIn,
        lamports: amountLamports,
        tokenOut: trade.tokenOutSymbol,
      }, 'Executing buy');

      const orderData = await this.getJupiterOrder(
        trade.tokenIn,
        trade.tokenOut,
        amountLamports
      );

      if (!orderData) {
        throw new Error('Failed to get Jupiter order');
      }

      const signedTx = await this.signTransaction(orderData.transaction);
      const result = await this.executeJupiterTransaction(signedTx, orderData.requestId);

      if (result.success) {
        // Track this purchase with current timestamp
        this.recentPurchases.set(trade.tokenOut, Date.now());
        
        logger.info({
          signature: result.signature,
          tokenOut: trade.tokenOutSymbol,
        }, '✅ Buy executed successfully');

        await this.recordAttempt({
          leaderTradeId: trade.id,
          leaderWallet: trade.wallet,
          leaderSignature: trade.signature,
          tokenIn: trade.tokenIn,
          tokenInSymbol: trade.tokenInSymbol,
          amountIn: trade.amountIn,
          tokenOut: trade.tokenOut,
          tokenOutSymbol: trade.tokenOutSymbol,
          amountOut: trade.amountOut,
          copyPercentage: this.copyPercentage,
          calculatedAmountIn: copyAmountIn.toString(),
          status: 'success',
          signature: result.signature,
        });
      } else {
        throw new Error(result.error || 'Transaction failed');
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to execute buy');

      await this.recordAttempt({
        leaderTradeId: trade.id,
        leaderWallet: trade.wallet,
        leaderSignature: trade.signature,
        tokenIn: trade.tokenIn,
        tokenInSymbol: trade.tokenInSymbol,
        amountIn: trade.amountIn,
        tokenOut: trade.tokenOut,
        tokenOutSymbol: trade.tokenOutSymbol,
        amountOut: trade.amountOut,
        copyPercentage: this.copyPercentage,
        calculatedAmountIn: '0',
        status: 'failed',
        failureReason: error.message,
      });
    }
  }

  private async isTokenInStrongUptrend(
    tokenMint: string
  ): Promise<{ isUptrend: boolean; reason: string }> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { timeout: 5000 }
      );

      if (!response.data.pairs || response.data.pairs.length === 0) {
        return { isUptrend: false, reason: 'No pairs found' };
      }

      const pair = response.data.pairs.sort(
        (a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      const priceChange5m = parseFloat(pair.priceChange?.m5 || '0');
      const priceChange1h = parseFloat(pair.priceChange?.h1 || '0');
      const priceChange6h = parseFloat(pair.priceChange?.h6 || '0');

      if (priceChange5m > 30) {
        return {
          isUptrend: true,
          reason: `Strong pump: +${priceChange5m.toFixed(1)}% in 5m`,
        };
      }

      if (priceChange1h > 50) {
        return {
          isUptrend: true,
          reason: `Strong pump: +${priceChange1h.toFixed(1)}% in 1h`,
        };
      }

      if (priceChange6h > 100) {
        return {
          isUptrend: true,
          reason: `Strong pump: +${priceChange6h.toFixed(1)}% in 6h`,
        };
      }

      return { isUptrend: false, reason: 'Normal price action' };
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to check token uptrend');
      return { isUptrend: false, reason: 'Failed to fetch price data' };
    }
  }

  private async getJupiterOrder(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      const taker = this.keypair.publicKey.toBase58();
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        taker,
      });

      const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order?${params}`, {
        headers: { 'x-api-key': apiKey },
        timeout: 10000,
      });

      if (response.data.errorCode) {
        logger.error({
          errorCode: response.data.errorCode,
          errorMessage: response.data.errorMessage,
        }, 'Jupiter order error');
        return null;
      }

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get Jupiter order');
      return null;
    }
  }

  private async signTransaction(transactionBase64: string): Promise<string> {
    const transactionBuffer = Buffer.from(transactionBase64, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    transaction.sign([this.keypair]);
    return Buffer.from(transaction.serialize()).toString('base64');
  }

  private async executeJupiterTransaction(
    signedTransaction: string,
    requestId: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      const response = await axios.post(
        `${JUPITER_API_URL}/ultra/v1/execute`,
        { signedTransaction, requestId },
        {
          headers: { 'x-api-key': apiKey },
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to execute Jupiter transaction');
      return { success: false, error: error.message };
    }
  }

  private async recordAttempt(data: {
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
    status: string;
    signature?: string;
    failureReason?: string;
  }): Promise<void> {
    // Log the attempt instead of recording to database
    logger.info({
      leaderTradeId: data.leaderTradeId,
      tokenOut: data.tokenOutSymbol,
      status: data.status,
      signature: data.signature,
      failureReason: data.failureReason,
    }, 'Buy attempt recorded');
  }
}

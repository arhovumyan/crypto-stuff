/**
 * Copy Trade Executor
 * Main service that watches for leader trades and executes copies
 */

import { Connection, LAMPORTS_PER_SOL, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import pg from 'pg';
import pino from 'pino';
import dotenv from 'dotenv';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import axios from 'axios';
import { CopyRecorder } from './copy-recorder.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

// Initialize logger
const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname,context',
      messageFormat: '{context} | {msg}',
      singleLine: false,
    },
  })
);

function createLogger(context: string) {
  return logger.child({ context });
}

const log = createLogger('copy-executor');

// Initialize database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const POLLING_INTERVAL = 500; // 500ms for ultra-fast response (2x per second)
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const DEXSCREENER_API_URL = 'https://api.dexscreener.com';

// Retry configuration for Jupiter order failures
const MAX_SELL_RETRIES = 10; // Maximum number of retry attempts for sell orders
const INITIAL_RETRY_DELAY_MS = 1000; // Start with 1 second delay
const MAX_RETRY_DELAY_MS = 30000; // Cap delay at 30 seconds
const RETRY_BACKOFF_MULTIPLIER = 1.5; // Exponential backoff multiplier

export interface LeaderTrade {
  id: number;
  wallet: string;
  signature: string;
  tokenIn: string;
  tokenInSymbol: string;
  amountIn: string;
  tokenOut: string;
  tokenOutSymbol: string;
  amountOut: string;
  blockTime: Date;
}

export class CopyExecutor {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private recorder: CopyRecorder;
  private lastProcessedId: number = 0;
  private isRunning: boolean = false;

  // Configuration
  private copyPercentage: number;
  private fixedBuyAmountSOL: number | null;
  private maxPositionSizeSOL: number;
  private enableLiveTrading: boolean;
  private blacklistedTokens: Set<string>;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.recorder = new CopyRecorder();

    // Load config
    this.copyPercentage = parseFloat(process.env.COPY_PERCENTAGE || '10');
    
    // Parse FIXED_BUY_AMOUNT_SOL - handle potential comment issues
    const fixedBuyAmountStr = process.env.FIXED_BUY_AMOUNT_SOL?.trim();
    if (fixedBuyAmountStr) {
      // Remove any inline comments (everything after #)
      const cleanValue = fixedBuyAmountStr.split('#')[0].trim();
      this.fixedBuyAmountSOL = parseFloat(cleanValue);
      
      // Validate the parsed value
      if (isNaN(this.fixedBuyAmountSOL) || this.fixedBuyAmountSOL <= 0) {
        log.warn(`⚠️  Invalid FIXED_BUY_AMOUNT_SOL value: "${fixedBuyAmountStr}" - falling back to percentage mode`);
        this.fixedBuyAmountSOL = null;
      } else {
        log.info(`✅ Fixed buy amount configured: ${this.fixedBuyAmountSOL} SOL`);
      }
    } else {
      this.fixedBuyAmountSOL = null;
    }
    
    this.maxPositionSizeSOL = parseFloat(process.env.MAX_POSITION_SIZE_SOL || '999999');
    this.enableLiveTrading = process.env.ENABLE_LIVE_TRADING === 'true';
    
    // Load blacklisted tokens
    const blacklistStr = process.env.BLACKLIST_TOKENS || '';
    this.blacklistedTokens = new Set(
      blacklistStr.split(',').map(t => t.trim()).filter(t => t.length > 0)
    );

    const mode = this.fixedBuyAmountSOL ? `Fixed ${this.fixedBuyAmountSOL} SOL` : `${this.copyPercentage}%`;
    const tradingMode = this.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER';
    log.info(`⚙️  Executor initialized | Mode: ${mode} | Trading: ${tradingMode} | Blacklist: ${this.blacklistedTokens.size} tokens`);
    
    // Log the actual value being used for debugging
    if (this.fixedBuyAmountSOL) {
      log.info(`💰 Buy amount: ${this.fixedBuyAmountSOL} SOL per trade`);
    } else {
      log.info(`💰 Buy amount: ${this.copyPercentage}% of leader trade`);
    }
  }

  /**
   * Initialize wallet from seed phrase
   */
  private async initializeWallet(): Promise<void> {
    const seedPhrase = 
      process.env.COPY_WALLET_SEED_PHREASE || 
      process.env.COPY_WALLET_SEED_PHRASE;

    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in environment');
    }

    const trimmed = seedPhrase.trim();
    
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase');
    }

    // Derive keypair using standard Solana derivation path
    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    const addr = this.keypair.publicKey.toBase58();
    log.info(`💼 Wallet initialized | Address: ${addr.slice(0, 8)}...${addr.slice(-4)}`);
  }

  /**
   * Get order from Jupiter Ultra API (includes quote + unsigned transaction)
   */
  private async getJupiterOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    taker: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        taker, // Wallet address that will execute the swap
      });

      logger.info({
        context: 'Requesting Jupiter order',
        inputMint,
        outputMint,
        amount,
        taker,
      });

      const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order?${params}`, {
        headers: {
          'x-api-key': apiKey,
        },
        timeout: 10000,
      });

      if (response.data.errorCode) {
        logger.error({
          context: 'Jupiter order error',
          errorCode: response.data.errorCode,
          errorMessage: response.data.errorMessage,
        });
        return null;
      }

      logger.info({
        context: 'Received Jupiter order',
        inAmount: response.data.inAmount,
        outAmount: response.data.outAmount,
        priceImpact: response.data.priceImpact,
        router: response.data.router,
        feeBps: response.data.feeBps,
        requestId: response.data.requestId,
      });

      return response.data;
    } catch (error: any) {
      logger.error({
        context: 'Failed to get Jupiter order',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get actual on-chain token balance
   */
  private async getOnChainTokenBalance(tokenMint: string): Promise<number> {
    if (!this.keypair) {
      return 0;
    }

    try {
      const tokenMintPubkey = new PublicKey(tokenMint);
      const associatedTokenAddress = await getAssociatedTokenAddress(
        tokenMintPubkey,
        this.keypair.publicKey
      );

      log.info(`🔍 Checking token account | Address: ${associatedTokenAddress.toBase58()}`);
      
      const tokenAccount = await getAccount(this.connection, associatedTokenAddress);
      const balance = Number(tokenAccount.amount) / LAMPORTS_PER_SOL;
      
      log.info(`✅ On-chain balance verified | ${balance.toFixed(6)} tokens | Account exists`);
      return balance;
    } catch (error: any) {
      // Token account doesn't exist or other error
      if (error.message?.includes('could not find account') || error.name === 'TokenAccountNotFoundError') {
        log.warn(`⚠️  Token account does not exist on-chain | This token was likely never purchased or already fully sold`);
      } else {
        log.error(`❌ Failed to get on-chain balance | ${error.message}`);
      }
      return 0;
    }
  }

  /**
   * Helper function to sleep for a specified duration
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry wrapper for getJupiterOrder with exponential backoff and amount reduction
   */
  private async getJupiterOrderWithRetry(
    inputMint: string,
    outputMint: string,
    amount: number,
    taker: string,
    maxRetries: number = MAX_SELL_RETRIES,
    enableAmountReduction: boolean = false
  ): Promise<{ order: any; actualAmount: number } | null> {
    let lastError: any = null;
    let delay = INITIAL_RETRY_DELAY_MS;
    let baseAmount = amount; // Keep track of the base amount
    let currentAmount = amount;
    const reductionPercentages = [100, 99, 98, 95, 90, 85, 80, 75, 70, 60, 50, 40, 30, 20, 10]; // Try 100% first, then reduce minimally

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // For sells, ALWAYS recheck on-chain balance before each attempt to get the true current balance
      if (enableAmountReduction && this.keypair) {
        log.info(`🔍 Rechecking actual on-chain balance before attempt ${attempt}...`);
        const recheckBalance = await this.getOnChainTokenBalance(inputMint);
        
        if (recheckBalance === 0) {
          // Token account doesn't exist or balance is 0 - stop retrying
          log.warn(`⚠️  Token account has 0 balance or doesn't exist - stopping retry attempts`);
          log.info(`   This token was likely already fully sold. No need to retry.`);
          break;
        }
        
        if (recheckBalance > 0) {
          const recheckLamports = Math.floor(recheckBalance * LAMPORTS_PER_SOL);
          log.info(`📊 Current on-chain balance: ${recheckBalance.toFixed(6)} tokens (${recheckLamports.toLocaleString()} lamports)`);
          
          // Update base amount to the actual current balance
          if (Math.abs(recheckLamports - baseAmount) > 1000) {
            log.warn(`⚠️  Balance changed! Updating from ${(baseAmount / LAMPORTS_PER_SOL).toFixed(6)} to ${recheckBalance.toFixed(6)}`);
            baseAmount = recheckLamports;
          } else {
            baseAmount = recheckLamports; // Always use most recent
          }
        }
      }

      // Apply amount reduction based on attempt number
      if (enableAmountReduction && attempt > 1) {
        const reductionIndex = Math.min(attempt - 1, reductionPercentages.length - 1);
        const reductionPercent = reductionPercentages[reductionIndex];
        currentAmount = Math.floor(baseAmount * (reductionPercent / 100));
        
        if (reductionPercent < 100) {
          log.info(`📉 Trying with ${reductionPercent}% of balance | ${(currentAmount / LAMPORTS_PER_SOL).toFixed(6)} tokens`);
        }
      } else {
        // First attempt - always try 100% of balance
        currentAmount = baseAmount;
        if (attempt === 1) {
          log.info(`🎯 Attempting 100% of balance: ${(currentAmount / LAMPORTS_PER_SOL).toFixed(6)} tokens`);
        }
      }
      
      const order = await this.getJupiterOrder(inputMint, outputMint, currentAmount, taker);
      
      // If order succeeded, return it with the actual amount used
      if (order && order.transaction) {
        if (attempt > 1 || currentAmount !== amount) {
          log.info(`✅ Jupiter order succeeded | Attempt: ${attempt}/${maxRetries} | Selling: ${(currentAmount / LAMPORTS_PER_SOL).toFixed(6)} tokens`);
        }
        return { order, actualAmount: currentAmount };
      }
      
      // If this was the last attempt, break
      if (attempt === maxRetries) {
        log.error(`❌ Jupiter order failed after ${maxRetries} attempts`);
        break;
      }
      
      // Log retry attempt
      log.warn(`🔄 Retrying Jupiter order (attempt ${attempt}/${maxRetries}) in ${(delay / 1000).toFixed(1)}s...`);
      
      // Wait before retrying
      await this.sleep(delay);
      
      // Increase delay with exponential backoff (capped at max)
      delay = Math.min(delay * RETRY_BACKOFF_MULTIPLIER, MAX_RETRY_DELAY_MS);
    }
    
    return null;
  }

  /**
   * Execute the signed transaction via Jupiter Ultra API
   */
  private async executeJupiterTransaction(
    signedTransaction: string,
    requestId: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      logger.info({
        context: 'Executing Jupiter transaction',
        requestId,
      });

      const response = await axios.post(
        `${JUPITER_API_URL}/ultra/v1/execute`,
        {
          signedTransaction,
          requestId,
        },
        {
          headers: {
            'x-api-key': apiKey,
          },
          timeout: 30000,
        }
      );

      logger.info({
        context: 'Jupiter execution response',
        status: response.data.status,
        signature: response.data.signature,
      });

      return response.data;
    } catch (error: any) {
      logger.error({
        context: 'Failed to execute Jupiter transaction',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if token is in downtrend using DexScreener
   * Returns true if price dropped significantly in recent timeframes
   */
  private async isTokenInDowntrend(tokenAddress: string): Promise<{ isDowntrend: boolean; reason?: string }> {
    try {
      // Get token pairs from DexScreener
      const response = await axios.get(
        `${DEXSCREENER_API_URL}/latest/dex/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );

      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        logger.warn({
          context: 'No DexScreener data found for token',
          tokenAddress,
        });
        return { isDowntrend: false }; // Allow buy if no data (new token)
      }

      // Get the main pair (usually highest liquidity)
      const mainPair = response.data.pairs[0];
      const priceChange = mainPair.priceChange;

      if (!priceChange) {
        return { isDowntrend: false }; // No price history, allow buy
      }

      // Parse all timeframes
      const m5Change = parseFloat(priceChange.m5 || '0');
      const h1Change = parseFloat(priceChange.h1 || '0');
      const h6Change = parseFloat(priceChange.h6 || '0');
      const h24Change = parseFloat(priceChange.h24 || '0');
      
      // Downtrend criteria - progressively stricter for longer timeframes:
      // - Down >10% in last 5 minutes (rapid dump)
      // - Down >15% in last hour (short-term collapse)
      // - Down >30% in last 6 hours (medium-term downtrend)
      // - Down >50% in last 24 hours (sustained crash like in the image)
      
      if (m5Change < -10) {
        return { 
          isDowntrend: true, 
          reason: `Price down ${m5Change.toFixed(2)}% in last 5 minutes` 
        };
      }

      if (h1Change < -15) {
        return { 
          isDowntrend: true, 
          reason: `Price down ${h1Change.toFixed(2)}% in last hour` 
        };
      }

      if (h6Change < -30) {
        return { 
          isDowntrend: true, 
          reason: `Price down ${h6Change.toFixed(2)}% in last 6 hours` 
        };
      }

      if (h24Change < -50) {
        return { 
          isDowntrend: true, 
          reason: `Price down ${h24Change.toFixed(2)}% in last 24 hours` 
        };
      }

      logger.info({
        context: 'Token trend check passed',
        tokenAddress,
        m5: `${m5Change.toFixed(1)}%`,
        h1: `${h1Change.toFixed(1)}%`,
        h6: `${h6Change.toFixed(1)}%`,
        h24: `${h24Change.toFixed(1)}%`,
      });

      return { isDowntrend: false };
    } catch (error: any) {
      logger.error({
        context: 'Error checking token trend',
        tokenAddress,
        error: error.message,
      });
      return { isDowntrend: false }; // Allow buy on API error (don't block trades)
    }
  }

  /**
   * Execute swap using Jupiter Ultra API
   */
  private async executeSwap(
    order: any,
    inputMint: string,
    outputMint: string,
    amount: number,
    simulate: boolean = false
  ): Promise<string | null> {
    try {
      if (!this.keypair) {
        throw new Error('Wallet not initialized');
      }

      if (!order || !order.transaction) {
        logger.error({ context: 'Cannot execute swap without order/transaction' });
        return null;
      }

      // Deserialize and sign transaction
      const transactionBuf = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);

      if (simulate) {
        logger.info({
          context: 'SIMULATION MODE | Transaction would be sent',
          inputMint,
          outputMint,
          amount,
          expectedOut: order.outAmount,
          priceImpact: order.priceImpact,
          router: order.router,
        });
        return 'SIMULATED';
      }

      // Serialize signed transaction
      const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString('base64');

      // Execute via Jupiter Ultra API
      const result = await this.executeJupiterTransaction(
        signedTransactionBase64,
        order.requestId
      );

      if (!result || result.status !== 'Success') {
        logger.error({
          context: 'Jupiter execution failed',
          status: result?.status,
          error: result?.error,
        });
        return null;
      }

      logger.info({
        context: 'Swap executed successfully',
        signature: result.signature,
        inputAmount: result.inputAmountResult,
        outputAmount: result.outputAmountResult,
      });

      return result.signature;
    } catch (error: any) {
      logger.error({
        context: 'Failed to execute swap',
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Start the copy executor
   */
  async start(): Promise<void> {
    log.info('🚀 Starting Copy Executor service...');

    // Initialize wallet
    await this.initializeWallet();
    if (!this.keypair) {
      throw new Error('Failed to initialize wallet');
    }

    const publicKey = this.keypair.publicKey.toBase58();

    // Check balance
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    log.info(`💰 Wallet ready | Balance: ${balanceSOL.toFixed(4)} SOL`);

    if (!this.enableLiveTrading) {
      log.info('📝 PAPER TRADING MODE | Transactions will be simulated only');
    } else {
      log.info('🔴 LIVE TRADING MODE | Real transactions will be executed');
    }

    // Get last processed trade ID
    await this.initializeLastProcessedId();

    // Start polling loop
    this.isRunning = true;
    this.pollForNewTrades();
  }

  /**
   * Initialize the last processed ID from database
   */
  private async initializeLastProcessedId(): Promise<void> {
    try {
      const result = await db.query(
        'SELECT MAX(leader_trade_id) as max_id FROM copy_attempts'
      );

      if (result.rows[0].max_id) {
        this.lastProcessedId = result.rows[0].max_id;
        log.info(`✅ Resuming from trade ID: ${this.lastProcessedId}`);
      } else {
        // Start from most recent trade
        const latestTrade = await db.query(
          'SELECT id FROM leader_trades ORDER BY id DESC LIMIT 1'
        );
        if (latestTrade.rows.length > 0) {
          this.lastProcessedId = latestTrade.rows[0].id;
          log.info(`✅ Starting from trade ID: ${this.lastProcessedId}`);
        }
      }
    } catch (error: any) {
      log.error(`❌ Failed to initialize | Error: ${error.message}`);
      this.lastProcessedId = 0;
    }
  }

  /**
   * Check if a token is in a strong uptrend (pump) - skip buying to avoid tops
   */
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

      // Get the pair with highest liquidity
      const pair = response.data.pairs.sort(
        (a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      const priceChange5m = parseFloat(pair.priceChange?.m5 || '0');
      const priceChange1h = parseFloat(pair.priceChange?.h1 || '0');
      const priceChange6h = parseFloat(pair.priceChange?.h6 || '0');

      // Strong uptrend criteria: significant gains in short timeframes
      // Skip if price is up >30% in 5m OR >50% in 1h OR >100% in 6h
      if (priceChange5m > 30) {
        return {
          isUptrend: true,
          reason: `Strong pump detected: +${priceChange5m.toFixed(1)}% in 5m`,
        };
      }

      if (priceChange1h > 50) {
        return {
          isUptrend: true,
          reason: `Strong pump detected: +${priceChange1h.toFixed(1)}% in 1h`,
        };
      }

      if (priceChange6h > 100) {
        return {
          isUptrend: true,
          reason: `Strong pump detected: +${priceChange6h.toFixed(1)}% in 6h`,
        };
      }

      return { isUptrend: false, reason: 'Normal price action' };
    } catch (error: any) {
      logger.warn({
        context: 'Failed to check token uptrend',
        error: error.message,
      });
      return { isUptrend: false, reason: 'Failed to fetch price data' };
    }
  }

  /**
   * Poll for new trades and process them
   */
  private async pollForNewTrades(): Promise<void> {
    while (this.isRunning) {
      try {
        const newTrades = await this.fetchNewTrades();

        if (newTrades.length > 0) {
          logger.info({
            context: 'Found new trades to copy',
            count: newTrades.length,
            oldestTradeId: newTrades[0].id,
            newestTradeId: newTrades[newTrades.length - 1].id,
          });

          for (const trade of newTrades) {
            await this.processTrade(trade);
            this.lastProcessedId = trade.id;
          }
        } else {
          // Log occasionally when no trades (every ~30 seconds)
          if (Date.now() % 30000 < POLLING_INTERVAL) {
            logger.debug({
              context: 'No new trades in last 10 minutes',
              lastProcessedId: this.lastProcessedId,
            });
          }
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      } catch (error: any) {
        logger.error({
          context: 'Error in polling loop',
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      }
    }
  }

  /**
   * Fetch new trades from database
   * Only fetches trades from the last 10 minutes to avoid copying old/stale trades
   */
  private async fetchNewTrades(): Promise<LeaderTrade[]> {
    // Calculate timestamp for 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const result = await db.query(
      `SELECT id, leader_wallet, signature, token_in_mint, token_in_symbol, amount_in,
              token_out_mint, token_out_symbol, amount_out, block_time
       FROM leader_trades
       WHERE id > $1
         AND block_time > $2
       ORDER BY id ASC
       LIMIT 10`,
      [this.lastProcessedId, tenMinutesAgo]
    );

    return result.rows.map((row) => ({
      id: row.id,
      wallet: row.leader_wallet,
      signature: row.signature,
      tokenIn: row.token_in_mint,
      tokenInSymbol: row.token_in_symbol || 'Unknown',
      amountIn: row.amount_in,
      tokenOut: row.token_out_mint,
      tokenOutSymbol: row.token_out_symbol || 'Unknown',
      amountOut: row.amount_out,
      blockTime: row.block_time,
    }));
  }

  /**
   * Get token symbol for display
   */
  private getTokenSymbol(mint: string, symbol: string | null | undefined): string {
    // SOL native mint
    if (mint === 'So11111111111111111111111111111111111111112') {
      return 'SOL';
    }
    // Use symbol if available, otherwise show truncated mint
    if (symbol && symbol !== 'Unknown') {
      return symbol;
    }
    return mint.slice(0, 6) + '...';
  }

  /**
   * Process a single trade
   */
  private async processTrade(trade: LeaderTrade): Promise<void> {
    const tokenInDisplay = this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol);
    const tokenOutDisplay = this.getTokenSymbol(trade.tokenOut, trade.tokenOutSymbol);
    log.info(`👀 Processing trade #${trade.id} | ${tokenInDisplay} → ${tokenOutDisplay}`);

    try {
      // Determine if this is a BUY (SOL → Token) or SELL (Token → SOL)
      const isBuy = trade.tokenIn === NATIVE_SOL;
      const isSell = trade.tokenOut === NATIVE_SOL;

      if (!isBuy && !isSell) {
        log.info(`⏭️  Skipping token-to-token swap | ${this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol)} → ${this.getTokenSymbol(trade.tokenOut, trade.tokenOutSymbol)}`);
        return;
      }

      // For SELL trades, check if we own the tokens
      if (isSell && this.keypair) {
        const tokenBalance = await this.recorder.getTokenBalance(
          this.keypair.publicKey.toBase58(),
          trade.tokenIn
        );

        log.info(`📊 Database balance check | Token: ${this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol)} | Balance: ${tokenBalance.toFixed(6)}`);

        // Verify actual on-chain balance
        log.info(`🔍 Verifying on-chain token balance for ${trade.tokenIn}...`);
        const onChainBalance = await this.getOnChainTokenBalance(trade.tokenIn);
        
        // Determine what amount to try selling - ALWAYS use the maximum available
        // When leader sells, we sell ALL of our positions regardless of balance check results
        let amountToSell = 0;
        
        // Use the maximum of DB balance and on-chain balance to ensure we sell everything
        amountToSell = Math.max(tokenBalance, onChainBalance);
        
        if (amountToSell > 0) {
          const tokenDisplay = this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol);
          log.info(`✅ Selling ALL positions: ${amountToSell.toFixed(6)} ${tokenDisplay}`);
          if (onChainBalance === 0 && tokenBalance > 0) {
            log.warn(`⚠️  On-chain check returned 0, but DB shows ${tokenBalance.toFixed(6)}`);
            log.warn(`   🚀 Selling based on DB balance - leader sold, so we're selling everything!`);
          }
        } else {
          // Both checks show 0 - token account doesn't exist and DB has no record
          // This means we never bought this token or already sold it completely
          const tokenDisplay = this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol);
          log.warn(`⚠️  Cannot sell ${tokenDisplay} - no balance detected`);
          log.info(`   Token account does not exist on-chain and DB shows 0 balance`);
          log.info(`   This token was likely never purchased or already fully sold. Skipping.`);
          
          // Record as skipped (not failed) since we never owned it
          await this.recorder.recordCopyAttempt({
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
            failureReason: 'Token account does not exist - never purchased or already sold',
            ourSignature: undefined,
            jupiterQuote: undefined,
          });
          return;
        }

        const tokenDisplay = this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol);
        log.info(`🔍 Processing SELL | Selling ALL: ${amountToSell.toFixed(6)} ${tokenDisplay} (100% of all positions)`);

        // Convert to smallest unit for Jupiter
        const amountLamports = Math.floor(amountToSell * LAMPORTS_PER_SOL);

        if (amountLamports < 1) {
          log.warn(`⚠️  Amount too small to sell (${amountToSell.toFixed(9)} tokens)`);
          log.info(`   Skipping sell - amount is below minimum threshold`);
          return;
        }

        // Get order and execute with retry logic and amount reduction
        log.info(`🔄 Attempting to get Jupiter order for sell (max ${MAX_SELL_RETRIES} attempts with amount reduction)...`);
        const result = await this.getJupiterOrderWithRetry(
          trade.tokenIn,
          trade.tokenOut,
          amountLamports,
          this.keypair.publicKey.toBase58(),
          MAX_SELL_RETRIES,
          true // Enable amount reduction as fallback
        );

        if (!result || !result.order || !result.order.transaction) {
          log.error(`❌ Failed to get Jupiter order for sell after ${MAX_SELL_RETRIES} retries | ${this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol)}`);
          
          // Record the failed attempt
          await this.recorder.recordCopyAttempt({
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
            calculatedAmountIn: amountToSell.toString(),
            status: 'failed',
            failureReason: `Failed to get Jupiter order after ${MAX_SELL_RETRIES} retries (Insufficient funds error - possible liquidity issue)`,
            ourSignature: undefined,
            jupiterQuote: undefined,
          });
          return;
        }

        const { order, actualAmount } = result;
        const actualAmountSold = actualAmount / LAMPORTS_PER_SOL;
        
        if (actualAmount !== amountLamports) {
          log.info(`ℹ️  Selling reduced amount | Original: ${amountToSell.toFixed(6)} | Actual: ${actualAmountSold.toFixed(6)}`);
        }

        const signature = await this.executeSwap(
          order,
          trade.tokenIn,
          trade.tokenOut,
          actualAmount,
          !this.enableLiveTrading
        );

        if (signature) {
          const solReceived = parseFloat(order.outAmount) / LAMPORTS_PER_SOL;

          const action = this.enableLiveTrading ? '🔴 LIVE SELL' : '📝 PAPER SELL';
          const tokenDisplay = this.getTokenSymbol(trade.tokenIn, trade.tokenInSymbol);
          log.info('');
          log.info('────────────────────────────────────────────────────────────────────────────────');
          log.info('═══════════════════════════════════════════════════');
          log.info(`${action} EXECUTED`);
          log.info('═══════════════════════════════════════════════════');
          log.info(`Trade ID:   #${trade.id}`);
          log.info(`Wallet:     ${trade.wallet}`);
          log.info(`Token:      ${tokenDisplay} → SOL`);
          log.info(`Amount:     ${actualAmountSold.toFixed(6)} ${tokenDisplay} → ${solReceived.toFixed(6)} SOL`);
          if (actualAmount !== amountLamports) {
            log.info(`Note:       Sold ${((actualAmount / amountLamports) * 100).toFixed(1)}% of balance due to liquidity constraints`);
          }
          log.info(`Signature:  ${signature}`);
          log.info('═══════════════════════════════════════════════════');
          log.info('────────────────────────────────────────────────────────────────────────────────');
          log.info('');

          await this.recorder.recordCopyAttempt({
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
            calculatedAmountIn: actualAmountSold.toString(),
            status: 'success',
            ourSignature: signature,
            jupiterQuote: order,
          });

          // Update position tracking for sell (BOTH paper and live)
          await this.recorder.reducePosition(
            this.keypair.publicKey.toBase58(),
            trade.tokenIn,
            trade.tokenInSymbol,
            actualAmountSold,
            solReceived
          );

          // Verify we sold everything - check for remaining dust
          log.info(`🔍 Verifying all tokens were sold...`);
          await this.sleep(2000); // Wait 2 seconds for blockchain to update
          const remainingBalance = await this.getOnChainTokenBalance(trade.tokenIn);
          
          if (remainingBalance > 0.000001) {
            log.warn(`⚠️  DUST REMAINING: ${remainingBalance.toFixed(6)} ${tokenDisplay} still in wallet!`);
            log.warn(`   Consider running another sell to clean this up.`);
          } else if (remainingBalance > 0) {
            log.info(`✅ Tiny dust remaining (${remainingBalance.toFixed(9)} ${tokenDisplay}) - acceptable`);
          } else {
            log.info(`✅ All tokens sold - wallet is clean!`);
          }
        }

        return;
      }

      // Process BUY trade (SOL → Token)
      // Always buy when leader buys - no skipping even if we already own the token
      const leaderAmountIn = parseFloat(trade.amountIn);
      const copyAmountIn = this.fixedBuyAmountSOL !== null 
        ? this.fixedBuyAmountSOL 
        : leaderAmountIn * (this.copyPercentage / 100);
      
      // Debug logging to verify the value being used
      log.info(`💰 Buy calculation | fixedBuyAmountSOL: ${this.fixedBuyAmountSOL}, copyAmountIn: ${copyAmountIn}, leaderAmountIn: ${leaderAmountIn}`);

      // Check if amount is too small
      if (copyAmountIn < 0.0001) {
        logger.info({
          context: 'Trade amount too small, skipping',
          copyAmountIn,
          threshold: 0.0001,
        });

        await this.recorder.recordCopyAttempt({
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
          failureReason: 'Amount too small',
        });

        return;
      }

      // Check if token is blacklisted
      if (this.blacklistedTokens.has(trade.tokenOut)) {
        const tokenDisplay = this.getTokenSymbol(trade.tokenOut, trade.tokenOutSymbol);
        log.warn(`⛔ Token blacklisted | ${tokenDisplay}`);

        await this.recorder.recordCopyAttempt({
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
          failureReason: 'Token is blacklisted',
        });

        return;
      }

      // Check wallet balance before buying
      if (!this.keypair) {
        throw new Error('Wallet not initialized');
      }

      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      const MIN_BALANCE_FOR_BUYS = 0.1; // Require at least 0.1 SOL to execute buys

      if (balanceSOL < MIN_BALANCE_FOR_BUYS) {
        logger.warn({
          context: 'Insufficient balance for buy',
          currentBalance: balanceSOL,
          required: MIN_BALANCE_FOR_BUYS,
          tokenOut: trade.tokenOutSymbol,
        });

        await this.recorder.recordCopyAttempt({
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
          failureReason: `Insufficient balance: ${balanceSOL.toFixed(4)} SOL (min required: ${MIN_BALANCE_FOR_BUYS} SOL)`,
        });

        return;
      }

      // Convert to lamports for Jupiter
      const amountLamports = Math.floor(copyAmountIn * LAMPORTS_PER_SOL);

      // Explicit logging to debug buy amount
      log.info(`🔍 BUY AMOUNT DEBUG | fixedBuyAmountSOL: ${this.fixedBuyAmountSOL}, copyAmountIn: ${copyAmountIn}, amountLamports: ${amountLamports}`);
      
      logger.info({
        context: 'Processing BUY',
        leaderAmount: leaderAmountIn,
        copyPercentage: this.copyPercentage,
        copyAmount: copyAmountIn,
        lamports: amountLamports,
        walletBalance: balanceSOL,
      });

      const order = await this.getJupiterOrder(
        trade.tokenIn,
        trade.tokenOut,
        amountLamports,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        logger.warn({
          context: 'Failed to get Jupiter order',
          inputMint: trade.tokenIn,
          outputMint: trade.tokenOut,
        });

        await this.recorder.recordCopyAttempt({
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
          status: 'failed',
          failureReason: 'Failed to get Jupiter order',
        });

        return;
      }

      // Execute swap using Jupiter Ultra API
      const signature = await this.executeSwap(
        order,
        trade.tokenIn,
        trade.tokenOut,
        amountLamports,
        !this.enableLiveTrading
      );

      if (signature) {
        const action = this.enableLiveTrading ? '🟢 LIVE BUY' : '📝 PAPER BUY';
        const tokenDisplay = this.getTokenSymbol(trade.tokenOut, trade.tokenOutSymbol);
        const expectedOut = parseFloat(order.outAmount) / LAMPORTS_PER_SOL;
        
        log.info('');
        log.info('────────────────────────────────────────────────────────────────────────────────');
        log.info('═══════════════════════════════════════════════════');
        log.info(`${action} EXECUTED`);
        log.info('═══════════════════════════════════════════════════');
        log.info(`Trade ID:   #${trade.id}`);
        log.info(`Wallet:     ${trade.wallet}`);
        log.info(`Token:      SOL → ${tokenDisplay}`);
        log.info(`Amount:     ${copyAmountIn.toFixed(6)} SOL → ${expectedOut.toFixed(6)} ${tokenDisplay}`);
        log.info(`Signature:  ${signature}`);
        log.info('═══════════════════════════════════════════════════');
        log.info('────────────────────────────────────────────────────────────────────────────────');
        log.info('');

        await this.recorder.recordCopyAttempt({
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
          ourSignature: signature,
          jupiterQuote: order,
        });

        // Update position tracking for BOTH paper and live trading
        // (so we know what we own even in paper mode)
        const outputAmount = parseFloat(order.outAmount) / LAMPORTS_PER_SOL;
        await this.recorder.updatePosition(
          this.keypair.publicKey.toBase58(),
          trade.tokenOut,
          trade.tokenOutSymbol,
          outputAmount,
          copyAmountIn,
          trade.id
        );
      } else {
        logger.error({
          context: 'Failed to execute swap',
          leaderTradeId: trade.id,
        });

        await this.recorder.recordCopyAttempt({
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
          status: 'failed',
          failureReason: 'Failed to execute swap transaction',
        });
      }
    } catch (error: any) {
      logger.error({
        context: 'Error processing trade',
        error: error.message,
        stack: error.stack,
        tradeId: trade.id,
      });

      await this.recorder.recordCopyAttempt({
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

  /**
   * Stop the copy executor
   */
  stop(): void {
    log.info('🛑 Stopping Copy Executor service...');
    this.isRunning = false;
  }
}

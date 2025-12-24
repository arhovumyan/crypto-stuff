/**
 * Mirror Executor
 * Copies trades from WATCH_ADDRESSES with fixed $0.10 buy amount
 * Buys when they buy, sells when they sell
 */

import { Connection, Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import pg from 'pg';
import pino from 'pino';
import dotenv from 'dotenv';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import axios from 'axios';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';

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
      messageFormat: '[MIRROR-EXECUTOR] {msg}',
    },
  },
});

// Initialize database
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const POLLING_INTERVAL = 120000; // Check every 2 minutes (120,000ms)
const FIXED_BUY_AMOUNT_USD = 0.10; // $0.10 per trade
const SOL_PRICE_USD = 200; // Approximate - we'll calculate dynamically
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const SLIPPAGE_BPS = 300; // 3% slippage tolerance

interface LeaderTrade {
  id: number;
  leaderWallet: string;
  signature: string;
  slot: number;
  blockTime: Date;
  tokenInMint: string;
  tokenInSymbol: string;
  tokenOutMint: string;
  tokenOutSymbol: string;
  amountIn: number;
  amountOut: number;
  detectedAt: Date;
}

class MirrorExecutor {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private lastProcessedId: number = 0;
  private isRunning: boolean = false;
  private blacklistedTokens: Set<string> = new Set();
  private enableLiveTrading: boolean = false;
  private positions: Map<string, number> = new Map(); // Track our token positions

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.loadConfig();
    this.initializeWallet();
  }

  private loadConfig(): void {
    // Load blacklisted tokens
    const blacklistStr = process.env.BLACKLIST_TOKENS || '';
    this.blacklistedTokens = new Set(
      blacklistStr.split(',').map(t => t.trim()).filter(t => t.length > 0)
    );

    this.enableLiveTrading = process.env.ENABLE_LIVE_TRADING === 'true';

    logger.info(`Trading Mode: ${this.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER'}`);
    logger.info(`Fixed Buy Amount: $${FIXED_BUY_AMOUNT_USD}`);
    logger.info(`Blacklisted Tokens: ${this.blacklistedTokens.size}`);
  }

  private initializeWallet(): void {
    try {
      const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE;
      const privateKeyStr = process.env.COPY_WALLET_PRIVATE_KEY;

      if (seedPhrase) {
        // Derive keypair from seed phrase
        const seed = bip39.mnemonicToSeedSync(seedPhrase);
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        this.keypair = Keypair.fromSeed(derivedSeed);
        logger.info(`✅ Wallet loaded from seed phrase: ${this.keypair.publicKey.toBase58()}`);
      } else if (privateKeyStr) {
        // Try to load from base58 private key
        try {
          const privateKeyBytes = bs58.decode(privateKeyStr);
          this.keypair = Keypair.fromSecretKey(privateKeyBytes);
          logger.info(`✅ Wallet loaded from private key: ${this.keypair.publicKey.toBase58()}`);
        } catch (e) {
          // It might be a public key, not a private key
          logger.warn('⚠️  COPY_WALLET_PRIVATE_KEY appears to be a public key, not a private key');
          logger.warn('⚠️  Please provide COPY_WALLET_SEED_PHRASE for trading');
        }
      }

      if (!this.keypair) {
        logger.warn('⚠️  No trading wallet configured. Running in monitor-only mode.');
      }
    } catch (error) {
      logger.error({ error }, 'Error initializing wallet');
      logger.warn('⚠️  No trading wallet configured. Running in monitor-only mode.');
    }
  }

  async start(): Promise<void> {
    logger.info('╔══════════════════════════════════════════════════╗');
    logger.info('║   💰 Mirror Executor Starting...                ║');
    logger.info('╚══════════════════════════════════════════════════╝');
    logger.info('');
    logger.info('💡 Watching trades from LEADER_WALLET_* addresses');
    logger.info('');

    try {
      // Test database connection
      await db.query('SELECT NOW()');
      logger.info('✅ Database connected');

      // Get the last processed trade ID
      const result = await db.query(
        'SELECT MAX(leader_trade_id) as max_id FROM copy_attempts'
      );
      this.lastProcessedId = result.rows[0]?.max_id || 0;
      logger.info(`📍 Starting from trade ID: ${this.lastProcessedId}`);

      if (this.keypair && this.enableLiveTrading) {
        const balance = await this.connection.getBalance(this.keypair.publicKey);
        logger.info(`💰 Wallet Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }

      this.isRunning = true;
      logger.info('✅ Executor is running. Checking for new trades every 2 minutes...\n');

      // Start polling
      await this.pollLoop();
    } catch (error) {
      logger.error({ error }, 'Failed to start executor');
      throw error;
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkForNewTrades();
      } catch (error) {
        logger.error({ error }, 'Error in poll loop');
      }

      // Wait for next poll interval
      logger.debug(`💤 Waiting ${POLLING_INTERVAL / 1000} seconds until next check...`);
      await this.sleep(POLLING_INTERVAL);
    }
  }

  private async checkForNewTrades(): Promise<void> {
    try {
      // Query for new trades from watched wallets
      const result = await db.query(
        `SELECT id, leader_wallet, signature, slot, block_time, 
                token_in_mint, token_in_symbol, token_out_mint, token_out_symbol,
                amount_in, amount_out, detected_at
         FROM leader_trades
         WHERE id > $1
         ORDER BY id ASC
         LIMIT 50`,
        [this.lastProcessedId]
      );

      const trades: LeaderTrade[] = result.rows.map(row => ({
        id: row.id,
        leaderWallet: row.leader_wallet,
        signature: row.signature,
        slot: row.slot,
        blockTime: row.block_time,
        tokenInMint: row.token_in_mint,
        tokenInSymbol: row.token_in_symbol,
        tokenOutMint: row.token_out_mint,
        tokenOutSymbol: row.token_out_symbol,
        amountIn: parseFloat(row.amount_in),
        amountOut: parseFloat(row.amount_out),
        detectedAt: row.detected_at,
      }));

      if (trades.length === 0) {
        logger.debug('No new trades to process');
        return;
      }

      logger.info(`📊 Found ${trades.length} new trade(s) to process`);

      // Process each trade
      for (const trade of trades) {
        await this.processTrade(trade);
        this.lastProcessedId = trade.id;
      }
    } catch (error) {
      logger.error({ error }, 'Error checking for new trades');
    }
  }

  private async processTrade(trade: LeaderTrade): Promise<void> {
    try {
      // Determine if it's a BUY or SELL
      const isBuy = trade.tokenInMint === NATIVE_SOL && trade.tokenOutMint !== NATIVE_SOL;
      const isSell = trade.tokenOutMint === NATIVE_SOL && trade.tokenInMint !== NATIVE_SOL;

      if (!isBuy && !isSell) {
        logger.debug(`Trade ${trade.id} is not a SOL swap, skipping`);
        await this.recordCopyAttempt(trade.id, 'skipped', 'Not a SOL swap');
        return;
      }

      const tradeType = isBuy ? 'BUY' : 'SELL';
      const token = isBuy ? trade.tokenOutMint : trade.tokenInMint;
      const tokenSymbol = isBuy ? trade.tokenOutSymbol : trade.tokenInSymbol;

      // Check if token is blacklisted
      if (this.blacklistedTokens.has(token)) {
        logger.warn(`❌ Token ${tokenSymbol} is blacklisted, skipping`);
        await this.recordCopyAttempt(trade.id, 'skipped', 'Token is blacklisted');
        return;
      }

      logger.info('');
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info(`🎯 Processing ${tradeType}: ${tokenSymbol}`);
      logger.info('═══════════════════════════════════════════════════════════');
      logger.info(`Leader:  ${trade.leaderWallet.slice(0, 12)}...`);
      logger.info(`Token:   ${token.slice(0, 12)}...`);
      logger.info(`Amount:  ${trade.amountIn.toFixed(4)} ${trade.tokenInSymbol} → ${trade.amountOut.toFixed(4)} ${trade.tokenOutSymbol}`);

      if (isBuy) {
        await this.executeMirrorBuy(trade, token, tokenSymbol);
      } else {
        await this.executeMirrorSell(trade, token, tokenSymbol);
      }

      logger.info('═══════════════════════════════════════════════════════════');
      logger.info('');
    } catch (error) {
      logger.error({ error, tradeId: trade.id }, 'Error processing trade');
      await this.recordCopyAttempt(trade.id, 'failed', `Error: ${error}`);
    }
  }

  private async executeMirrorBuy(trade: LeaderTrade, token: string, tokenSymbol: string): Promise<void> {
    try {
      // Calculate how much SOL to spend for $0.10
      const solPrice = await this.getSOLPrice();
      const solAmount = FIXED_BUY_AMOUNT_USD / solPrice;
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      logger.info(`💵 SOL Price: $${solPrice.toFixed(2)}`);
      logger.info(`💰 Buying ${solAmount.toFixed(6)} SOL (~$${FIXED_BUY_AMOUNT_USD}) worth of ${tokenSymbol}`);

      if (!this.enableLiveTrading) {
        logger.info('📝 PAPER TRADE - Not executing real transaction');
        await this.recordCopyAttempt(trade.id, 'skipped', 'Paper trading mode', {
          solAmount,
          usdAmount: FIXED_BUY_AMOUNT_USD,
        });
        return;
      }

      if (!this.keypair) {
        logger.warn('⚠️  No wallet configured, cannot execute trade');
        await this.recordCopyAttempt(trade.id, 'failed', 'No wallet configured');
        return;
      }

      // Get quote from Jupiter
      const quote = await this.getJupiterQuote(NATIVE_SOL, token, lamports);
      
      if (!quote) {
        logger.error('❌ Failed to get Jupiter quote');
        await this.recordCopyAttempt(trade.id, 'failed', 'Failed to get quote');
        return;
      }

      const expectedTokens = parseInt(quote.outAmount) / Math.pow(10, 6); // Assuming 6 decimals
      logger.info(`📈 Expected to receive: ~${expectedTokens.toFixed(2)} ${tokenSymbol}`);

      // Execute swap
      const signature = await this.executeSwap(quote);

      if (signature) {
        logger.info(`✅ BUY executed! Signature: ${signature}`);
        
        // Update position
        const currentPosition = this.positions.get(token) || 0;
        this.positions.set(token, currentPosition + expectedTokens);
        
        await this.recordCopyAttempt(trade.id, 'success', 'Buy executed', {
          signature,
          solAmount,
          tokenAmount: expectedTokens,
          usdAmount: FIXED_BUY_AMOUNT_USD,
        });
      } else {
        logger.error('❌ BUY failed');
        await this.recordCopyAttempt(trade.id, 'failed', 'Swap execution failed');
      }
    } catch (error) {
      logger.error({ error }, 'Error executing mirror buy');
      await this.recordCopyAttempt(trade.id, 'failed', `Buy error: ${error}`);
    }
  }

  private async executeMirrorSell(trade: LeaderTrade, token: string, tokenSymbol: string): Promise<void> {
    try {
      // Check if we have a position in this token
      const position = this.positions.get(token) || 0;

      if (position <= 0) {
        logger.warn(`⚠️  No position in ${tokenSymbol}, skipping sell`);
        await this.recordCopyAttempt(trade.id, 'skipped', 'No position to sell');
        return;
      }

      logger.info(`💼 Current position: ${position.toFixed(2)} ${tokenSymbol}`);
      logger.info(`🔴 Selling entire position`);

      if (!this.enableLiveTrading) {
        logger.info('📝 PAPER TRADE - Not executing real transaction');
        await this.recordCopyAttempt(trade.id, 'skipped', 'Paper trading mode', {
          tokenAmount: position,
        });
        return;
      }

      if (!this.keypair) {
        logger.warn('⚠️  No wallet configured, cannot execute trade');
        await this.recordCopyAttempt(trade.id, 'failed', 'No wallet configured');
        return;
      }

      // Get token balance from wallet (more accurate than our tracking)
      const tokenBalance = await this.getTokenBalance(token);
      
      if (tokenBalance <= 0) {
        logger.warn(`⚠️  No token balance found for ${tokenSymbol}, skipping sell`);
        await this.recordCopyAttempt(trade.id, 'skipped', 'No token balance found');
        return;
      }

      logger.info(`💼 Actual balance: ${tokenBalance.toFixed(2)} ${tokenSymbol}`);

      // Get quote from Jupiter to sell all tokens
      const tokenLamports = Math.floor(tokenBalance * Math.pow(10, 6)); // Assuming 6 decimals
      const quote = await this.getJupiterQuote(token, NATIVE_SOL, tokenLamports);

      if (!quote) {
        logger.error('❌ Failed to get Jupiter quote');
        await this.recordCopyAttempt(trade.id, 'failed', 'Failed to get quote');
        return;
      }

      const expectedSOL = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
      const solPrice = await this.getSOLPrice();
      const expectedUSD = expectedSOL * solPrice;
      
      logger.info(`📉 Expected to receive: ${expectedSOL.toFixed(6)} SOL (~$${expectedUSD.toFixed(2)})`);

      // Execute swap
      const signature = await this.executeSwap(quote);

      if (signature) {
        logger.info(`✅ SELL executed! Signature: ${signature}`);
        
        // Clear position
        this.positions.delete(token);
        
        await this.recordCopyAttempt(trade.id, 'success', 'Sell executed', {
          signature,
          tokenAmount: tokenBalance,
          solAmount: expectedSOL,
          usdAmount: expectedUSD,
        });
      } else {
        logger.error('❌ SELL failed');
        await this.recordCopyAttempt(trade.id, 'failed', 'Swap execution failed');
      }
    } catch (error) {
      logger.error({ error }, 'Error executing mirror sell');
      await this.recordCopyAttempt(trade.id, 'failed', `Sell error: ${error}`);
    }
  }

  private async getSOLPrice(): Promise<number> {
    try {
      // Use Jupiter price API or DexScreener
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${NATIVE_SOL}`);
      if (response.data?.pairs?.[0]?.priceUsd) {
        return parseFloat(response.data.pairs[0].priceUsd);
      }
    } catch (error) {
      logger.debug('Could not fetch SOL price, using default');
    }
    return SOL_PRICE_USD; // Fallback
  }

  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<any> {
    try {
      const response = await axios.get(`${JUPITER_API_URL}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: SLIPPAGE_BPS,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      logger.error({ error }, 'Error getting Jupiter quote');
      return null;
    }
  }

  private async executeSwap(quote: any): Promise<string | null> {
    try {
      if (!this.keypair) {
        throw new Error('No keypair configured');
      }

      // Get swap transaction from Jupiter
      const { data } = await axios.post(`${JUPITER_API_URL}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      });

      // Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.keypair]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        logger.error({ error: confirmation.value.err }, 'Transaction failed');
        return null;
      }

      return signature;
    } catch (error) {
      logger.error({ error }, 'Error executing swap');
      return null;
    }
  }

  private async getTokenBalance(tokenMint: string): Promise<number> {
    try {
      if (!this.keypair) return 0;

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { mint: new PublicKey(tokenMint) }
      );

      if (tokenAccounts.value.length === 0) return 0;

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return balance || 0;
    } catch (error) {
      logger.error({ error, tokenMint }, 'Error getting token balance');
      return 0;
    }
  }

  private async recordCopyAttempt(
    leaderTradeId: number,
    status: 'pending' | 'success' | 'failed' | 'skipped',
    reason: string,
    metadata?: any
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO copy_attempts 
         (leader_trade_id, status, reason, risk_checks, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [leaderTradeId, status, reason, JSON.stringify(metadata || {})]
      );
    } catch (error) {
      logger.error({ error, leaderTradeId }, 'Error recording copy attempt');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    logger.info('Stopping Mirror Executor...');
    this.isRunning = false;
  }
}

// Main execution
const executor = new MirrorExecutor();

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('\nReceived SIGINT. Shutting down gracefully...');
  executor.stop();
  setTimeout(() => {
    db.end();
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  logger.info('\nReceived SIGTERM. Shutting down gracefully...');
  executor.stop();
  setTimeout(() => {
    db.end();
    process.exit(0);
  }, 1000);
});

// Start the executor
executor.start().catch((error) => {
  logger.error({ error }, 'Fatal error in executor');
  process.exit(1);
});

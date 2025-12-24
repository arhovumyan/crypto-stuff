/**
 * Wallet Mirror Service
 * Continuously monitors wallet addresses and mirrors both BUY and SELL trades with fixed 0.1 SOL amounts
 */

import { Connection, LAMPORTS_PER_SOL, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const POLLING_INTERVAL = 10000; // 10 seconds
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const FIXED_TRADE_AMOUNT_SOL = 0.1; // Always trade 0.1 SOL worth

interface SwapInfo {
  wallet: string;
  signature: string;
  isBuy: boolean; // true = SOL → Token, false = Token → SOL
  tokenMint: string;
  tokenSymbol: string;
  amountIn: string;
}

export class WalletMirror {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private watchAddresses: string[] = [];
  private lastCheckedSignatures: Map<string, string> = new Map();
  private isRunning: boolean = false;
  private enableLiveTrading: boolean;
  private blacklistedTokens: Set<string> = new Set();

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.enableLiveTrading = process.env.ENABLE_LIVE_TRADING === 'true';

    // Load watch addresses from environment variable
    const addressesStr = process.env.WATCH_ADDRESSES || '';
    this.watchAddresses = addressesStr
      .split(',')
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0);

    // Load blacklisted tokens
    const blacklistStr = process.env.BLACKLIST_TOKENS || '';
    blacklistStr.split(',')
      .map(token => token.trim())
      .filter(token => token.length > 0)
      .forEach(token => this.blacklistedTokens.add(token));

    logger.info({
      context: 'WalletMirror initialized',
      tradeAmount: `${FIXED_TRADE_AMOUNT_SOL} SOL`,
      enableLiveTrading: this.enableLiveTrading,
      watchAddresses: this.watchAddresses.length,
      blacklistedTokens: this.blacklistedTokens.size,
    });
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

    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    logger.info({
      context: 'Wallet initialized',
      publicKey: this.keypair.publicKey.toBase58(),
    });
  }

  /**
   * Get Jupiter order
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
   * Execute Jupiter transaction
   */
  private async executeJupiterTransaction(
    signedTransaction: string,
    requestId: string
  ): Promise<string | null> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

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

      return response.data.signature || null;
    } catch (error: any) {
      logger.error({
        context: 'Failed to execute Jupiter transaction',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get token balance
   */
  private async getTokenBalance(tokenMint: string): Promise<number> {
    if (!this.keypair) return 0;

    try {
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(tokenMint),
        this.keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );

      const accountInfo = await getAccount(
        this.connection,
        tokenAccount,
        'confirmed',
        TOKEN_PROGRAM_ID
      );

      return Number(accountInfo.amount) / Math.pow(10, 6); // Assuming 6 decimals
    } catch (error: any) {
      return 0; // Token account doesn't exist
    }
  }

  /**
   * Execute swap
   */
  private async executeSwap(
    order: any,
    inputMint: string,
    outputMint: string,
    amount: number,
    isPaperTrade: boolean
  ): Promise<string | null> {
    if (!this.keypair) {
      throw new Error('Wallet not initialized');
    }

    try {
      const transactionBuffer = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);
      transaction.sign([this.keypair]);

      const signedBuffer = transaction.serialize();
      const signedTransaction = Buffer.from(signedBuffer).toString('base64');

      if (isPaperTrade) {
        const simulatedSig = bs58.encode(Buffer.from(
          `PAPER_${Date.now()}_${Math.random()}`.padEnd(64, '0').slice(0, 64)
        ));
        
        logger.info({
          context: 'PAPER TRADE - Transaction simulated',
          signature: simulatedSig,
        });
        
        return simulatedSig;
      }

      const signature = await this.executeJupiterTransaction(
        signedTransaction,
        order.requestId
      );

      return signature;
    } catch (error: any) {
      logger.error({
        context: 'Failed to execute swap',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Initialize last checked signatures to current state
   * This ensures we only process NEW transactions that happen AFTER service starts
   */
  private async initializeLastSignatures(): Promise<void> {
    logger.info({ context: 'Initializing transaction checkpoints...' });

    for (const address of this.watchAddresses) {
      try {
        const signatures = await this.connection.getSignaturesForAddress(
          new PublicKey(address),
          { limit: 1 }
        );
        if (signatures.length > 0) {
          this.lastCheckedSignatures.set(address, signatures[0].signature);
          logger.info({
            context: 'Checkpoint initialized',
            wallet: address,
            startingFrom: signatures[0].signature.slice(0, 20) + '...',
          });
        }
      } catch (error: any) {
        logger.warn({
          context: 'Could not initialize checkpoint for address',
          address,
          error: error.message,
        });
      }
    }

    logger.info({ 
      context: '✅ Initialization complete - Only processing NEW transactions from now on',
      walletsInitialized: this.lastCheckedSignatures.size 
    });
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    logger.info({ context: 'Starting WalletMirror service' });

    if (this.watchAddresses.length === 0) {
      throw new Error('No watch addresses configured. Set WATCH_ADDRESSES in .env (comma-separated)');
    }

    await this.initializeWallet();
    if (!this.keypair) {
      throw new Error('Failed to initialize wallet');
    }

    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    logger.info({
      context: 'Wallet ready',
      address: this.keypair.publicKey.toBase58(),
      balance: balanceSOL.toFixed(4) + ' SOL',
    });

    if (!this.enableLiveTrading) {
      logger.info({ context: 'PAPER TRADING MODE | Transactions will be simulated only' });
    }

    logger.info({
      context: 'Monitoring wallets',
      count: this.watchAddresses.length,
      addresses: this.watchAddresses,
      checkInterval: '10 seconds',
    });

    // Initialize checkpoints BEFORE starting to monitor
    await this.initializeLastSignatures();

    this.isRunning = true;
    this.monitorWallets();
  }

  /**
   * Monitor wallets for new swaps
   */
  private async monitorWallets(): Promise<void> {
    logger.info({ context: 'Starting monitoring loop' });

    while (this.isRunning) {
      try {
        for (const address of this.watchAddresses) {
          const swaps = await this.checkAddressForNewSwaps(address);
          
          for (const swap of swaps) {
            logger.info({
              context: '🎯 Detected swap from monitored wallet',
              wallet: address,
              type: swap.isBuy ? 'BUY' : 'SELL',
              token: swap.tokenSymbol,
              tokenMint: swap.tokenMint,
            });

            await this.mirrorSwap(swap);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      } catch (error: any) {
        logger.error({
          context: 'Error in monitoring loop',
          error: error.message,
        });
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
      }
    }
  }

  /**
   * Check address for new swaps
   */
  private async checkAddressForNewSwaps(address: string): Promise<SwapInfo[]> {
    try {
      const pubkey = new PublicKey(address);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 10 });

      if (signatures.length === 0) {
        return [];
      }

      const lastChecked = this.lastCheckedSignatures.get(address);
      const newSignatures = lastChecked
        ? signatures.filter(sig => sig.signature !== lastChecked)
        : signatures;

      // Update last checked
      if (signatures.length > 0) {
        this.lastCheckedSignatures.set(address, signatures[0].signature);
      }

      const swaps: SwapInfo[] = [];

      for (const sigInfo of newSignatures) {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) continue;

        const swap = this.parseSwapFromTransaction(tx, address);
        if (swap) {
          swaps.push({
            wallet: address,
            signature: sigInfo.signature,
            ...swap,
          });
        }
      }

      return swaps;
    } catch (error: any) {
      logger.error({
        context: 'Error checking address',
        address,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Parse swap from transaction
   */
  private parseSwapFromTransaction(tx: any, wallet: string): {
    isBuy: boolean;
    tokenMint: string;
    tokenSymbol: string;
    amountIn: string;
  } | null {
    try {
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];
      const preSOL = tx.meta.preBalances[0] || 0;
      const postSOL = tx.meta.postBalances[0] || 0;
      const solChange = (preSOL - postSOL) / LAMPORTS_PER_SOL;

      // BUY: SOL → Token (SOL decreased, token increased)
      if (solChange > 0) {
        for (const postBalance of postBalances) {
          const preBalance = preBalances.find(
            (pre: any) => pre.accountIndex === postBalance.accountIndex
          );

          const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString) : 0;
          const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString);

          if (postAmount > preAmount && postAmount > 0) {
            return {
              isBuy: true,
              tokenMint: postBalance.mint,
              tokenSymbol: postBalance.uiTokenAmount.symbol || 'Unknown',
              amountIn: solChange.toFixed(9),
            };
          }
        }
      }

      // SELL: Token → SOL (SOL increased, token decreased)
      if (solChange < 0) {
        for (const preBalance of preBalances) {
          const postBalance = postBalances.find(
            (post: any) => post.accountIndex === preBalance.accountIndex
          );

          const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString);
          const postAmount = postBalance ? parseFloat(postBalance.uiTokenAmount.uiAmountString) : 0;

          if (preAmount > postAmount && preAmount > 0) {
            return {
              isBuy: false,
              tokenMint: preBalance.mint,
              tokenSymbol: preBalance.uiTokenAmount.symbol || 'Unknown',
              amountIn: preAmount.toFixed(9),
            };
          }
        }
      }

      return null;
    } catch (error: any) {
      logger.error({
        context: 'Error parsing transaction',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Mirror a swap
   */
  private async mirrorSwap(swap: SwapInfo): Promise<void> {
    try {
      // Check blacklist
      if (this.blacklistedTokens.has(swap.tokenMint)) {
        logger.info({
          context: 'Token is blacklisted - skipping',
          token: swap.tokenSymbol,
        });
        return;
      }

      if (!this.keypair) {
        throw new Error('Wallet not initialized');
      }

      // Check balance
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      const MIN_BALANCE = FIXED_TRADE_AMOUNT_SOL + 0.05;

      if (balanceSOL < MIN_BALANCE) {
        logger.error({
          context: 'Insufficient balance',
          currentBalance: balanceSOL,
          required: MIN_BALANCE,
        });
        return;
      }

      let order;
      const amountLamports = Math.floor(FIXED_TRADE_AMOUNT_SOL * LAMPORTS_PER_SOL);

      if (swap.isBuy) {
        // BUY: SOL → Token
        logger.info({
          context: 'Mirroring BUY',
          token: swap.tokenSymbol,
          amount: `${FIXED_TRADE_AMOUNT_SOL} SOL`,
        });

        order = await this.getJupiterOrder(
          NATIVE_SOL,
          swap.tokenMint,
          amountLamports,
          this.keypair.publicKey.toBase58()
        );
      } else {
        // SELL: Token → SOL
        // For sells, we sell all our holdings of that token
        const tokenBalance = await this.getTokenBalance(swap.tokenMint);
        
        if (tokenBalance === 0) {
          logger.info({
            context: 'No balance to sell',
            token: swap.tokenSymbol,
          });
          return;
        }

        logger.info({
          context: 'Mirroring SELL',
          token: swap.tokenSymbol,
          balance: tokenBalance,
        });

        // Convert balance to proper units (assuming 6 decimals)
        const amountToSell = Math.floor(tokenBalance * Math.pow(10, 6));

        order = await this.getJupiterOrder(
          swap.tokenMint,
          NATIVE_SOL,
          amountToSell,
          this.keypair.publicKey.toBase58()
        );
      }

      if (!order || !order.transaction) {
        logger.error({
          context: 'Failed to get Jupiter order',
          token: swap.tokenSymbol,
        });
        return;
      }

      // Execute the swap
      const signature = await this.executeSwap(
        order,
        swap.isBuy ? NATIVE_SOL : swap.tokenMint,
        swap.isBuy ? swap.tokenMint : NATIVE_SOL,
        amountLamports,
        !this.enableLiveTrading
      );

      if (signature) {
        logger.info({
          context: this.enableLiveTrading ? '✅ LIVE TRADE EXECUTED' : '📝 PAPER TRADE SIMULATED',
          type: swap.isBuy ? 'BUY' : 'SELL',
          token: swap.tokenSymbol,
          amount: swap.isBuy ? `${FIXED_TRADE_AMOUNT_SOL} SOL` : 'ALL',
          signature,
        });

        // Record in database
        await this.recordMirrorAttempt({
          leaderWallet: swap.wallet,
          leaderSignature: swap.signature,
          tokenMint: swap.tokenMint,
          tokenSymbol: swap.tokenSymbol,
          isBuy: swap.isBuy,
          ourSignature: signature,
          status: 'success',
        });
      } else {
        logger.error({
          context: 'Failed to execute swap',
          token: swap.tokenSymbol,
        });

        await this.recordMirrorAttempt({
          leaderWallet: swap.wallet,
          leaderSignature: swap.signature,
          tokenMint: swap.tokenMint,
          tokenSymbol: swap.tokenSymbol,
          isBuy: swap.isBuy,
          ourSignature: null,
          status: 'failed',
          failureReason: 'Failed to execute swap',
        });
      }
    } catch (error: any) {
      logger.error({
        context: 'Error mirroring swap',
        error: error.message,
      });
    }
  }

  /**
   * Record mirror attempt in database
   */
  private async recordMirrorAttempt(record: {
    leaderWallet: string;
    leaderSignature: string;
    tokenMint: string;
    tokenSymbol: string;
    isBuy: boolean;
    ourSignature: string | null;
    status: 'success' | 'failed';
    failureReason?: string;
  }): Promise<void> {
    try {
      await db.query(
        `INSERT INTO wallet_mirror_trades 
         (leader_wallet, leader_signature, token_mint, token_symbol, is_buy,
          sol_amount, our_signature, status, failure_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          record.leaderWallet,
          record.leaderSignature,
          record.tokenMint,
          record.tokenSymbol,
          record.isBuy,
          FIXED_TRADE_AMOUNT_SOL,
          record.ourSignature,
          record.status,
          record.failureReason || null,
        ]
      );
    } catch (error: any) {
      logger.error({
        context: 'Failed to record mirror attempt',
        error: error.message,
      });
    }
  }

  /**
   * Ensure database table exists
   */
  async ensureTable(): Promise<void> {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wallet_mirror_trades (
          id SERIAL PRIMARY KEY,
          leader_wallet TEXT NOT NULL,
          leader_signature TEXT NOT NULL,
          token_mint TEXT NOT NULL,
          token_symbol TEXT,
          is_buy BOOLEAN NOT NULL,
          sol_amount NUMERIC NOT NULL,
          our_signature TEXT,
          status TEXT NOT NULL,
          failure_reason TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_mirror_trades_leader_wallet 
        ON wallet_mirror_trades(leader_wallet);
        
        CREATE INDEX IF NOT EXISTS idx_wallet_mirror_trades_token_mint 
        ON wallet_mirror_trades(token_mint);
        
        CREATE INDEX IF NOT EXISTS idx_wallet_mirror_trades_created_at 
        ON wallet_mirror_trades(created_at DESC);
      `);

      logger.info({ context: 'Database table ready' });
    } catch (error: any) {
      logger.error({
        context: 'Failed to create database table',
        error: error.message,
      });
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    logger.info({ context: 'Stopping WalletMirror service' });
    this.isRunning = false;
  }
}

/**
 * 10 Dollar Monster Service
 * Monitors specific wallet addresses and executes one-time $10 purchases
 */

import { Connection, LAMPORTS_PER_SOL, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import pg from 'pg';
import pino from 'pino';
import dotenv from 'dotenv';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import axios from 'axios';
import { PurchaseTracker } from './purchase-tracker.js';
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
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
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
const POLLING_INTERVAL = 60000; // 60 seconds (1 minute)
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const PURCHASE_AMOUNT_SOL = 0.2; // Always buy 0.2 SOL worth

export class TenDollarMonster {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private tracker: PurchaseTracker;
  private watchAddresses: string[] = [];
  private lastCheckedSignatures: Map<string, string> = new Map();
  private isRunning: boolean = false;
  private enableLiveTrading: boolean;
  private hasExecutedSwap: boolean = false;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.tracker = new PurchaseTracker(process.env.DATABASE_URL || '');
    this.enableLiveTrading = process.env.ENABLE_LIVE_TRADING === 'true';

    // Load watch addresses from environment variable
    const addressesStr = process.env.WATCH_ADDRESSES || '';
    this.watchAddresses = addressesStr
      .split(',')
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0);

    logger.info({
      context: '10DollarMonster initialized',
      purchaseAmount: `${PURCHASE_AMOUNT_SOL} SOL`,
      enableLiveTrading: this.enableLiveTrading,
      watchAddresses: this.watchAddresses.length,
      addresses: this.watchAddresses,
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

    // Derive keypair using standard Solana derivation path
    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    logger.info({
      context: 'Wallet initialized',
      publicKey: this.keypair.publicKey.toBase58(),
    });
  }

  /**
   * Get order from Jupiter Ultra API
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

      logger.info({
        context: 'Requesting Jupiter order',
        inputMint,
        outputMint,
        amount,
        amountSOL: amount / LAMPORTS_PER_SOL,
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
   * Execute the signed transaction via Jupiter Ultra API
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
   * Execute a swap transaction
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
      // Decode and sign the transaction
      const transactionBuffer = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      transaction.sign([this.keypair]);

      // Serialize signed transaction
      const signedBuffer = transaction.serialize();
      const signedTransaction = Buffer.from(signedBuffer).toString('base64');

      if (isPaperTrade) {
        // Paper trade - simulate signature
        const simulatedSig = bs58.encode(Buffer.from(
          `PAPER_${Date.now()}_${Math.random()}`.padEnd(64, '0').slice(0, 64)
        ));
        
        logger.info({
          context: 'PAPER TRADE - Transaction simulated',
          signature: simulatedSig,
        });
        
        return simulatedSig;
      }

      // Execute real transaction
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
   * Start the service
   */
  async start(): Promise<void> {
    logger.info({ context: 'Starting 10DollarMonster service' });

    // Validate watch addresses
    if (this.watchAddresses.length === 0) {
      throw new Error('No watch addresses configured. Set WATCH_ADDRESSES in .env (comma-separated)');
    }

    // Initialize wallet
    await this.initializeWallet();
    if (!this.keypair) {
      throw new Error('Failed to initialize wallet');
    }

    // Ensure purchase tracking table exists
    await this.tracker.ensureTable();

    const publicKey = this.keypair.publicKey.toBase58();

    // Check balance
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    logger.info({
      context: 'Wallet ready',
      address: publicKey,
      balance: balanceSOL.toFixed(4) + ' SOL',
    });

    if (!this.enableLiveTrading) {
      logger.info({ context: 'PAPER TRADING MODE | Transactions will be simulated only' });
    }

    logger.info({
      context: 'Monitoring wallets',
      count: this.watchAddresses.length,
      checkInterval: '60 seconds',
    });

    // Start monitoring loop
    this.isRunning = true;
    this.monitorWallets();
  }

  /**
   * Monitor watched wallets for new transactions
   */
  private async monitorWallets(): Promise<void> {
    // Initialize last signatures for each address
    for (const address of this.watchAddresses) {
      try {
        const signatures = await this.connection.getSignaturesForAddress(
          new PublicKey(address),
          { limit: 1 }
        );
        if (signatures.length > 0) {
          this.lastCheckedSignatures.set(address, signatures[0].signature);
        }
      } catch (error: any) {
        logger.warn({
          context: 'Could not initialize signatures for address',
          address,
          error: error.message,
        });
      }
    }

    logger.info({ context: 'Starting wallet monitoring loop' });

    while (this.isRunning && !this.hasExecutedSwap) {
      try {
        // Check each watched address
        for (const address of this.watchAddresses) {
          if (this.hasExecutedSwap) break;

          const newSwap = await this.checkAddressForNewSwap(address);
          if (newSwap) {
            logger.info({
              context: '🎯 Detected new swap from monitored wallet',
              wallet: address,
              tokenOut: newSwap.tokenOut,
              tokenSymbol: newSwap.tokenSymbol,
            });

            // Execute our $10 buy
            await this.executeOurSwap(newSwap);

            // Mark that we've executed and stop
            this.hasExecutedSwap = true;
            logger.info({
              context: '🛑 Swap executed - shutting down service',
            });
            this.stop();
            break;
          }
        }

        if (this.isRunning && !this.hasExecutedSwap) {
          // Wait before next check
          logger.info({
            context: 'Next check in 60 seconds...',
            monitoringAddresses: this.watchAddresses.length,
          });
          await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
        }
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
   * Check a specific address for new swap transactions
   */
  private async checkAddressForNewSwap(address: string): Promise<{
    wallet: string;
    signature: string;
    tokenOut: string;
    tokenSymbol: string;
    amountIn: string;
  } | null> {
    try {
      const pubkey = new PublicKey(address);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 5 });

      if (signatures.length === 0) {
        return null;
      }

      const lastChecked = this.lastCheckedSignatures.get(address);
      const newSignatures = lastChecked
        ? signatures.filter(sig => sig.signature !== lastChecked).slice(0, 1)
        : [signatures[0]];

      // Update last checked
      if (signatures.length > 0) {
        this.lastCheckedSignatures.set(address, signatures[0].signature);
      }

      // Check for SOL -> Token swaps in new transactions
      for (const sigInfo of newSignatures) {
        const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) continue;

        // Analyze transaction for swaps
        const swap = this.parseSwapFromTransaction(tx, address);
        if (swap) {
          return {
            wallet: address,
            signature: sigInfo.signature,
            ...swap,
          };
        }
      }

      return null;
    } catch (error: any) {
      logger.error({
        context: 'Error checking address',
        address,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Parse a swap transaction to extract token info
   */
  private parseSwapFromTransaction(tx: any, wallet: string): {
    tokenOut: string;
    tokenSymbol: string;
    amountIn: string;
  } | null {
    try {
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      // Look for new token accounts (tokens that appeared after transaction)
      for (const postBalance of postBalances) {
        const preBalance = preBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex
        );

        // New token or increased balance
        if (!preBalance || parseFloat(preBalance.uiTokenAmount.uiAmountString) === 0) {
          if (parseFloat(postBalance.uiTokenAmount.uiAmountString) > 0) {
            // Check if SOL was spent
            const preSOL = tx.meta.preBalances[0] || 0;
            const postSOL = tx.meta.postBalances[0] || 0;
            const solSpent = (preSOL - postSOL) / LAMPORTS_PER_SOL;

            if (solSpent > 0) {
              return {
                tokenOut: postBalance.mint,
                tokenSymbol: postBalance.uiTokenAmount.symbol || 'Unknown',
                amountIn: solSpent.toFixed(9),
              };
            }
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
   * Execute our $10 swap
   */
  private async executeOurSwap(swapInfo: {
    wallet: string;
    signature: string;
    tokenOut: string;
    tokenSymbol: string;
    amountIn: string;
  }): Promise<void> {
    logger.info({
      context: 'Executing our $10 swap',
      targetToken: swapInfo.tokenSymbol,
      targetMint: swapInfo.tokenOut,
    });

    try {
      // Check if we've already purchased this token
      const alreadyPurchased = await this.tracker.hasPurchased(swapInfo.tokenOut);
      if (alreadyPurchased) {
        logger.info({
          context: 'Already purchased this token - skipping',
          token: swapInfo.tokenSymbol,
        });
        return;
      }

      // Check wallet balance
      if (!this.keypair) {
        throw new Error('Wallet not initialized');
      }

      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      const MIN_BALANCE = PURCHASE_AMOUNT_SOL + 0.1;

      if (balanceSOL < MIN_BALANCE) {
        logger.error({
          context: 'Insufficient balance',
          currentBalance: balanceSOL,
          required: MIN_BALANCE,
        });

        await this.tracker.recordPurchase({
          leaderTradeId: 0,
          leaderWallet: swapInfo.wallet,
          leaderSignature: swapInfo.signature,
          tokenMint: swapInfo.tokenOut,
          tokenSymbol: swapInfo.tokenSymbol,
          solAmount: PURCHASE_AMOUNT_SOL,
          ourSignature: null,
          status: 'failed',
          failureReason: `Insufficient balance: ${balanceSOL.toFixed(4)} SOL`,
        });
        return;
      }

      // Convert to lamports
      const amountLamports = Math.floor(PURCHASE_AMOUNT_SOL * LAMPORTS_PER_SOL);

      // Get order from Jupiter
      const order = await this.getJupiterOrder(
        NATIVE_SOL,
        swapInfo.tokenOut,
        amountLamports,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        logger.error({
          context: 'Failed to get Jupiter order',
          token: swapInfo.tokenSymbol,
        });

        await this.tracker.recordPurchase({
          leaderTradeId: 0,
          leaderWallet: swapInfo.wallet,
          leaderSignature: swapInfo.signature,
          tokenMint: swapInfo.tokenOut,
          tokenSymbol: swapInfo.tokenSymbol,
          solAmount: PURCHASE_AMOUNT_SOL,
          ourSignature: null,
          status: 'failed',
          failureReason: 'Failed to get Jupiter order',
        });
        return;
      }

      // Execute the swap
      const signature = await this.executeSwap(
        order,
        NATIVE_SOL,
        swapInfo.tokenOut,
        amountLamports,
        !this.enableLiveTrading
      );

      if (signature) {
        logger.info({
          context: this.enableLiveTrading ? '✅ LIVE BUY EXECUTED' : '📝 PAPER BUY SIMULATED',
          token: swapInfo.tokenSymbol,
          solAmount: PURCHASE_AMOUNT_SOL,
          signature,
        });

        await this.tracker.recordPurchase({
          leaderTradeId: 0,
          leaderWallet: swapInfo.wallet,
          leaderSignature: swapInfo.signature,
          tokenMint: swapInfo.tokenOut,
          tokenSymbol: swapInfo.tokenSymbol,
          solAmount: PURCHASE_AMOUNT_SOL,
          ourSignature: signature,
          status: 'success',
        });
      } else {
        logger.error({
          context: 'Failed to execute swap',
          token: swapInfo.tokenSymbol,
        });

        await this.tracker.recordPurchase({
          leaderTradeId: 0,
          leaderWallet: swapInfo.wallet,
          leaderSignature: swapInfo.signature,
          tokenMint: swapInfo.tokenOut,
          tokenSymbol: swapInfo.tokenSymbol,
          solAmount: PURCHASE_AMOUNT_SOL,
          ourSignature: null,
          status: 'failed',
          failureReason: 'Failed to execute swap',
        });
      }
    } catch (error: any) {
      logger.error({
        context: 'Error executing our swap',
        error: error.message,
      });

      await this.tracker.recordPurchase({
        leaderTradeId: 0,
        leaderWallet: swapInfo.wallet,
        leaderSignature: swapInfo.signature,
        tokenMint: swapInfo.tokenOut,
        tokenSymbol: swapInfo.tokenSymbol,
        solAmount: PURCHASE_AMOUNT_SOL,
        ourSignature: null,
        status: 'failed',
        failureReason: error.message,
      });
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    logger.info({ context: 'Stopping 10DollarMonster service' });
    this.isRunning = false;
    // Don't call process.exit when used as API - just stop the loop
  }

  /**
   * Get monitoring status
   */
  getStatus(): { isRunning: boolean; hasExecutedSwap: boolean; watchAddresses: string[] } {
    return {
      isRunning: this.isRunning,
      hasExecutedSwap: this.hasExecutedSwap,
      watchAddresses: this.watchAddresses,
    };
  }
}

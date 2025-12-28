/**
 * Jupiter Swap Executor
 * Handles buying and selling tokens via Jupiter
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from './config';
import { Logger } from './logger';

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount?: number;
  outputAmount?: number;
  error?: string;
}

export class JupiterExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private walletPublicKey: PublicKey;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    
    try {
      // Derive keypair from seed phrase using a deterministic method
      const seedPhrase = config.walletSeedPhrase;
      const seed = this.mnemonicToSeed(seedPhrase);
      this.wallet = Keypair.fromSeed(seed.slice(0, 32));
      this.walletPublicKey = this.wallet.publicKey;

      Logger.info(`Wallet initialized: ${this.walletPublicKey.toString()}`);
    } catch (error: any) {
      Logger.error('Failed to initialize wallet from seed phrase', error);
      throw error;
    }
  }

  /**
   * Convert mnemonic to seed using a simple deterministic hash
   * This is a simplified version - for production use @scure/bip39
   */
  private mnemonicToSeed(mnemonic: string): Buffer {
    const crypto = require('crypto');
    
    // Create a deterministic seed from the mnemonic
    // Using PBKDF2 for better security than simple hash
    const seed = crypto.pbkdf2Sync(
      mnemonic,
      'solana-wallet-seed', // salt
      2048, // iterations
      64, // key length
      'sha512' // digest
    );
    
    return seed;
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    return this.walletPublicKey.toString();
  }

  /**
   * Get SOL balance
   */
  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.walletPublicKey);
    return balance / 1e9; // Convert lamports to SOL
  }

  /**
   * Buy a token with SOL
   */
  async buyToken(tokenMint: string, solAmount: number): Promise<SwapResult> {
    if (!config.enableLiveTrading) {
      Logger.warning('PAPER TRADING MODE - No real transaction executed');
      return {
        success: true,
        signature: 'PAPER_TRADE_' + Date.now(),
        inputAmount: solAmount,
        outputAmount: 1000000, // Simulated
      };
    }

    try {
      Logger.buyAttempt(tokenMint, solAmount);

      const inputMint = 'So11111111111111111111111111111111111111112'; // SOL
      const outputMint = tokenMint;
      const amount = Math.floor(solAmount * 1e9); // Convert to lamports

      // Get quote from Jupiter
      const quoteUrl = `${config.jupiterApiUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${config.maxSlippageBps}`;
      
      const quoteResponse = await axios.get(quoteUrl);
      const quote = quoteResponse.data;

      if (!quote || !quote.outAmount) {
        return {
          success: false,
          error: 'Failed to get quote from Jupiter',
        };
      }

      Logger.info(`Quote received: ${quote.outAmount} tokens for ${solAmount} SOL`);

      // Get swap transaction
      const swapUrl = `${config.jupiterApiUrl}/swap`;
      const swapResponse = await axios.post(swapUrl, {
        quoteResponse: quote,
        userPublicKey: this.walletPublicKey.toString(),
        wrapUnwrapSOL: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: config.priorityFeeLamports,
      });

      const { swapTransaction } = swapResponse.data;

      // Deserialize and sign transaction
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
        };
      }

      const tokensReceived = parseFloat(quote.outAmount) / 1e6; // Adjust decimals

      Logger.buySuccess(tokenMint, solAmount, tokensReceived, signature);

      return {
        success: true,
        signature,
        inputAmount: solAmount,
        outputAmount: tokensReceived,
      };

    } catch (error: any) {
      Logger.error('Buy failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sell a token for SOL
   */
  async sellToken(tokenMint: string, tokenAmount: number): Promise<SwapResult> {
    if (!config.enableLiveTrading) {
      Logger.warning('PAPER TRADING MODE - No real transaction executed');
      return {
        success: true,
        signature: 'PAPER_TRADE_SELL_' + Date.now(),
        inputAmount: tokenAmount,
        outputAmount: 0.2, // Simulated 2x
      };
    }

    try {
      Logger.info(`Attempting to sell ${tokenAmount} tokens of ${tokenMint}`);

      const inputMint = tokenMint;
      const outputMint = 'So11111111111111111111111111111111111111112'; // SOL
      const amount = Math.floor(tokenAmount * 1e6); // Adjust for decimals

      // Get quote
      const quoteUrl = `${config.jupiterApiUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${config.maxSlippageBps}`;
      
      const quoteResponse = await axios.get(quoteUrl);
      const quote = quoteResponse.data;

      if (!quote || !quote.outAmount) {
        return {
          success: false,
          error: 'Failed to get quote from Jupiter',
        };
      }

      const solReceived = parseFloat(quote.outAmount) / 1e9;
      Logger.info(`Quote received: ${solReceived} SOL for ${tokenAmount} tokens`);

      // Get swap transaction
      const swapUrl = `${config.jupiterApiUrl}/swap`;
      const swapResponse = await axios.post(swapUrl, {
        quoteResponse: quote,
        userPublicKey: this.walletPublicKey.toString(),
        wrapUnwrapSOL: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: config.priorityFeeLamports,
      });

      const { swapTransaction } = swapResponse.data;

      // Deserialize and sign
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.wallet]);

      // Send
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
        };
      }

      Logger.info(`Sell successful: Received ${solReceived} SOL`);

      return {
        success: true,
        signature,
        inputAmount: tokenAmount,
        outputAmount: solReceived,
      };

    } catch (error: any) {
      Logger.error('Sell failed', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get token balance
   */
  async getTokenBalance(tokenMint: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.walletPublicKey,
        { mint: mintPubkey }
      );

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return balance || 0;

    } catch (error: any) {
      Logger.debug(`Error getting token balance for ${tokenMint}: ${error.message}`);
      return 0;
    }
  }
}

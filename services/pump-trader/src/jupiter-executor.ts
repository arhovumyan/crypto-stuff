/**
 * Jupiter Execution Engine
 * Handles all trades via Jupiter Swap API
 */

import axios from 'axios';
import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { config } from './config';
import { Logger } from './logger';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  slippageBps: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount?: string;
  outputAmount?: string;
}

export class JupiterExecutor {
  private connection: Connection;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
    this.wallet = this.loadWallet();
  }

  private loadWallet(): Keypair {
    // Try loading from private key first (if provided in base58)
    try {
      const privateKeyEnv = process.env.COPY_WALLET_PRIVATE_KEY;
      if (privateKeyEnv && privateKeyEnv.length > 50) {
        const privateKey = bs58.decode(privateKeyEnv);
        return Keypair.fromSecretKey(privateKey);
      }
    } catch (error) {
      // Fall through to seed phrase handling
    }

    // Load from seed phrase
    const seedPhrase = config.copyWalletSeedPhrase;
    const words = seedPhrase.trim().split(/\s+/);
    
    if (words.length !== 12 && words.length !== 24) {
      throw new Error('Invalid seed phrase: must be 12 or 24 words');
    }

    // Validate seed phrase
    if (!bip39.validateMnemonic(seedPhrase)) {
      throw new Error('Invalid seed phrase: mnemonic validation failed');
    }

    // Convert seed phrase to seed
    const seed = bip39.mnemonicToSeedSync(seedPhrase, '');
    
    // Derive keypair using Solana's derivation path (m/44'/501'/0'/0')
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    
    return Keypair.fromSeed(derivedSeed);
  }

  /**
   * Get a quote for a swap
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    decimals: number = 9
  ): Promise<SwapQuote | null> {
    try {
      const lamports = Math.floor(amount * Math.pow(10, decimals));
      
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: lamports.toString(),
        slippageBps: config.slippageBps.toString(),
      });

      const url = `${config.jupiterApiUrl}/quote?${params.toString()}`;
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.data) {
        return null;
      }

      return {
        inputMint,
        outputMint,
        inAmount: response.data.inAmount,
        outAmount: response.data.outAmount,
        priceImpactPct: parseFloat(response.data.priceImpactPct || '0'),
        slippageBps: config.slippageBps,
      };

    } catch (error: any) {
      Logger.debug(`Jupiter quote error`, {
        inputMint,
        outputMint,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Buy tokens with SOL
   */
  async buyToken(tokenMint: string, solAmount: number): Promise<SwapResult> {
    if (!config.enableLiveTrading) {
      Logger.paperTradingMode(tokenMint, solAmount);
      return {
        success: true,
        signature: 'PAPER_TRADE_' + Date.now(),
        inputAmount: solAmount.toString(),
        outputAmount: '1000000', // Fake output
      };
    }

    try {
      Logger.jupiterQuoteRequested(tokenMint, solAmount);

      // Get quote
      const quote = await this.getQuote(SOL_MINT, tokenMint, solAmount, 9);
      if (!quote) {
        return {
          success: false,
          error: 'Failed to get Jupiter quote',
        };
      }

      Logger.jupiterQuoteReceived(
        tokenMint,
        solAmount,
        quote.outAmount,
        parseFloat(quote.outAmount) / parseFloat(quote.inAmount)
      );

      // Get swap transaction
      const swapResponse = await axios.post(
        `${config.jupiterApiUrl}/swap`,
        {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: config.priorityFeeLamports,
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!swapResponse.data || !swapResponse.data.swapTransaction) {
        return {
          success: false,
          error: 'Failed to get swap transaction',
        };
      }

      // Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Sell tokens for SOL
   */
  async sellToken(tokenMint: string, tokenBalance: number, decimals: number = 9): Promise<SwapResult> {
    if (!config.enableLiveTrading) {
      return {
        success: true,
        signature: 'PAPER_TRADE_SELL_' + Date.now(),
        inputAmount: tokenBalance.toString(),
        outputAmount: '0.2', // Fake 2x profit
      };
    }

    try {
      // Get quote for selling
      const quote = await this.getQuote(tokenMint, SOL_MINT, tokenBalance, decimals);
      if (!quote) {
        return {
          success: false,
          error: 'Failed to get Jupiter quote for sell',
        };
      }

      // Get swap transaction
      const swapResponse = await axios.post(
        `${config.jupiterApiUrl}/swap`,
        {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: config.priorityFeeLamports,
        },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!swapResponse.data || !swapResponse.data.swapTransaction) {
        return {
          success: false,
          error: 'Failed to get swap transaction for sell',
        };
      }

      // Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Get current value of token position in SOL
   */
  async getPositionValue(tokenMint: string, tokenBalance: number, decimals: number = 9): Promise<number | null> {
    const quote = await this.getQuote(tokenMint, SOL_MINT, tokenBalance, decimals);
    if (!quote) return null;

    const solAmount = parseFloat(quote.outAmount) / Math.pow(10, 9);
    return solAmount;
  }

  getWalletAddress(): string {
    return this.wallet.publicKey.toString();
  }
}

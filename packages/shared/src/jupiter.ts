/**
 * Jupiter Integration
 * Handles swap quotes and transaction building via Jupiter Aggregator
 */

import { Connection, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import { logger } from './logger.js';
import { config } from './config.js';

const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
}

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  userPublicKey: string;
}

export class JupiterService {
  private static instance: JupiterService | null = null;
  private connection: Connection;

  private constructor() {
    this.connection = new Connection(config.HELIUS_RPC_URL, 'confirmed');
  }

  static getInstance(): JupiterService {
    if (!JupiterService.instance) {
      JupiterService.instance = new JupiterService();
    }
    return JupiterService.instance;
  }

  /**
   * Get swap quote from Jupiter
   */
  async getQuote(params: SwapParams): Promise<JupiterQuote | null> {
    try {
      const { inputMint, outputMint, amount, slippageBps = 50 } = params;

      logger.info('Requesting Jupiter quote', {
        inputMint,
        outputMint,
        amount,
        slippageBps,
      });

      const response = await axios.get(`${JUPITER_API_URL}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps,
          onlyDirectRoutes: false,
          asLegacyTransaction: false,
        },
        timeout: 10000,
      });

      if (!response.data) {
        logger.warn('No quote received from Jupiter');
        return null;
      }

      const quote = response.data;
      logger.info('Jupiter quote received', {
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        priceImpact: quote.priceImpactPct,
        routes: quote.routePlan?.length || 0,
      });

      return quote;
    } catch (error: any) {
      logger.error('Failed to get Jupiter quote', {
        error: error.message,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
      });
      return null;
    }
  }

  /**
   * Build swap transaction from quote
   */
  async buildSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string,
    wrapUnwrapSOL: boolean = true
  ): Promise<string | null> {
    try {
      logger.info('Building swap transaction', {
        userPublicKey,
      });

      const response = await axios.post(
        `${JUPITER_API_URL}/swap`,
        {
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: wrapUnwrapSOL,
          computeUnitPriceMicroLamports: 'auto',
          dynamicComputeUnitLimit: true,
        },
        {
          timeout: 10000,
        }
      );

      if (!response.data?.swapTransaction) {
        logger.warn('No swap transaction received from Jupiter');
        return null;
      }

      logger.info('Swap transaction built successfully');
      return response.data.swapTransaction;
    } catch (error: any) {
      logger.error('Failed to build swap transaction', {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Execute complete swap: quote -> build -> sign -> send
   */
  async executeSwap(
    params: SwapParams,
    signer: any,
    simulate: boolean = false
  ): Promise<string | null> {
    try {
      // Get quote
      const quote = await this.getQuote(params);
      if (!quote) {
        logger.error('Cannot execute swap without quote');
        return null;
      }

      // Build transaction
      const swapTransactionBase64 = await this.buildSwapTransaction(
        quote,
        params.userPublicKey
      );
      if (!swapTransactionBase64) {
        logger.error('Cannot execute swap without transaction');
        return null;
      }

      // Deserialize and sign
      const swapTransactionBuf = Buffer.from(swapTransactionBase64, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([signer]);

      if (simulate) {
        logger.info('SIMULATION MODE | Transaction would be sent', {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
        });
        return 'SIMULATED';
      }

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 3,
        }
      );

      logger.info('Swap transaction sent', {
        signature,
      });

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      logger.info('Swap transaction confirmed', {
        signature,
      });

      return signature;
    } catch (error: any) {
      logger.error('Failed to execute swap', {
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }
}

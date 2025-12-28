// Jupiter API client for token swaps
import axios from 'axios';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const JUPITER_API = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || '';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
}

export class JupiterClient {
  private static connection: Connection;
  private static wallet: Keypair;

  static initialize() {
    this.connection = new Connection(HELIUS_RPC_URL, 'confirmed');
    
    // Get wallet from seed phrase
    const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE || '';
    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not set in .env');
    }
    
    // For now, we'll use a simple approach - in production you'd use proper mnemonic derivation
    // This is a placeholder - you should use @solana/web3.js Keypair.fromSecretKey properly
    console.warn('Warning: Using placeholder wallet initialization');
  }

  static async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100
  ): Promise<QuoteResponse | null> {
    try {
      const response = await axios.get(`${JUPITER_API}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error getting quote:', error);
      return null;
    }
  }

  static async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100
  ): Promise<string | null> {
    try {
      // Get quote
      const quote = await this.getQuote(inputMint, outputMint, amount, slippageBps);
      if (!quote) {
        return null;
      }

      // Get swap transaction
      const swapResponse = await axios.post(`${JUPITER_API}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });

      const { swapTransaction } = swapResponse.data;

      // Deserialize and sign transaction
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.wallet]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      });

      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      return signature;
    } catch (error) {
      console.error('Error executing swap:', error);
      return null;
    }
  }

  static async buyToken(tokenMint: string, solAmount: number): Promise<string | null> {
    const lamports = solAmount * 1e9; // Convert SOL to lamports
    return this.swap(SOL_MINT, tokenMint, lamports);
  }

  static async sellToken(
    tokenMint: string, 
    tokenAmount: number, 
    decimals: number
  ): Promise<string | null> {
    const amount = tokenAmount * Math.pow(10, decimals);
    return this.swap(tokenMint, SOL_MINT, amount);
  }
}

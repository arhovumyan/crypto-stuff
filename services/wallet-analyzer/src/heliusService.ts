import { Connection, PublicKey, ParsedTransactionWithMeta, ParsedInstruction } from '@solana/web3.js';
import axios from 'axios';
import { logger } from './logger';

interface HeliusTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  nativeTransfers: any[];
  tokenTransfers: any[];
  accountData: any[];
}

export class HeliusService {
  private connection: Connection;
  private apiKey: string;
  private baseUrl: string;
  private requestCount = 0;
  private lastRequestTime = Date.now();
  private readonly RATE_LIMIT = 100; // requests per second
  
  constructor(apiKey: string, rpcUrl: string) {
    this.apiKey = apiKey;
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.baseUrl = `https://api.helius.xyz/v0`;
    
    logger.info('HeliusService initialized', { rpcUrl });
  }
  
  /**
   * Rate limiting helper
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < 1000 && this.requestCount >= this.RATE_LIMIT) {
      const waitTime = 1000 - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
    }
    
    if (timeSinceLastRequest >= 1000) {
      this.requestCount = 0;
      this.lastRequestTime = now;
    }
    
    this.requestCount++;
  }
  
  /**
   * Fetch transaction history using Helius Enhanced API
   */
  async getTransactionHistory(
    walletAddress: string,
    options: {
      beforeSignature?: string;
      limit?: number;
    } = {}
  ): Promise<HeliusTransaction[]> {
    await this.rateLimit();
    
    const limit = options.limit || 100;
    
    try {
      const params: any = {
        'api-key': this.apiKey
      };
      
      if (options.beforeSignature) {
        params.before = options.beforeSignature;
      }
      
      const url = `${this.baseUrl}/addresses/${walletAddress}/transactions`;
      
      logger.debug('Fetching transaction history', { 
        walletAddress, 
        beforeSignature: options.beforeSignature,
        limit 
      });
      
      const response = await axios.get(url, {
        params,
        timeout: 30000
      });
      
      return response.data || [];
    } catch (error: any) {
      logger.error('Error fetching transaction history', {
        walletAddress,
        error: error.message,
        status: error.response?.status
      });
      
      // Retry logic for 429 or 5xx errors
      if (error.response?.status === 429 || error.response?.status >= 500) {
        logger.info('Retrying after error...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.getTransactionHistory(walletAddress, options);
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch complete transaction history with pagination
   */
  async *fetchAllTransactions(
    walletAddress: string,
    startDate?: Date
  ): AsyncGenerator<HeliusTransaction[], void, unknown> {
    let beforeSignature: string | undefined;
    let hasMore = true;
    let totalFetched = 0;
    
    logger.info('Starting complete transaction fetch', { 
      walletAddress,
      startDate: startDate?.toISOString() 
    });
    
    while (hasMore) {
      const transactions = await this.getTransactionHistory(walletAddress, {
        beforeSignature,
        limit: 100
      });
      
      if (transactions.length === 0) {
        hasMore = false;
        break;
      }
      
      // Filter by date if provided
      let filteredTransactions = transactions;
      if (startDate) {
        filteredTransactions = transactions.filter(tx => {
          const txDate = new Date(tx.timestamp * 1000);
          return txDate >= startDate;
        });
        
        // If all transactions are before startDate, stop
        if (filteredTransactions.length === 0 && transactions.length > 0) {
          const lastTxDate = new Date(transactions[transactions.length - 1].timestamp * 1000);
          if (lastTxDate < startDate) {
            hasMore = false;
            break;
          }
        }
      }
      
      totalFetched += filteredTransactions.length;
      
      if (filteredTransactions.length > 0) {
        yield filteredTransactions;
        logger.debug('Fetched transaction batch', { 
          count: filteredTransactions.length,
          totalFetched 
        });
      }
      
      // Update beforeSignature for next page
      if (transactions.length > 0) {
        beforeSignature = transactions[transactions.length - 1].signature;
      } else {
        hasMore = false;
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info('Completed transaction fetch', { 
      walletAddress, 
      totalFetched 
    });
  }
  
  /**
   * Get parsed transaction details
   */
  async getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    await this.rateLimit();
    
    try {
      const transaction = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      
      return transaction;
    } catch (error: any) {
      logger.error('Error fetching parsed transaction', {
        signature,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get token metadata using Helius DAS API
   */
  async getTokenMetadata(mintAddress: string): Promise<any> {
    await this.rateLimit();
    
    try {
      const response = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
        {
          jsonrpc: '2.0',
          id: 'token-metadata',
          method: 'getAsset',
          params: {
            id: mintAddress
          }
        },
        {
          timeout: 10000
        }
      );
      
      return response.data.result;
    } catch (error: any) {
      logger.error('Error fetching token metadata', {
        mintAddress,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Get SOL price in USD
   */
  async getSolPrice(): Promise<number> {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'solana',
          vs_currencies: 'usd'
        },
        timeout: 10000
      });
      
      return response.data.solana.usd;
    } catch (error: any) {
      logger.error('Error fetching SOL price', { error: error.message });
      return 0;
    }
  }
  
  /**
   * Batch get multiple token accounts
   */
  async getMultipleAccounts(addresses: string[]): Promise<any[]> {
    await this.rateLimit();
    
    try {
      const publicKeys = addresses.map(addr => new PublicKey(addr));
      const accounts = await this.connection.getMultipleAccountsInfo(publicKeys);
      return accounts;
    } catch (error: any) {
      logger.error('Error fetching multiple accounts', {
        count: addresses.length,
        error: error.message
      });
      return [];
    }
  }
}

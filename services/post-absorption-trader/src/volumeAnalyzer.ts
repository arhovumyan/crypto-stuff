import logger from './logger';
import { Transaction } from './types';

/**
 * VolumeAnalyzer analyzes real transaction volume for tokens
 * Fetches recent transactions and calculates buy vs sell volume
 */
export class VolumeAnalyzer {
  
  // Cache recent transactions by token
  private recentTransactions: Map<string, Transaction[]> = new Map();
  
  constructor() {
    // Connection not needed - we use cached transaction data from WalletListener
  }

  /**
   * Add a transaction to the cache
   */
  addTransaction(tx: Transaction): void {
    const token = tx.token;
    
    if (!this.recentTransactions.has(token)) {
      this.recentTransactions.set(token, []);
    }
    
    const txs = this.recentTransactions.get(token)!;
    txs.push(tx);
    
    // Keep only last hour of transactions
    const oneHourAgo = Date.now() / 1000 - 3600;
    const filtered = txs.filter(t => t.blockTime >= oneHourAgo);
    this.recentTransactions.set(token, filtered);
  }

  /**
   * Analyze recent buy vs sell volume for a token
   * Returns volume in USD
   */
  analyzeRecentVolume(
    token: string,
    timeWindowSeconds: number = 300 // Last 5 minutes by default
  ): { buyVolume: number; sellVolume: number; buyCount: number; sellCount: number } {
    const transactions = this.recentTransactions.get(token) || [];
    const cutoffTime = Date.now() / 1000 - timeWindowSeconds;
    
    const recentTxs = transactions.filter(tx => tx.blockTime >= cutoffTime);
    
    let buyVolume = 0;
    let sellVolume = 0;
    let buyCount = 0;
    let sellCount = 0;
    
    for (const tx of recentTxs) {
      if (tx.type === 'buy') {
        buyVolume += tx.amountUsd;
        buyCount++;
      } else {
        sellVolume += tx.amountUsd;
        sellCount++;
      }
    }
    
    logger.debug(
      `[VolumeAnalyzer] ${token.slice(0, 8)} (${timeWindowSeconds}s): ` +
      `Buy: $${buyVolume.toFixed(0)} (${buyCount} txs), ` +
      `Sell: $${sellVolume.toFixed(0)} (${sellCount} txs)`
    );
    
    return { buyVolume, sellVolume, buyCount, sellCount };
  }

  /**
   * Get all recent transactions for a token
   */
  getRecentTransactions(
    token: string,
    timeWindowSeconds?: number
  ): Transaction[] {
    const transactions = this.recentTransactions.get(token) || [];
    
    if (!timeWindowSeconds) {
      return transactions;
    }
    
    const cutoffTime = Date.now() / 1000 - timeWindowSeconds;
    return transactions.filter(tx => tx.blockTime >= cutoffTime);
  }

  /**
   * Fetch historical transactions from chain for a token
   * This is more expensive but gives complete data
   */
  async fetchHistoricalVolume(
    token: string,
    timeWindowSeconds: number = 300
  ): Promise<{ buyVolume: number; sellVolume: number; buyCount: number; sellCount: number }> {
    try {
      logger.debug(`[VolumeAnalyzer] Fetching historical volume for ${token.slice(0, 8)}...`);
      
      // This would require parsing all transactions involving the token
      // For now, fall back to cached data
      return this.analyzeRecentVolume(token, timeWindowSeconds);
    } catch (error) {
      logger.error(`[VolumeAnalyzer] Error fetching historical volume:`, error);
      return { buyVolume: 0, sellVolume: 0, buyCount: 0, sellCount: 0 };
    }
  }

  /**
   * Calculate volume ratio (buy/sell)
   */
  getVolumeRatio(token: string, timeWindowSeconds: number = 300): number {
    const { buyVolume, sellVolume } = this.analyzeRecentVolume(token, timeWindowSeconds);
    
    if (sellVolume === 0) {
      return buyVolume > 0 ? 10 : 1; // If only buys, ratio is very high
    }
    
    return buyVolume / sellVolume;
  }

  /**
   * Check if buying pressure dominates
   */
  isBuyingPressure(token: string, timeWindowSeconds: number = 300): boolean {
    const ratio = this.getVolumeRatio(token, timeWindowSeconds);
    return ratio >= 1.0; // More buying than selling
  }

  /**
   * Get transaction statistics
   */
  getStats(token: string): {
    totalTransactions: number;
    totalBuyVolume: number;
    totalSellVolume: number;
    averageBuySize: number;
    averageSellSize: number;
  } {
    const transactions = this.recentTransactions.get(token) || [];
    
    const buys = transactions.filter(tx => tx.type === 'buy');
    const sells = transactions.filter(tx => tx.type === 'sell');
    
    const totalBuyVolume = buys.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const totalSellVolume = sells.reduce((sum, tx) => sum + tx.amountUsd, 0);
    
    return {
      totalTransactions: transactions.length,
      totalBuyVolume,
      totalSellVolume,
      averageBuySize: buys.length > 0 ? totalBuyVolume / buys.length : 0,
      averageSellSize: sells.length > 0 ? totalSellVolume / sells.length : 0,
    };
  }

  /**
   * Cleanup old data periodically
   */
  cleanup(): void {
    const oneHourAgo = Date.now() / 1000 - 3600;
    
    for (const [token, txs] of this.recentTransactions) {
      const filtered = txs.filter(tx => tx.blockTime >= oneHourAgo);
      
      if (filtered.length === 0) {
        this.recentTransactions.delete(token);
      } else {
        this.recentTransactions.set(token, filtered);
      }
    }
  }
}

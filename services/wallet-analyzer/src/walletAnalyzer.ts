import { Database, WalletTransaction, MatchedTrade, TokenSnapshot } from './database';
import { HeliusService } from './heliusService';
import { DexScreenerService, TokenInfo } from './dexScreenerService';
import { TransactionParser } from './transactionParser';
import { logger } from './logger';
import { format } from 'date-fns';

export interface AnalysisProgress {
  stage: string;
  progress: number;
  total: number;
  message: string;
}

export class WalletAnalyzer {
  private db: Database;
  private helius: HeliusService;
  private dexScreener: DexScreenerService;
  private parser: TransactionParser;
  
  constructor(
    database: Database,
    helius: HeliusService,
    dexScreener: DexScreenerService
  ) {
    this.db = database;
    this.helius = helius;
    this.dexScreener = dexScreener;
    this.parser = new TransactionParser();
    
    logger.info('WalletAnalyzer initialized');
  }
  
  /**
   * Main analysis function - orchestrates the entire process
   */
  async analyzeWallet(
    walletAddress: string,
    options: {
      label?: string;
      startDate?: Date;
      onProgress?: (progress: AnalysisProgress) => void;
    } = {}
  ): Promise<void> {
    logger.info('Starting wallet analysis', { walletAddress });
    
    const onProgress = options.onProgress || (() => {});
    
    try {
      // Step 1: Add wallet to tracking
      onProgress({ stage: 'setup', progress: 0, total: 6, message: 'Adding wallet to database' });
      const wallet = await this.db.addTrackedWallet(walletAddress, options.label);
      logger.info('Wallet tracked', { walletId: wallet.id, address: walletAddress });
      
      // Step 2: Fetch transaction history
      onProgress({ stage: 'fetch', progress: 1, total: 6, message: 'Fetching transaction history' });
      const transactions = await this.fetchTransactions(walletAddress, wallet.id, options.startDate);
      logger.info('Transactions fetched', { count: transactions.length });
      
      // Step 3: Enrich with token data
      onProgress({ stage: 'enrich', progress: 2, total: 6, message: 'Enriching with market data' });
      await this.enrichTransactions(transactions);
      logger.info('Transactions enriched');
      
      // Step 4: Store in database
      onProgress({ stage: 'store', progress: 3, total: 6, message: 'Storing transactions' });
      await this.db.bulkInsertTransactions(transactions);
      logger.info('Transactions stored');
      
      // Step 5: Match buy/sell pairs
      onProgress({ stage: 'match', progress: 4, total: 6, message: 'Matching trades' });
      await this.matchTrades(wallet.id);
      logger.info('Trades matched');
      
      // Step 6: Update last analyzed timestamp
      onProgress({ stage: 'finalize', progress: 5, total: 6, message: 'Finalizing analysis' });
      await this.db.updateLastAnalyzed(wallet.id);
      
      onProgress({ stage: 'complete', progress: 6, total: 6, message: 'Analysis complete!' });
      logger.info('Wallet analysis completed', { walletAddress });
      
    } catch (error: any) {
      logger.error('Error during wallet analysis', {
        walletAddress,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Fetch and parse all transactions for a wallet
   */
  private async fetchTransactions(
    walletAddress: string,
    walletId: number,
    startDate?: Date
  ): Promise<WalletTransaction[]> {
    const allTransactions: WalletTransaction[] = [];
    
    let batchCount = 0;
    for await (const batch of this.helius.fetchAllTransactions(walletAddress, startDate)) {
      batchCount++;
      
      // Parse each transaction
      const parsed = this.parser.parseTransactions(batch, walletAddress, walletId);
      allTransactions.push(...parsed);
      
      logger.info('Processed transaction batch', {
        batch: batchCount,
        transactions: parsed.length,
        total: allTransactions.length
      });
      
      // Save periodically to avoid memory issues
      if (allTransactions.length >= 500) {
        await this.db.bulkInsertTransactions(allTransactions);
        allTransactions.length = 0; // Clear array
      }
    }
    
    return allTransactions;
  }
  
  /**
   * Enrich transactions with token metadata and market data
   */
  private async enrichTransactions(transactions: WalletTransaction[]): Promise<void> {
    // Get unique token mints
    const uniqueMints = [...new Set(transactions.map(tx => tx.tokenMint))];
    logger.info('Enriching unique tokens', { count: uniqueMints.length });
    
    // Fetch token data for all unique mints
    const tokenDataMap = await this.dexScreener.getMultipleTokens(uniqueMints);
    
    // Get SOL price
    const solPrice = await this.helius.getSolPrice();
    logger.info('Current SOL price', { price: solPrice });
    
    // Enrich each transaction
    for (const tx of transactions) {
      const tokenData = tokenDataMap.get(tx.tokenMint);
      
      if (tokenData) {
        tx.tokenSymbol = tokenData.symbol;
        tx.tokenName = tokenData.name;
        tx.tokenDecimals = tokenData.decimals;
        
        // Use current price as approximation (ideally we'd get historical price)
        tx.pricePerTokenUsd = tx.pricePerTokenSol * solPrice;
        
        // Store token snapshot
        await this.storeTokenSnapshot(tokenData, tx.blockTime);
      }
    }
    
    logger.info('Enrichment complete', {
      total: transactions.length,
      enriched: transactions.filter(tx => tx.tokenSymbol).length
    });
  }
  
  /**
   * Store token snapshot for historical reference
   */
  private async storeTokenSnapshot(tokenData: TokenInfo, timestamp: Date): Promise<void> {
    const snapshot: TokenSnapshot = {
      tokenMint: tokenData.mint,
      timestamp,
      symbol: tokenData.symbol,
      name: tokenData.name,
      decimals: tokenData.decimals,
      priceUsd: tokenData.priceUsd,
      priceSol: tokenData.priceSol,
      marketCapUsd: tokenData.marketCapUsd,
      fdvUsd: tokenData.fdvUsd,
      liquidityUsd: tokenData.liquidityUsd,
      volume24hUsd: tokenData.volume24hUsd,
      volumeChange24h: tokenData.volumeChange24h,
      priceChange24h: tokenData.priceChange24h,
      priceChange1h: tokenData.priceChange1h,
      holderCount: tokenData.holderCount,
      poolAddress: tokenData.poolAddress,
      dexName: tokenData.dexName,
      tokenAgeSeconds: tokenData.tokenAgeSeconds
    };
    
    try {
      await this.db.insertTokenSnapshot(snapshot);
    } catch (error: any) {
      // Ignore duplicate errors
      if (!error.message.includes('duplicate')) {
        logger.error('Error storing token snapshot', {
          mint: tokenData.mint,
          error: error.message
        });
      }
    }
  }
  
  /**
   * Match buy and sell transactions to create complete trades
   */
  async matchTrades(walletId: number): Promise<void> {
    logger.info('Matching trades for wallet', { walletId });
    
    // Get all transactions for this wallet
    const transactions = await this.db.getTransactionsByWallet(walletId, 10000);
    
    // Group by token
    const byToken = new Map<string, WalletTransaction[]>();
    
    for (const tx of transactions) {
      if (!byToken.has(tx.tokenMint)) {
        byToken.set(tx.tokenMint, []);
      }
      byToken.get(tx.tokenMint)!.push(tx);
    }
    
    let matchedCount = 0;
    
    // For each token, match buys with sells (FIFO)
    for (const [tokenMint, txs] of byToken.entries()) {
      const sorted = txs.sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
      
      const buys: WalletTransaction[] = [];
      const sells: WalletTransaction[] = [];
      
      for (const tx of sorted) {
        if (tx.transactionType === 'BUY') {
          buys.push(tx);
        } else if (tx.transactionType === 'SELL') {
          sells.push(tx);
        }
      }
      
      // Match using FIFO (First In, First Out)
      let buyIdx = 0;
      let sellIdx = 0;
      
      while (buyIdx < buys.length && sellIdx < sells.length) {
        const buy = buys[buyIdx];
        const sell = sells[sellIdx];
        
        // Create matched trade
        const trade = await this.createMatchedTrade(buy, sell);
        
        if (trade) {
          await this.db.insertMatchedTrade(trade);
          matchedCount++;
        }
        
        buyIdx++;
        sellIdx++;
      }
      
      // Handle unmatched buys (still open positions)
      while (buyIdx < buys.length) {
        const buy = buys[buyIdx];
        const openTrade = await this.createMatchedTrade(buy, null);
        
        if (openTrade) {
          await this.db.insertMatchedTrade(openTrade);
        }
        
        buyIdx++;
      }
    }
    
    logger.info('Trade matching complete', { matched: matchedCount });
  }
  
  /**
   * Create a matched trade from buy and sell transactions
   */
  private async createMatchedTrade(
    buy: WalletTransaction,
    sell: WalletTransaction | null
  ): Promise<MatchedTrade | null> {
    if (!buy.id) return null;
    
    const entrySnapshot = await this.db.getTokenSnapshotNear(buy.tokenMint, buy.blockTime);
    
    const trade: MatchedTrade = {
      walletId: buy.walletId,
      buyTransactionId: buy.id,
      sellTransactionId: sell?.id,
      tokenMint: buy.tokenMint,
      entryTime: buy.blockTime,
      entryPriceSol: buy.pricePerTokenSol,
      entryPriceUsd: buy.pricePerTokenUsd,
      entryAmountSol: buy.solAmount,
      entryMcapUsd: entrySnapshot?.marketCapUsd,
      entryLiquidityUsd: entrySnapshot?.liquidityUsd,
      entryVolume24hUsd: entrySnapshot?.volume24hUsd,
      entryDayOfWeek: format(buy.blockTime, 'EEEE'),
      entryHourOfDay: buy.blockTime.getHours()
    };
    
    // If there's a sell, calculate profits
    if (sell && sell.id) {
      const exitSnapshot = await this.db.getTokenSnapshotNear(sell.tokenMint, sell.blockTime);
      
      trade.exitTime = sell.blockTime;
      trade.exitPriceSol = sell.pricePerTokenSol;
      trade.exitPriceUsd = sell.pricePerTokenUsd;
      trade.exitAmountSol = sell.solAmount;
      trade.exitMcapUsd = exitSnapshot?.marketCapUsd;
      
      const holdTimeSeconds = Math.floor(
        (sell.blockTime.getTime() - buy.blockTime.getTime()) / 1000
      );
      trade.holdTimeSeconds = holdTimeSeconds;
      
      // Calculate P&L
      const profitLossSol = sell.solAmount - buy.solAmount;
      trade.profitLossSol = profitLossSol;
      trade.profitLossUsd = profitLossSol * (sell.pricePerTokenUsd / sell.pricePerTokenSol);
      
      const returnPercentage = ((sell.solAmount - buy.solAmount) / buy.solAmount) * 100;
      trade.returnPercentage = returnPercentage;
      
      // Account for fees
      const feesSol = (buy.feeLamports + sell.feeLamports) / 1e9;
      trade.feesPaidSol = feesSol;
      trade.netProfitSol = profitLossSol - feesSol;
      trade.netReturnPercentage = ((trade.netProfitSol) / buy.solAmount) * 100;
      
      trade.isWinner = trade.netProfitSol > 0;
      
      // Classify trade category
      if (holdTimeSeconds < 300) trade.tradeCategory = 'scalp'; // < 5 minutes
      else if (holdTimeSeconds < 86400) trade.tradeCategory = 'day-trade'; // < 24 hours
      else if (holdTimeSeconds < 604800) trade.tradeCategory = 'swing'; // < 7 days
      else trade.tradeCategory = 'position'; // > 7 days
    }
    
    return trade;
  }
  
  /**
   * Batch analyze multiple wallets
   */
  async analyzeMultipleWallets(
    walletAddresses: string[],
    options: {
      startDate?: Date;
      onProgress?: (wallet: string, progress: AnalysisProgress) => void;
    } = {}
  ): Promise<void> {
    logger.info('Starting batch wallet analysis', { count: walletAddresses.length });
    
    for (let i = 0; i < walletAddresses.length; i++) {
      const address = walletAddresses[i];
      
      logger.info(`Analyzing wallet ${i + 1}/${walletAddresses.length}`, { address });
      
      try {
        await this.analyzeWallet(address, {
          label: `Bot Wallet ${i + 1}`,
          startDate: options.startDate,
          onProgress: (progress) => {
            if (options.onProgress) {
              options.onProgress(address, progress);
            }
          }
        });
        
        logger.info(`Completed wallet ${i + 1}/${walletAddresses.length}`, { address });
        
        // Small delay between wallets to avoid overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error: any) {
        logger.error(`Failed to analyze wallet ${i + 1}/${walletAddresses.length}`, {
          address,
          error: error.message
        });
        // Continue with next wallet
      }
    }
    
    logger.info('Batch wallet analysis complete');
  }
}

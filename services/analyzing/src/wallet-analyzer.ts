/**
 * Wallet Analyzer Service
 * Scans wallet transactions and calculates profit/loss per token
 */

import axios from 'axios';
import { Connection, LAMPORTS_PER_SOL, PublicKey, ConfirmedSignatureInfo } from '@solana/web3.js';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export interface TokenTrade {
  signature: string;
  timestamp: number;
  type: 'buy' | 'sell';
  tokenMint: string;
  tokenSymbol: string;
  tokenAmount: number;
  solAmount: number;
  pricePerToken: number;
}

export interface TokenSummary {
  tokenMint: string;
  tokenSymbol: string;
  totalBuys: number;
  totalSells: number;
  totalSolSpent: number;
  totalSolReceived: number;
  totalTokensBought: number;
  totalTokensSold: number;
  remainingTokens: number;
  netProfitLoss: number;
  profitLossPercent: number;
  isProfitable: boolean;
  avgBuyPrice: number;
  avgSellPrice: number;
  trades: TokenTrade[];
}

export interface WalletAnalysis {
  walletAddress: string;
  periodStart: Date;
  periodEnd: Date;
  totalSolSpent: number;
  totalSolReceived: number;
  netProfitLoss: number;
  overallProfitPercent: number;
  tokenSummaries: TokenSummary[];
  totalTrades: number;
  profitableTokens: number;
  unprofitableTokens: number;
}

export class WalletAnalyzer {
  private connection: Connection;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get all signatures for an address within a time range
   */
  private async getAllSignatures(
    address: PublicKey,
    startTime: number,
    endTime: number
  ): Promise<ConfirmedSignatureInfo[]> {
    const allSignatures: ConfirmedSignatureInfo[] = [];
    let before: string | undefined = undefined;

    console.log(`Fetching signatures for ${address.toBase58()}...`);

    while (true) {
      const options: any = { limit: 1000 };
      if (before) {
        options.before = before;
      }

      const signatures = await this.connection.getSignaturesForAddress(address, options);
      
      if (signatures.length === 0) break;

      for (const sig of signatures) {
        const sigTime = sig.blockTime || 0;
        if (sigTime < startTime) {
          // We've gone too far back
          return allSignatures;
        }
        if (sigTime >= startTime && sigTime <= endTime) {
          allSignatures.push(sig);
        }
      }

      // Get the last signature for pagination
      const lastSig = signatures[signatures.length - 1];
      if (lastSig.blockTime && lastSig.blockTime < startTime) {
        break;
      }

      before = lastSig.signature;
      process.stdout.write(`\rFetched ${allSignatures.length} signatures...`);
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\nTotal signatures found: ${allSignatures.length}`);
    return allSignatures;
  }

  /**
   * Parse transaction to extract swap information
   */
  private parseSwapTransaction(tx: any, walletAddress: string): {
    tokenMint: string;
    tokenSymbol: string;
    type: 'buy' | 'sell';
    tokenAmount: number;
    solAmount: number;
  } | null {
    if (!tx || !tx.meta || tx.meta.err) return null;

    try {
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];
      const preSOL = tx.meta.preBalances[0] || 0;
      const postSOL = tx.meta.postBalances[0] || 0;
      const solChange = (preSOL - postSOL) / LAMPORTS_PER_SOL;

      // BUY: SOL decreased, token increased
      if (solChange > 0.0001) {  // Spent SOL
        for (const postBalance of postBalances) {
          const preBalance = preBalances.find(
            (pre: any) => pre.accountIndex === postBalance.accountIndex
          );

          const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0;
          const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');

          if (postAmount > preAmount && postAmount > 0) {
            return {
              type: 'buy',
              tokenMint: postBalance.mint,
              tokenSymbol: postBalance.uiTokenAmount.symbol || postBalance.mint.slice(0, 8),
              tokenAmount: postAmount - preAmount,
              solAmount: solChange,
            };
          }
        }
      }

      // SELL: SOL increased, token decreased
      if (solChange < -0.0001) {  // Received SOL
        for (const preBalance of preBalances) {
          const postBalance = postBalances.find(
            (post: any) => post.accountIndex === preBalance.accountIndex
          );

          const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
          const postAmount = postBalance ? parseFloat(postBalance.uiTokenAmount.uiAmountString || '0') : 0;

          if (preAmount > postAmount && preAmount > 0) {
            return {
              type: 'sell',
              tokenMint: preBalance.mint,
              tokenSymbol: preBalance.uiTokenAmount.symbol || preBalance.mint.slice(0, 8),
              tokenAmount: preAmount - postAmount,
              solAmount: Math.abs(solChange),
            };
          }
        }
      }

      return null;
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Analyze a wallet's trading activity
   */
  async analyzeWallet(
    walletAddress: string,
    daysBack: number = 30
  ): Promise<WalletAnalysis> {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (daysBack * 24 * 60 * 60);

    console.log(`\n📊 Analyzing wallet: ${walletAddress}`);
    console.log(`📅 Period: Last ${daysBack} days`);
    console.log(`⏰ From: ${new Date(startTime * 1000).toLocaleDateString()} to ${new Date(endTime * 1000).toLocaleDateString()}\n`);

    const publicKey = new PublicKey(walletAddress);

    // Get all signatures in the time range
    const signatures = await this.getAllSignatures(publicKey, startTime, endTime);

    // Parse transactions to find swaps
    console.log(`\nParsing ${signatures.length} transactions for swaps...`);
    const tokenTradesMap = new Map<string, TokenTrade[]>();
    let swapCount = 0;
    let processedCount = 0;

    // Process in smaller batches to respect rate limits
    const batchSize = 10; // Reduced from 50 to avoid rate limits
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      
      // Process sequentially instead of parallel to be more gentle on RPC
      for (const sig of batch) {
        try {
          const tx = await this.connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (tx) {
            const swap = this.parseSwapTransaction(tx, walletAddress);
            if (swap) {
              swapCount++;
              
              if (!tokenTradesMap.has(swap.tokenMint)) {
                tokenTradesMap.set(swap.tokenMint, []);
              }

              tokenTradesMap.get(swap.tokenMint)!.push({
                signature: sig.signature,
                timestamp: sig.blockTime || 0,
                type: swap.type,
                tokenMint: swap.tokenMint,
                tokenSymbol: swap.tokenSymbol,
                tokenAmount: swap.tokenAmount,
                solAmount: swap.solAmount,
                pricePerToken: swap.solAmount / swap.tokenAmount,
              });
            }
          }

          processedCount++;
          if (processedCount % 50 === 0) {
            process.stdout.write(`\rProcessed ${processedCount}/${signatures.length} transactions, found ${swapCount} swaps...`);
          }

          // Small delay between each transaction to respect rate limits
          await new Promise(r => setTimeout(r, 150));
        } catch (error: any) {
          // Skip failed transactions
          processedCount++;
        }
      }
    }

    console.log(`\n✅ Found ${swapCount} swaps across ${tokenTradesMap.size} tokens\n`);

    // Calculate summaries per token
    const tokenSummaries: TokenSummary[] = [];
    let totalSolSpent = 0;
    let totalSolReceived = 0;

    for (const [tokenMint, trades] of tokenTradesMap) {
      const buys = trades.filter(t => t.type === 'buy');
      const sells = trades.filter(t => t.type === 'sell');

      const solSpent = buys.reduce((sum, t) => sum + t.solAmount, 0);
      const solReceived = sells.reduce((sum, t) => sum + t.solAmount, 0);
      const tokensBought = buys.reduce((sum, t) => sum + t.tokenAmount, 0);
      const tokensSold = sells.reduce((sum, t) => sum + t.tokenAmount, 0);

      const netProfitLoss = solReceived - solSpent;
      const profitLossPercent = solSpent > 0 ? ((solReceived - solSpent) / solSpent) * 100 : 0;

      const avgBuyPrice = tokensBought > 0 ? solSpent / tokensBought : 0;
      const avgSellPrice = tokensSold > 0 ? solReceived / tokensSold : 0;

      totalSolSpent += solSpent;
      totalSolReceived += solReceived;

      // Use the most common symbol from trades
      const symbolCounts = new Map<string, number>();
      for (const trade of trades) {
        const count = symbolCounts.get(trade.tokenSymbol) || 0;
        symbolCounts.set(trade.tokenSymbol, count + 1);
      }
      let mostCommonSymbol = trades[0].tokenSymbol;
      let maxCount = 0;
      for (const [symbol, count] of symbolCounts) {
        if (count > maxCount) {
          maxCount = count;
          mostCommonSymbol = symbol;
        }
      }

      tokenSummaries.push({
        tokenMint,
        tokenSymbol: mostCommonSymbol,
        totalBuys: buys.length,
        totalSells: sells.length,
        totalSolSpent: solSpent,
        totalSolReceived: solReceived,
        totalTokensBought: tokensBought,
        totalTokensSold: tokensSold,
        remainingTokens: tokensBought - tokensSold,
        netProfitLoss,
        profitLossPercent,
        isProfitable: netProfitLoss > 0,
        avgBuyPrice,
        avgSellPrice,
        trades: trades.sort((a, b) => a.timestamp - b.timestamp),
      });
    }

    // Sort by absolute profit/loss (biggest movers first)
    tokenSummaries.sort((a, b) => Math.abs(b.netProfitLoss) - Math.abs(a.netProfitLoss));

    const netProfitLoss = totalSolReceived - totalSolSpent;
    const overallProfitPercent = totalSolSpent > 0 ? ((totalSolReceived - totalSolSpent) / totalSolSpent) * 100 : 0;

    return {
      walletAddress,
      periodStart: new Date(startTime * 1000),
      periodEnd: new Date(endTime * 1000),
      totalSolSpent,
      totalSolReceived,
      netProfitLoss,
      overallProfitPercent,
      tokenSummaries,
      totalTrades: swapCount,
      profitableTokens: tokenSummaries.filter(t => t.isProfitable).length,
      unprofitableTokens: tokenSummaries.filter(t => !t.isProfitable && t.totalSells > 0).length,
    };
  }
}


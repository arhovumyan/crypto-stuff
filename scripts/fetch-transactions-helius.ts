import { Connection, PublicKey, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface FormattedTransaction {
  time: string;
  value: string;
  amountFrom: string;
  tokenFrom: string;
  amountTo: string;
  tokenTo: string;
  txHash: string;
  status: string;
}

class HeliusTransactionFetcher {
  private connection: Connection;
  private rpcUrl: string;
  
  constructor() {
    this.rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL || '';
    if (!this.rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in environment variables');
    }
    this.connection = new Connection(this.rpcUrl, 'confirmed');
    console.log(`Using RPC: ${this.rpcUrl.substring(0, 50)}...`);
  }

  async fetchTransactions(walletAddress: string, limit: number = 10000): Promise<ParsedTransactionWithMeta[]> {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);
    console.log(`Target: ${limit} transactions`);
    
    const allTransactions: ParsedTransactionWithMeta[] = [];
    const pubkey = new PublicKey(walletAddress);
    let beforeSignature: string | undefined;
    const batchSize = 50; // Reduced batch size for better rate limiting
    let retryDelay = 200; // Start with 200ms, will increase if needed
    
    try {
      while (allTransactions.length < limit) {
        console.log(`Fetching batch ${Math.floor(allTransactions.length / batchSize) + 1}... (${allTransactions.length}/${limit} transactions)`);
        
        const signatures = await this.connection.getSignaturesForAddress(
          pubkey,
          {
            limit: Math.min(batchSize, limit - allTransactions.length),
            before: beforeSignature,
          }
        );
        
        if (signatures.length === 0) {
          console.log('No more transactions available');
          break;
        }
        
        // Fetch transaction details one by one with adaptive rate limiting
        console.log(`  Fetching details for ${signatures.length} transactions...`);
        let rateLimitCount = 0;
        
        for (const sig of signatures) {
          let attempts = 0;
          const maxAttempts = 3;
          let success = false;
          
          while (attempts < maxAttempts && !success) {
            try {
              const tx = await this.connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
              });
              if (tx) {
                allTransactions.push(tx);
              }
              success = true;
              
              // Adaptive delay - increase if we've been rate limited recently
              const delay = retryDelay + (rateLimitCount * 100);
              await new Promise(resolve => setTimeout(resolve, delay));
              
              // Decrease rate limit counter if successful
              if (rateLimitCount > 0) {
                rateLimitCount = Math.max(0, rateLimitCount - 1);
              }
              
            } catch (error: any) {
              attempts++;
              if (error.message && error.message.includes('429')) {
                rateLimitCount += 2; // Increase counter more aggressively
                retryDelay = Math.min(retryDelay + 50, 500); // Cap at 500ms base
                const waitTime = 2000 + (rateLimitCount * 500);
                console.log(`Rate limited, waiting ${waitTime}ms... (attempt ${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
              } else if (error.message && error.message.includes('500')) {
                // Server error, skip silently
                break;
              } else {
                console.error(`Error fetching ${sig.signature}:`, error.message);
                break;
              }
            }
          }
        }
        
        // Update beforeSignature for pagination
        beforeSignature = signatures[signatures.length - 1].signature;
        
        console.log(`  Progress: ${allTransactions.length}/${limit} transactions fetched`);
        
        // Additional delay between batches - increases with rate limiting
        const batchDelay = 1000 + (rateLimitCount * 500);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
      
      console.log(`Successfully fetched ${allTransactions.length} transactions`);
      return allTransactions;
      
    } catch (error: any) {
      console.error('Error fetching transactions:', error.message);
      throw error;
    }
  }

  formatTimestamp(blockTime: number | null | undefined): string {
    if (!blockTime) return 'N/A';
    const date = new Date(blockTime * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 60) {
      return `${diffMins}m`;
    } else if (diffHours < 24) {
      return `${diffHours}h`;
    } else if (diffDays < 30) {
      return `${diffDays}d`;
    } else {
      return `${Math.floor(diffDays / 30)}mo`;
    }
  }

  formatValue(lamports: number | bigint): string {
    const sol = Number(lamports) / 1e9;
    return `$${sol.toFixed(4)}`;
  }

  formatAmount(amount: number | string, decimals: number = 9): string {
    const formatted = Number(amount) / Math.pow(10, decimals);
    if (formatted < 0.000001) {
      return formatted.toExponential(2);
    } else if (formatted < 1) {
      return formatted.toFixed(6);
    } else if (formatted < 1000) {
      return formatted.toFixed(4);
    } else if (formatted < 1000000) {
      return `${(formatted / 1000).toFixed(2)}K`;
    } else {
      return `${(formatted / 1000000).toFixed(2)}M`;
    }
  }

  parseTransaction(tx: ParsedTransactionWithMeta, signature: string): FormattedTransaction {
    const time = this.formatTimestamp(tx.blockTime);
    const fee = tx.meta?.fee || 0;
    const value = this.formatValue(fee);
    const status = tx.meta?.err ? 'Failed' : 'Success';
    
    let amountFrom = 'N/A';
    let tokenFrom = 'SOL';
    let amountTo = 'N/A';
    let tokenTo = 'Unknown';
    
    // Try to extract swap information from instructions
    try {
      const instructions = tx.transaction.message.instructions;
      
      // Track pre and post token balances for better swap detection
      const preTokenBalances = tx.meta?.preTokenBalances || [];
      const postTokenBalances = tx.meta?.postTokenBalances || [];
      
      // Find balance changes for tokens
      for (let i = 0; i < preTokenBalances.length; i++) {
        const preBalance = preTokenBalances[i];
        const postBalance = postTokenBalances.find(b => b.accountIndex === preBalance.accountIndex);
        
        if (postBalance && preBalance.uiTokenAmount && postBalance.uiTokenAmount) {
          const change = postBalance.uiTokenAmount.uiAmount! - preBalance.uiTokenAmount.uiAmount!;
          const mint = preBalance.mint;
          
          if (change < 0) {
            // Token sent/sold
            amountFrom = this.formatAmount(Math.abs(change) * Math.pow(10, preBalance.uiTokenAmount.decimals), preBalance.uiTokenAmount.decimals);
            tokenFrom = this.getTokenSymbol(mint);
          } else if (change > 0) {
            // Token received/bought
            amountTo = this.formatAmount(change * Math.pow(10, postBalance.uiTokenAmount.decimals), postBalance.uiTokenAmount.decimals);
            tokenTo = this.getTokenSymbol(mint);
          }
        }
      }
      
      // Check SOL balance changes
      if (tx.meta?.preBalances && tx.meta?.postBalances) {
        const balanceChange = (tx.meta.postBalances[0] - tx.meta.preBalances[0]) + fee;
        if (Math.abs(balanceChange) > 1000) { // More than 0.000001 SOL
          if (balanceChange < 0) {
            amountFrom = this.formatAmount(Math.abs(balanceChange), 9);
            tokenFrom = 'SOL';
          } else if (balanceChange > 0) {
            amountTo = this.formatAmount(balanceChange, 9);
            tokenTo = 'SOL';
          }
        }
      }
      
      // Parse instructions for additional context
      for (const instruction of instructions) {
        if ('parsed' in instruction && instruction.parsed) {
          const parsed = instruction.parsed;
          
          // Handle token transfers
          if (parsed.type === 'transfer' && parsed.info) {
            if (amountFrom === 'N/A') {
              amountFrom = this.formatAmount(parsed.info.lamports, 9);
              tokenFrom = 'SOL';
            }
          }
          
          // Handle SPL token transfers
          if (parsed.type === 'transferChecked' && parsed.info && parsed.info.tokenAmount) {
            if (tokenFrom === 'SOL' && parsed.info.mint) {
              tokenFrom = this.getTokenSymbol(parsed.info.mint);
            }
          }
        }
        
        // Check for Jupiter/Raydium program IDs
        if ('programId' in instruction) {
          const programId = instruction.programId.toString();
          // Jupiter: JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB
          // Raydium: 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
          if (programId === 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB' ||
              programId === '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') {
            // This is a swap transaction
            if (amountTo === 'N/A' && tokenTo === 'Unknown') {
              tokenTo = 'Token';
            }
          }
        }
      }
      
    } catch (error: any) {
      // Silent error - keep default values
    }
    
    return {
      time,
      value,
      amountFrom,
      tokenFrom,
      amountTo,
      tokenTo,
      txHash: signature,
      status,
    };
  }
  
  getTokenSymbol(mint: string): string {
    // Common token mints
    const knownTokens: { [key: string]: string } = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
      'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': 'PYTH',
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
      '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': 'POPCAT',
      'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82': 'BOME',
    };
    
    return knownTokens[mint] || mint.substring(0, 8);
  }

  async generateCSV(transactions: FormattedTransaction[], outputPath: string): Promise<void> {
    console.log(`Generating CSV file at: ${outputPath}`);
    
    // CSV header
    const header = 'Time,Value,Amount From,Token From,Amount To,Token To,Transaction Hash,Status\n';
    
    // CSV rows
    const rows = transactions.map(tx => {
      return `${tx.time},${tx.value},"${tx.amountFrom}",${tx.tokenFrom},"${tx.amountTo}",${tx.tokenTo},${tx.txHash},${tx.status}`;
    }).join('\n');
    
    const csvContent = header + rows;
    
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    console.log(`✅ CSV file created successfully with ${transactions.length} transactions`);
  }

  async run(walletAddress: string, limit: number = 10000): Promise<void> {
    try {
      console.log('='.repeat(80));
      console.log('Solana Transaction Fetcher (via Helius RPC)');
      console.log('='.repeat(80));
      
      // Fetch transactions
      const transactions = await this.fetchTransactions(walletAddress, limit);
      
      // Parse transactions
      console.log('Parsing transactions...');
      const formattedTransactions: FormattedTransaction[] = [];
      
      for (let i = 0; i < transactions.length; i++) {
        if (i % 100 === 0) {
          console.log(`Parsing transaction ${i + 1}/${transactions.length}...`);
        }
        const tx = transactions[i];
        const signature = tx.transaction.signatures[0];
        const formatted = this.parseTransaction(tx, signature);
        formattedTransactions.push(formatted);
      }
      
      // Generate CSV
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const shortAddress = walletAddress.substring(0, 8);
      const outputPath = path.join(__dirname, `transactions_${shortAddress}_${timestamp}.csv`);
      await this.generateCSV(formattedTransactions, outputPath);
      
      // Display summary
      const successCount = formattedTransactions.filter(tx => tx.status === 'Success').length;
      const failedCount = formattedTransactions.filter(tx => tx.status === 'Failed').length;
      
      console.log('='.repeat(80));
      console.log('✅ Process completed successfully!');
      console.log(`📄 CSV file: ${outputPath}`);
      console.log(`📊 Total transactions: ${formattedTransactions.length}`);
      console.log(`✅ Successful: ${successCount}`);
      console.log(`❌ Failed: ${failedCount}`);
      console.log('='.repeat(80));
      
    } catch (error: any) {
      console.error('❌ Error during execution:', error.message);
      throw error;
    }
  }
}

// Main execution
const walletAddress = process.argv[2] || 'ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT';
const limit = parseInt(process.argv[3] || '10000');

const fetcher = new HeliusTransactionFetcher();
fetcher.run(walletAddress, limit).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

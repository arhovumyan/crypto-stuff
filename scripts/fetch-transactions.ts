import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface SolscanTransaction {
  blockTime: number;
  slot: number;
  txHash: string;
  fee: number;
  status: string;
  lamport: number;
  signer: string[];
  parsedInstruction?: any[];
}

interface FormattedTransaction {
  time: string;
  value: string;
  amountFrom: string;
  tokenFrom: string;
  amountTo: string;
  tokenTo: string;
  txHash: string;
}

class SolscanTransactionFetcher {
  private apiKey: string;
  private baseUrl = 'https://api.solscan.io';
  
  constructor() {
    this.apiKey = process.env.SOLSCAN_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('SOLSCAN_API_KEY not found in environment variables');
    }
  }

  async fetchTransactions(walletAddress: string, limit: number = 10000): Promise<SolscanTransaction[]> {
    console.log(`Fetching transactions for wallet: ${walletAddress}`);
    console.log(`Target: ${limit} transactions`);
    
    const allTransactions: SolscanTransaction[] = [];
    let beforeHash: string | undefined;
    const batchSize = 50; // Solscan API typically limits to 50 per request
    
    try {
      while (allTransactions.length < limit) {
        const params: any = {
          address: walletAddress,
          limit: Math.min(batchSize, limit - allTransactions.length),
        };
        
        if (beforeHash) {
          params.before = beforeHash;
        }
        
        console.log(`Fetching batch ${Math.floor(allTransactions.length / batchSize) + 1}... (${allTransactions.length}/${limit} transactions)`);
        
        const response = await axios.get(`${this.baseUrl}/account/transactions`, {
          params,
          headers: {
            'token': this.apiKey,
            'Accept': 'application/json',
          },
        });
        
        const transactions = response.data || [];
        
        if (transactions.length === 0) {
          console.log('No more transactions available');
          break;
        }
        
        allTransactions.push(...transactions);
        
        // Get the last transaction hash for pagination
        beforeHash = transactions[transactions.length - 1]?.txHash;
        
        // Rate limiting - wait a bit between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log(`Successfully fetched ${allTransactions.length} transactions`);
      return allTransactions;
      
    } catch (error: any) {
      console.error('Error fetching transactions:', error.response?.data || error.message);
      throw error;
    }
  }

  async getTransactionDetails(txHash: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/transaction/${txHash}`, {
        headers: {
          'token': this.apiKey,
          'Accept': 'application/json',
        },
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error fetching transaction details for ${txHash}:`, error.response?.data || error.message);
      return null;
    }
  }

  formatTimestamp(blockTime: number): string {
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
    } else {
      return `${diffDays}d`;
    }
  }

  formatValue(lamports: number): string {
    const sol = Math.abs(lamports) / 1e9;
    return `$${sol.toFixed(2)}`;
  }

  formatAmount(amount: number, decimals: number = 9): string {
    const formatted = amount / Math.pow(10, decimals);
    if (formatted < 1) {
      return formatted.toFixed(6);
    } else if (formatted < 1000) {
      return formatted.toFixed(4);
    } else if (formatted < 1000000) {
      return `${(formatted / 1000).toFixed(2)}K`;
    } else {
      return `${(formatted / 1000000).toFixed(2)}M`;
    }
  }

  async parseTransaction(tx: SolscanTransaction): Promise<FormattedTransaction> {
    const time = this.formatTimestamp(tx.blockTime);
    const value = this.formatValue(tx.lamport);
    
    // For basic formatting without detailed parsing
    return {
      time,
      value,
      amountFrom: 'N/A',
      tokenFrom: 'SOL',
      amountTo: 'N/A',
      tokenTo: 'Unknown',
      txHash: tx.txHash,
    };
  }

  async generateCSV(transactions: FormattedTransaction[], outputPath: string): Promise<void> {
    console.log(`Generating CSV file at: ${outputPath}`);
    
    // CSV header
    const header = 'Time,Value,Amount From,Token From,Amount To,Token To,Transaction Hash\n';
    
    // CSV rows
    const rows = transactions.map(tx => {
      return `${tx.time},${tx.value},"${tx.amountFrom}",${tx.tokenFrom},"${tx.amountTo}",${tx.tokenTo},${tx.txHash}`;
    }).join('\n');
    
    const csvContent = header + rows;
    
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    console.log(`CSV file created successfully with ${transactions.length} transactions`);
  }

  async run(walletAddress: string, limit: number = 10000): Promise<void> {
    try {
      console.log('='.repeat(80));
      console.log('Solscan Transaction Fetcher');
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
        const formatted = await this.parseTransaction(transactions[i]);
        formattedTransactions.push(formatted);
      }
      
      // Generate CSV
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const outputPath = path.join(__dirname, `transactions_${walletAddress}_${timestamp}.csv`);
      await this.generateCSV(formattedTransactions, outputPath);
      
      console.log('='.repeat(80));
      console.log('✅ Process completed successfully!');
      console.log(`📄 CSV file: ${outputPath}`);
      console.log(`📊 Total transactions: ${formattedTransactions.length}`);
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

const fetcher = new SolscanTransactionFetcher();
fetcher.run(walletAddress, limit).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

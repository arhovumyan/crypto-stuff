import { Database } from './database';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

interface TransactionExport {
  wallet_address: string;
  transaction_signature: string;
  timestamp: string;
  transaction_type: string;
  token_in: string;
  token_in_symbol: string;
  token_in_amount: number;
  token_in_price_usd: number;
  token_out: string;
  token_out_symbol: string;
  token_out_amount: number;
  token_out_price_usd: number;
  dex_name: string;
  sol_amount: number;
  usd_value: number;
  fee_lamports: number;
  matched_trade_id?: number;
  entry_timestamp?: string;
  exit_timestamp?: string;
  hold_duration_hours?: number;
  profit_loss_sol?: number;
  profit_loss_usd?: number;
  profit_loss_percentage?: number;
}

async function exportAllTransactions() {
  console.log('🚀 Starting comprehensive transaction export...\n');
  
  const db = new Database(process.env.DATABASE_URL!);
  
  try {
    // Get all wallets
    const walletsResult = await db.query('SELECT id, address, label FROM tracked_wallets ORDER BY id');
    const wallets = walletsResult.rows;
    
    console.log(`📊 Found ${wallets.length} wallets to export\n`);
    
    const allTransactions: TransactionExport[] = [];
    
    for (const wallet of wallets) {
      console.log(`\n📈 Processing wallet: ${wallet.address.substring(0, 8)}...`);
      console.log(`   Label: ${wallet.label || 'N/A'}`);
      
      // Get all transactions for this wallet with detailed info
      const txQuery = `
        SELECT 
          wt.id,
          wt.signature,
          wt.block_time,
          wt.transaction_type,
          wt.token_mint,
          wt.token_symbol,
          wt.token_name,
          wt.token_amount,
          wt.sol_amount,
          wt.price_per_token_sol,
          wt.price_per_token_usd,
          wt.dex_program,
          wt.dex_name,
          wt.fee_lamports,
          wt.success
        FROM wallet_transactions wt
        WHERE wt.wallet_id = $1
        ORDER BY wt.block_time ASC
      `;
      
      const txResult = await db.query(txQuery, [wallet.id]);
      const transactions = txResult.rows;
      
      console.log(`   Transactions: ${transactions.length}`);
      
      // Group transactions by token to match buys with sells
      const tokenTransactions = new Map<string, any[]>();
      
      for (const tx of transactions) {
        if (!tokenTransactions.has(tx.token_mint)) {
          tokenTransactions.set(tx.token_mint, []);
        }
        tokenTransactions.get(tx.token_mint)!.push(tx);
      }
      
      console.log(`   Unique tokens: ${tokenTransactions.size}`);
      
      // Process each transaction and try to match buys with sells
      let matchedTrades = 0;
      let unmatchedTrades = 0;
      
      for (const tx of transactions) {
        const exportRecord: TransactionExport = {
          wallet_address: wallet.address,
          transaction_signature: tx.signature,
          timestamp: tx.block_time,
          transaction_type: tx.transaction_type,
          token_in: '',
          token_in_symbol: '',
          token_in_amount: 0,
          token_in_price_usd: 0,
          token_out: '',
          token_out_symbol: '',
          token_out_amount: 0,
          token_out_price_usd: 0,
          dex_name: tx.dex_name || 'Unknown',
          sol_amount: tx.sol_amount,
          usd_value: 0,
          fee_lamports: tx.fee_lamports
        };
        
        // Determine token flow based on transaction type
        if (tx.transaction_type === 'BUY') {
          // BUY: SOL -> Token
          exportRecord.token_in = 'So11111111111111111111111111111111111111112'; // SOL
          exportRecord.token_in_symbol = 'SOL';
          exportRecord.token_in_amount = tx.sol_amount;
          exportRecord.token_in_price_usd = tx.price_per_token_usd > 0 && tx.token_amount > 0 
            ? (tx.sol_amount * tx.price_per_token_usd * tx.token_amount) / tx.token_amount 
            : 0;
          
          exportRecord.token_out = tx.token_mint;
          exportRecord.token_out_symbol = tx.token_symbol || 'UNKNOWN';
          exportRecord.token_out_amount = tx.token_amount;
          exportRecord.token_out_price_usd = tx.price_per_token_usd;
          
          exportRecord.usd_value = tx.sol_amount * (tx.price_per_token_usd || 0);
          
        } else if (tx.transaction_type === 'SELL') {
          // SELL: Token -> SOL
          exportRecord.token_in = tx.token_mint;
          exportRecord.token_in_symbol = tx.token_symbol || 'UNKNOWN';
          exportRecord.token_in_amount = tx.token_amount;
          exportRecord.token_in_price_usd = tx.price_per_token_usd;
          
          exportRecord.token_out = 'So11111111111111111111111111111111111111112'; // SOL
          exportRecord.token_out_symbol = 'SOL';
          exportRecord.token_out_amount = tx.sol_amount;
          exportRecord.token_out_price_usd = 0;
          
          exportRecord.usd_value = tx.sol_amount * (tx.price_per_token_usd || 0);
        } else {
          // TRANSFER
          exportRecord.token_in = tx.token_mint;
          exportRecord.token_in_symbol = tx.token_symbol || 'UNKNOWN';
          exportRecord.token_in_amount = tx.token_amount;
          exportRecord.token_in_price_usd = tx.price_per_token_usd;
          
          exportRecord.token_out = tx.token_mint;
          exportRecord.token_out_symbol = tx.token_symbol || 'UNKNOWN';
          exportRecord.token_out_amount = tx.token_amount;
          exportRecord.token_out_price_usd = tx.price_per_token_usd;
        }
        
        // Try to match with a previous BUY if this is a SELL
        if (tx.transaction_type === 'SELL') {
          const tokenTxs = tokenTransactions.get(tx.token_mint) || [];
          
          // Find the most recent BUY before this SELL
          const matchingBuy = tokenTxs
            .filter(t => 
              t.transaction_type === 'BUY' && 
              new Date(t.block_time) < new Date(tx.block_time)
            )
            .sort((a, b) => new Date(b.block_time).getTime() - new Date(a.block_time).getTime())[0];
          
          if (matchingBuy) {
            const entryTime = new Date(matchingBuy.block_time);
            const exitTime = new Date(tx.block_time);
            const holdDurationMs = exitTime.getTime() - entryTime.getTime();
            const holdDurationHours = holdDurationMs / (1000 * 60 * 60);
            
            exportRecord.entry_timestamp = matchingBuy.block_time;
            exportRecord.exit_timestamp = tx.block_time;
            exportRecord.hold_duration_hours = Math.round(holdDurationHours * 100) / 100;
            
            // Calculate profit/loss
            const entryValue = matchingBuy.sol_amount;
            const exitValue = tx.sol_amount;
            exportRecord.profit_loss_sol = exitValue - entryValue;
            
            if (entryValue > 0) {
              exportRecord.profit_loss_percentage = ((exitValue - entryValue) / entryValue) * 100;
            }
            
            matchedTrades++;
          } else {
            unmatchedTrades++;
          }
        }
        
        allTransactions.push(exportRecord);
      }
      
      console.log(`   ✅ Matched trades: ${matchedTrades}`);
      console.log(`   ⚠️  Unmatched SELLs: ${unmatchedTrades}`);
    }
    
    console.log(`\n📊 Total transactions to export: ${allTransactions.length}`);
    
    // Create CSV content
    console.log('\n📝 Creating CSV file...');
    const headers = [
      'Wallet Address',
      'Transaction Signature',
      'Timestamp',
      'Transaction Type',
      'Token In (Mint)',
      'Token In (Symbol)',
      'Token In Amount',
      'Token In Price USD',
      'Token Out (Mint)',
      'Token Out (Symbol)',
      'Token Out Amount',
      'Token Out Price USD',
      'DEX Name',
      'SOL Amount',
      'USD Value',
      'Fee (Lamports)',
      'Entry Timestamp',
      'Exit Timestamp',
      'Hold Duration (Hours)',
      'Profit/Loss (SOL)',
      'Profit/Loss (USD)',
      'Profit/Loss (%)'
    ];
    
    let csvContent = headers.join(',') + '\n';
    
    for (const tx of allTransactions) {
      const row = [
        tx.wallet_address,
        tx.transaction_signature,
        tx.timestamp,
        tx.transaction_type,
        tx.token_in,
        `"${tx.token_in_symbol}"`,
        tx.token_in_amount,
        tx.token_in_price_usd,
        tx.token_out,
        `"${tx.token_out_symbol}"`,
        tx.token_out_amount,
        tx.token_out_price_usd,
        `"${tx.dex_name}"`,
        tx.sol_amount,
        tx.usd_value,
        tx.fee_lamports,
        tx.entry_timestamp || '',
        tx.exit_timestamp || '',
        tx.hold_duration_hours || '',
        tx.profit_loss_sol || '',
        tx.profit_loss_usd || '',
        tx.profit_loss_percentage || ''
      ];
      
      csvContent += row.join(',') + '\n';
    }
    
    // Save to file
    const exportDir = path.join(__dirname, '../exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `wallet-transactions-${timestamp}.csv`;
    const filepath = path.join(exportDir, filename);
    
    fs.writeFileSync(filepath, csvContent);
    
    console.log(`\n✅ Export complete!`);
    console.log(`📁 File saved: ${filepath}`);
    console.log(`📊 Total records: ${allTransactions.length}`);
    console.log(`💾 File size: ${(fs.statSync(filepath).size / 1024).toFixed(2)} KB`);
    
    // Print summary statistics
    console.log('\n📈 EXPORT SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const buyCount = allTransactions.filter(t => t.transaction_type === 'BUY').length;
    const sellCount = allTransactions.filter(t => t.transaction_type === 'SELL').length;
    const transferCount = allTransactions.filter(t => t.transaction_type === 'TRANSFER').length;
    const matchedCount = allTransactions.filter(t => t.hold_duration_hours !== undefined).length;
    
    console.log(`Total Transactions: ${allTransactions.length}`);
    console.log(`├─ BUY: ${buyCount}`);
    console.log(`├─ SELL: ${sellCount}`);
    console.log(`└─ TRANSFER: ${transferCount}`);
    console.log(``);
    console.log(`Matched Trades (with profit calc): ${matchedCount}`);
    console.log(``);
    console.log(`✅ All transactions exported successfully!`);
    console.log(`📂 Open with Excel: ${filename}`);
    
    await db.close();
    
  } catch (error: any) {
    console.error('❌ Export failed:', error.message);
    logger.error('Export failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

// Run the export
exportAllTransactions()
  .then(() => {
    console.log('\n🎉 Export completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Export failed:', error);
    process.exit(1);
  });

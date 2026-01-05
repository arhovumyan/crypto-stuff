import dotenv from 'dotenv';
import path from 'path';
import { Database } from './database';
import { HeliusService } from './heliusService';
import { DexScreenerService } from './dexScreenerService';
import { WalletAnalyzer } from './walletAnalyzer';
import { ReportGenerator } from './reportGenerator';
import { logger } from './logger';

// Load environment variables from root
dotenv.config({ path: path.join(__dirname, '../../../.env') });

export async function main() {
  logger.info('Starting Wallet Analyzer');
  
  // Validate environment variables
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not found in environment');
  }
  
  if (!process.env.HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY not found in environment');
  }
  
  if (!process.env.BOT_WALLETS) {
    throw new Error('BOT_WALLETS not found in environment');
  }
  
  // Initialize services
  const db = new Database(process.env.DATABASE_URL);
  const helius = new HeliusService(
    process.env.HELIUS_API_KEY,
    process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL!
  );
  const dexScreener = new DexScreenerService();
  const analyzer = new WalletAnalyzer(db, helius, dexScreener);
  const reportGen = new ReportGenerator(db);
  
  // Parse wallet addresses from .env
  const walletAddresses = process.env.BOT_WALLETS
    .split(',')
    .map(addr => addr.trim())
    .filter(Boolean);
  
  logger.info('Found wallets to analyze', { count: walletAddresses.length });
  
  try {
    // Analyze all wallets
    await analyzer.analyzeMultipleWallets(walletAddresses, {
      onProgress: (wallet, progress) => {
        logger.info('Progress', { 
          wallet: wallet.substring(0, 8),
          stage: progress.stage,
          message: progress.message 
        });
      }
    });
    
    logger.info('All wallets analyzed successfully');
    
    // Generate reports for all wallets
    logger.info('Generating reports...');
    
    const wallets = await db.getAllTrackedWallets();
    
    for (const wallet of wallets) {
      const outputPath = `./reports/${wallet.address.substring(0, 8)}_analysis.md`;
      await reportGen.generateWalletReport(wallet.id, outputPath);
      logger.info('Report generated', { wallet: wallet.address, path: outputPath });
    }
    
    logger.info('All reports generated successfully');
    
  } catch (error: any) {
    logger.error('Error in main execution', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  } finally {
    await db.close();
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      logger.info('Wallet Analyzer completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Fatal error', { error: error.message });
      process.exit(1);
    });
}

export * from './database';
export * from './heliusService';
export * from './dexScreenerService';
export * from './walletAnalyzer';
export * from './reportGenerator';
export * from './transactionParser';

import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import { Database } from './database';
import { HeliusService } from './heliusService';
import { DexScreenerService } from './dexScreenerService';
import { WalletAnalyzer, AnalysisProgress } from './walletAnalyzer';
import { ReportGenerator } from './reportGenerator';
import { logger } from './logger';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const program = new Command();

program
  .name('wallet-analyzer')
  .description('Comprehensive Solana wallet behavior analysis system')
  .version('1.0.0');

/**
 * Analyze command - fetch and analyze wallet transactions
 */
program
  .command('analyze')
  .description('Analyze one or more Solana wallet addresses')
  .option('-w, --wallet <address>', 'Single wallet address to analyze')
  .option('-m, --multiple', 'Analyze all BOT_WALLETS from .env')
  .option('-s, --start-date <date>', 'Start date for analysis (YYYY-MM-DD)')
  .option('-l, --label <label>', 'Label for the wallet')
  .action(async (options) => {
    const spinner = ora('Initializing...').start();
    
    try {
      // Initialize services
      const db = new Database(process.env.DATABASE_URL!);
      const helius = new HeliusService(
        process.env.HELIUS_API_KEY!,
        process.env.HELIUS_RPC_URL!
      );
      const dexScreener = new DexScreenerService();
      const analyzer = new WalletAnalyzer(db, helius, dexScreener);
      
      // Parse start date if provided
      const startDate = options.startDate ? new Date(options.startDate) : undefined;
      
      // Determine which wallets to analyze
      let wallets: string[] = [];
      
      if (options.multiple) {
        // Get from .env
        const botWallets = process.env.BOT_WALLETS;
        if (!botWallets) {
          spinner.fail(chalk.red('BOT_WALLETS not found in .env'));
          process.exit(1);
        }
        
        wallets = botWallets.split(',').map(w => w.trim()).filter(Boolean);
        spinner.info(chalk.blue(`Found ${wallets.length} wallets to analyze`));
      } else if (options.wallet) {
        wallets = [options.wallet];
      } else {
        spinner.fail(chalk.red('Please specify --wallet or --multiple'));
        process.exit(1);
      }
      
      spinner.succeed(chalk.green('Services initialized'));
      
      // Analyze wallets
      let currentSpinner: any = null;
      
      await analyzer.analyzeMultipleWallets(wallets, {
        startDate,
        onProgress: (wallet: string, progress: AnalysisProgress) => {
          if (currentSpinner) currentSpinner.stop();
          
          currentSpinner = ora({
            text: chalk.cyan(`[${wallet.substring(0, 8)}...] ${progress.message} (${progress.progress}/${progress.total})`),
            spinner: 'dots'
          }).start();
          
          if (progress.stage === 'complete') {
            currentSpinner.succeed(chalk.green(`✓ ${wallet.substring(0, 8)}... - Analysis complete`));
          }
        }
      });
      
      if (currentSpinner) currentSpinner.stop();
      
      console.log(chalk.green.bold('\n✓ All wallets analyzed successfully!'));
      console.log(chalk.blue('\nNext steps:'));
      console.log(chalk.white('  1. Generate reports: npm run report'));
      console.log(chalk.white('  2. Compare wallets: npm run compare'));
      
      await db.close();
      process.exit(0);
      
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      logger.error('CLI Error', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

/**
 * Report command - generate analysis reports
 */
program
  .command('report')
  .description('Generate analysis report for a wallet')
  .option('-w, --wallet <address>', 'Wallet address')
  .option('-a, --all', 'Generate reports for all tracked wallets')
  .option('-o, --output <dir>', 'Output directory', './reports')
  .action(async (options) => {
    const spinner = ora('Generating reports...').start();
    
    try {
      const db = new Database(process.env.DATABASE_URL!);
      const reportGen = new ReportGenerator(db);
      
      if (options.all) {
        const wallets = await db.getAllTrackedWallets();
        spinner.info(chalk.blue(`Found ${wallets.length} wallets`));
        
        for (const wallet of wallets) {
          spinner.text = `Generating report for ${wallet.address.substring(0, 8)}...`;
          
          const outputPath = path.join(
            options.output,
            `${wallet.address.substring(0, 8)}_report.md`
          );
          
          await reportGen.generateWalletReport(wallet.id, outputPath);
          
          console.log(chalk.green(`✓ ${wallet.address.substring(0, 8)}... → ${outputPath}`));
        }
      } else if (options.wallet) {
        const wallet = await db.getTrackedWallet(options.wallet);
        
        if (!wallet) {
          spinner.fail(chalk.red('Wallet not found in database'));
          process.exit(1);
        }
        
        const outputPath = path.join(
          options.output,
          `${wallet.address.substring(0, 8)}_report.md`
        );
        
        await reportGen.generateWalletReport(wallet.id, outputPath);
        
        spinner.succeed(chalk.green(`Report generated: ${outputPath}`));
      } else {
        spinner.fail(chalk.red('Please specify --wallet or --all'));
        process.exit(1);
      }
      
      await db.close();
      process.exit(0);
      
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      logger.error('CLI Error', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

/**
 * Status command - check analysis status
 */
program
  .command('status')
  .description('Show analysis status of all tracked wallets')
  .action(async () => {
    const spinner = ora('Loading wallet status...').start();
    
    try {
      const db = new Database(process.env.DATABASE_URL!);
      
      const wallets = await db.getAllTrackedWallets();
      
      spinner.succeed(chalk.green(`Found ${wallets.length} tracked wallets\n`));
      
      console.log(chalk.bold('Wallet Status:\n'));
      
      for (const wallet of wallets) {
        const txCount = await db.getTransactionCount(wallet.id);
        const summary = await db.getWalletSummary(wallet.id);
        
        console.log(chalk.cyan(`${wallet.address.substring(0, 12)}...`));
        console.log(chalk.white(`  Label: ${wallet.label || 'N/A'}`));
        console.log(chalk.white(`  Transactions: ${txCount}`));
        console.log(chalk.white(`  Matched Trades: ${summary.total_matched_trades || 0}`));
        console.log(chalk.white(`  Win Rate: ${((summary.win_rate || 0) * 100).toFixed(2)}%`));
        console.log(chalk.white(`  Total Profit: ${(summary.total_profit_sol || 0).toFixed(4)} SOL`));
        console.log(chalk.white(`  Last Analyzed: ${wallet.lastAnalyzedAt ? new Date(wallet.lastAnalyzedAt).toLocaleString() : 'Never'}`));
        console.log('');
      }
      
      await db.close();
      process.exit(0);
      
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      logger.error('CLI Error', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  });

/**
 * Setup DB command
 */
program
  .command('setup-db')
  .description('Initialize database schema')
  .action(async () => {
    const spinner = ora('Setting up database...').start();
    
    try {
      console.log(chalk.yellow('\nPlease run this command to set up the database:'));
      console.log(chalk.cyan('  psql $DATABASE_URL -f ../../database/wallet-analyzer-schema.sql\n'));
      
      spinner.succeed(chalk.green('Database setup instructions shown'));
      process.exit(0);
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();

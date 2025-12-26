#!/usr/bin/env node
/**
 * Wallet Analyzer CLI
 * Analyzes wallet trading activity and calculates profit/loss
 */

import { WalletAnalyzer, WalletAnalysis, TokenSummary } from './wallet-analyzer.js';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const program = new Command();

program
  .name('wallet-analyzer')
  .description('Analyze Solana wallet trading activity and calculate profit/loss')
  .version('1.0.0');

program
  .argument('<wallet>', 'Wallet address to analyze')
  .option('-d, --days <number>', 'Number of days to analyze', '30')
  .option('-t, --top <number>', 'Show top N tokens only', '20')
  .option('--all', 'Show all tokens (no limit)')
  .option('--json', 'Output as JSON')
  .action(async (wallet: string, options: { days: string; top: string; all?: boolean; json?: boolean }) => {
    try {
      const analyzer = new WalletAnalyzer();
      const days = parseInt(options.days) || 30;
      const topN = options.all ? Infinity : (parseInt(options.top) || 20);

      const analysis = await analyzer.analyzeWallet(wallet, days);

      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
        return;
      }

      printAnalysis(analysis, topN);
    } catch (error: any) {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

function formatSOL(amount: number): string {
  return amount.toFixed(4);
}

function formatPercent(percent: number): string {
  const formatted = percent.toFixed(2);
  if (percent > 0) {
    return chalk.green(`+${formatted}%`);
  } else if (percent < 0) {
    return chalk.red(`${formatted}%`);
  }
  return `${formatted}%`;
}

function formatProfitLoss(amount: number): string {
  const formatted = formatSOL(Math.abs(amount));
  if (amount > 0) {
    return chalk.green(`+${formatted} SOL`);
  } else if (amount < 0) {
    return chalk.red(`-${formatted} SOL`);
  }
  return `${formatted} SOL`;
}

function printAnalysis(analysis: WalletAnalysis, topN: number): void {
  console.log('\n');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('                    📊 WALLET ANALYSIS REPORT                   '));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════'));

  // Wallet Info
  console.log('\n' + chalk.bold.white('📍 Wallet: ') + chalk.yellow(analysis.walletAddress));
  console.log(chalk.bold.white('📅 Period: ') + 
    `${analysis.periodStart.toLocaleDateString()} → ${analysis.periodEnd.toLocaleDateString()}`);
  console.log(chalk.bold.white('🔄 Total Swaps: ') + chalk.cyan(analysis.totalTrades.toString()));
  console.log(chalk.bold.white('🪙 Unique Tokens: ') + chalk.cyan(analysis.tokenSummaries.length.toString()));

  // Overall Summary
  console.log('\n' + chalk.bold.cyan('───────────────────────────────────────────────────────────────'));
  console.log(chalk.bold.white('                         💰 OVERALL SUMMARY                       '));
  console.log(chalk.bold.cyan('───────────────────────────────────────────────────────────────'));

  const summaryTable = new Table({
    chars: { 'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
    style: { head: ['cyan'] }
  });

  summaryTable.push(
    [chalk.white('Total SOL Spent:'), chalk.red(`-${formatSOL(analysis.totalSolSpent)} SOL`)],
    [chalk.white('Total SOL Received:'), chalk.green(`+${formatSOL(analysis.totalSolReceived)} SOL`)],
    [chalk.white('Net Profit/Loss:'), formatProfitLoss(analysis.netProfitLoss)],
    [chalk.white('ROI:'), formatPercent(analysis.overallProfitPercent)],
    ['', ''],
    [chalk.white('Profitable Tokens:'), chalk.green(analysis.profitableTokens.toString())],
    [chalk.white('Unprofitable Tokens:'), chalk.red(analysis.unprofitableTokens.toString())],
    [chalk.white('Unrealized (holding):'), chalk.yellow(
      (analysis.tokenSummaries.filter(t => t.remainingTokens > 0).length).toString()
    )],
  );

  console.log(summaryTable.toString());

  // Verdict
  console.log('\n' + chalk.bold.cyan('───────────────────────────────────────────────────────────────'));
  if (analysis.netProfitLoss > 0) {
    console.log(chalk.bold.green(`  ✅ PROFITABLE! Net gain of ${formatSOL(analysis.netProfitLoss)} SOL (${analysis.overallProfitPercent.toFixed(2)}%)`));
  } else if (analysis.netProfitLoss < 0) {
    console.log(chalk.bold.red(`  ❌ UNPROFITABLE! Net loss of ${formatSOL(Math.abs(analysis.netProfitLoss))} SOL (${analysis.overallProfitPercent.toFixed(2)}%)`));
  } else {
    console.log(chalk.bold.yellow('  ➖ BREAK EVEN'));
  }
  console.log(chalk.bold.cyan('───────────────────────────────────────────────────────────────'));

  // Token Breakdown
  console.log('\n' + chalk.bold.white('                         📈 TOKEN BREAKDOWN                       '));
  console.log(chalk.bold.cyan('───────────────────────────────────────────────────────────────'));

  const tokenTable = new Table({
    head: [
      chalk.cyan('Token'),
      chalk.cyan('Buys'),
      chalk.cyan('Sells'),
      chalk.cyan('SOL Spent'),
      chalk.cyan('SOL Got'),
      chalk.cyan('P/L'),
      chalk.cyan('ROI'),
      chalk.cyan('Status'),
    ],
    style: { head: ['cyan'] },
    colWidths: [14, 6, 6, 12, 12, 14, 10, 10],
  });

  const tokensToShow = analysis.tokenSummaries.slice(0, topN);

  for (const token of tokensToShow) {
    const status = getTokenStatus(token);
    
    tokenTable.push([
      token.tokenSymbol.length > 12 ? token.tokenSymbol.slice(0, 11) + '…' : token.tokenSymbol,
      token.totalBuys.toString(),
      token.totalSells.toString(),
      formatSOL(token.totalSolSpent),
      formatSOL(token.totalSolReceived),
      formatProfitLoss(token.netProfitLoss),
      formatPercent(token.profitLossPercent),
      status,
    ]);
  }

  console.log(tokenTable.toString());

  if (analysis.tokenSummaries.length > topN) {
    console.log(chalk.gray(`\n  ... and ${analysis.tokenSummaries.length - topN} more tokens (use --all to see all)`));
  }

  // Top Winners
  const winners = analysis.tokenSummaries
    .filter(t => t.netProfitLoss > 0)
    .sort((a, b) => b.netProfitLoss - a.netProfitLoss)
    .slice(0, 5);

  if (winners.length > 0) {
    console.log('\n' + chalk.bold.green('🏆 TOP 5 WINNERS:'));
    winners.forEach((t, i) => {
      console.log(chalk.green(`   ${i + 1}. ${t.tokenSymbol}: +${formatSOL(t.netProfitLoss)} SOL (${t.profitLossPercent.toFixed(1)}%)`));
    });
  }

  // Top Losers
  const losers = analysis.tokenSummaries
    .filter(t => t.netProfitLoss < 0 && t.totalSells > 0)
    .sort((a, b) => a.netProfitLoss - b.netProfitLoss)
    .slice(0, 5);

  if (losers.length > 0) {
    console.log('\n' + chalk.bold.red('💀 TOP 5 LOSERS:'));
    losers.forEach((t, i) => {
      console.log(chalk.red(`   ${i + 1}. ${t.tokenSymbol}: ${formatSOL(t.netProfitLoss)} SOL (${t.profitLossPercent.toFixed(1)}%)`));
    });
  }

  // Unrealized positions
  const unrealized = analysis.tokenSummaries
    .filter(t => t.remainingTokens > 0 && t.totalSells === 0)
    .sort((a, b) => b.totalSolSpent - a.totalSolSpent)
    .slice(0, 5);

  if (unrealized.length > 0) {
    console.log('\n' + chalk.bold.yellow('⏳ LARGEST UNREALIZED POSITIONS (no sells yet):'));
    unrealized.forEach((t, i) => {
      console.log(chalk.yellow(`   ${i + 1}. ${t.tokenSymbol}: Spent ${formatSOL(t.totalSolSpent)} SOL`));
    });
  }

  console.log('\n' + chalk.bold.cyan('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.gray('  Note: "Unrealized" positions may still be held or transferred elsewhere.'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════════\n'));
}

function getTokenStatus(token: TokenSummary): string {
  if (token.totalSells === 0 && token.remainingTokens > 0) {
    return chalk.yellow('HOLDING');
  } else if (token.isProfitable) {
    return chalk.green('PROFIT');
  } else if (token.netProfitLoss < 0) {
    return chalk.red('LOSS');
  }
  return chalk.gray('EVEN');
}

// Run the CLI
program.parse();


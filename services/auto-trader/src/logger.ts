/**
 * Logger Module
 * Human-readable logging with timestamps
 */

export class Logger {
  /**
   * Get current time in HH:MM:SS format
   */
  private static getTime(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Get full timestamp with date
   */
  private static getFullTimestamp(): string {
    const now = new Date();
    const date = now.toLocaleDateString('en-US');
    const time = this.getTime();
    return `${date} ${time}`;
  }

  static system(message: string): void {
    console.log(`[${this.getTime()}] 🤖 ${message}`);
  }

  static info(message: string): void {
    console.log(`[${this.getTime()}] ℹ️  ${message}`);
  }

  static success(message: string): void {
    console.log(`[${this.getTime()}] ✅ ${message}`);
  }

  static warning(message: string): void {
    console.log(`[${this.getTime()}] ⚠️  ${message}`);
  }

  static error(message: string, error?: any): void {
    console.error(`[${this.getTime()}] ❌ ${message}`);
    if (error) {
      console.error(`    ${error.message || error}`);
    }
  }

  static debug(message: string): void {
    console.log(`[${this.getTime()}] 🔍 ${message}`);
  }

  /**
   * Log a new coin detected
   */
  static coinDetected(name: string, symbol: string, mint: string, age: number): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${this.getTime()}] 🪙 NEW COIN DETECTED`);
    console.log(`${'='.repeat(80)}`);
    console.log(`  Name:     ${name}`);
    console.log(`  Symbol:   ${symbol}`);
    console.log(`  Mint:     ${mint}`);
    console.log(`  Age:      ${age.toFixed(2)} hours`);
    console.log(`  URL:      https://dexscreener.com/solana/${mint}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  /**
   * Log criteria evaluation
   */
  static criteriaCheck(mint: string, criterion: string, passed: boolean, details: string): void {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${this.getTime()}] ${status} | ${criterion}: ${details}`);
  }

  /**
   * Log token rejection
   */
  static tokenRejected(mint: string, reason: string): void {
    console.log(`[${this.getTime()}] ❌ REJECTED: ${reason}`);
    console.log(`${'─'.repeat(80)}\n`);
  }

  /**
   * Log token passed all criteria
   */
  static tokenPassed(mint: string): void {
    console.log(`[${this.getTime()}] 🎯 ALL CRITERIA PASSED!`);
    console.log(`${'='.repeat(80)}\n`);
  }

  /**
   * Log buy attempt
   */
  static buyAttempt(mint: string, amountSol: number): void {
    console.log(`\n${'*'.repeat(80)}`);
    console.log(`[${this.getTime()}] 💰 ATTEMPTING BUY`);
    console.log(`${'*'.repeat(80)}`);
    console.log(`  Token:  ${mint}`);
    console.log(`  Amount: ${amountSol} SOL`);
    console.log(`${'*'.repeat(80)}\n`);
  }

  /**
   * Log successful buy
   */
  static buySuccess(mint: string, amountSol: number, tokensReceived: number, signature: string): void {
    console.log(`[${this.getTime()}] ✅ BUY SUCCESSFUL!`);
    console.log(`  SOL Spent:      ${amountSol}`);
    console.log(`  Tokens Received: ${tokensReceived.toFixed(2)}`);
    console.log(`  Signature:      ${signature}`);
    console.log(`  Explorer:       https://solscan.io/tx/${signature}`);
    console.log(`${'*'.repeat(80)}\n`);
  }

  /**
   * Log position monitoring
   */
  static positionCheck(mint: string, entryPrice: number, currentPrice: number, profitPercent: number): void {
    const profitEmoji = profitPercent >= 0 ? '📈' : '📉';
    console.log(`[${this.getTime()}] ${profitEmoji} Position Check`);
    console.log(`  Token:   ${mint.substring(0, 8)}...`);
    console.log(`  Entry:   $${entryPrice.toFixed(8)}`);
    console.log(`  Current: $${currentPrice.toFixed(8)}`);
    console.log(`  Profit:  ${profitPercent.toFixed(2)}%`);
  }

  /**
   * Log sell attempt
   */
  static sellAttempt(mint: string, profitPercent: number): void {
    console.log(`\n${'*'.repeat(80)}`);
    console.log(`[${this.getTime()}] 💵 ATTEMPTING SELL - TARGET REACHED!`);
    console.log(`${'*'.repeat(80)}`);
    console.log(`  Token:  ${mint}`);
    console.log(`  Profit: ${profitPercent.toFixed(2)}%`);
    console.log(`${'*'.repeat(80)}\n`);
  }

  /**
   * Log successful sell
   */
  static sellSuccess(mint: string, solReceived: number, profitSol: number, signature: string): void {
    console.log(`[${this.getTime()}] ✅ SELL SUCCESSFUL!`);
    console.log(`  SOL Received: ${solReceived.toFixed(4)}`);
    console.log(`  Profit (SOL): ${profitSol.toFixed(4)}`);
    console.log(`  Signature:    ${signature}`);
    console.log(`  Explorer:     https://solscan.io/tx/${signature}`);
    console.log(`${'*'.repeat(80)}\n`);
  }

  /**
   * Log scanning summary
   */
  static scanningSummary(totalScanned: number, passed: number, failed: number): void {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`[${this.getTime()}] 📊 SCANNING SUMMARY`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`  Total Scanned: ${totalScanned}`);
    console.log(`  Passed:        ${passed} (${totalScanned > 0 ? ((passed / totalScanned) * 100).toFixed(1) : 0}%)`);
    console.log(`  Failed:        ${failed} (${totalScanned > 0 ? ((failed / totalScanned) * 100).toFixed(1) : 0}%)`);
    console.log(`${'═'.repeat(80)}\n`);
  }
}

/**
 * Human-Readable Logging System
 * Provides detailed, timestamped logs explaining every decision
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;

  static setLevel(level: string) {
    switch (level.toLowerCase()) {
      case 'debug':
        this.level = LogLevel.DEBUG;
        break;
      case 'info':
        this.level = LogLevel.INFO;
        break;
      case 'warn':
        this.level = LogLevel.WARN;
        break;
      case 'error':
        this.level = LogLevel.ERROR;
        break;
    }
  }

  private static getTimestamp(): string {
    return new Date().toISOString();
  }

  private static formatMoney(value: number): string {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private static formatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
  }

  private static log(level: LogLevel, emoji: string, message: string, data?: any) {
    if (level < this.level) return;

    const timestamp = this.getTimestamp();
    console.log(`${emoji} [${timestamp}] ${message}`);
    
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  // System Events
  static systemStart() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 PUMP.FUN TRADING BOT - STARTING');
    console.log('='.repeat(80) + '\n');
  }

  static systemShutdown() {
    console.log('\n' + '='.repeat(80));
    console.log('🛑 PUMP.FUN TRADING BOT - SHUTTING DOWN');
    console.log('='.repeat(80) + '\n');
  }

  static websocketConnected() {
    this.log(LogLevel.INFO, '🔌', 'WebSocket connected to Helius - Listening for new Pump.fun tokens');
  }

  static websocketReconnecting(attempt: number) {
    this.log(LogLevel.WARN, '⚠️', `WebSocket disconnected - Reconnecting (attempt ${attempt})...`);
  }

  // Token Discovery
  static newTokenDetected(mint: string, signature: string, metadata?: { name?: string; symbol?: string }) {
    this.log(LogLevel.INFO, '🆕', `NEW TOKEN DETECTED`, {
      mint,
      name: metadata?.name || 'Loading...',
      ticker: metadata?.symbol || 'Loading...',
      signature,
      solscanLink: `https://solscan.io/token/${mint}`,
      action: 'Starting evaluation process...',
    });
  }

  static allNewTokens(count: number) {
    console.log(`\n📊 Total new tokens detected this session: ${count}\n`);
  }

  // Filtering Decisions
  static tokenTooOld(mint: string, ageMinutes: number, maxMinutes: number) {
    this.log(LogLevel.INFO, '⏰', `TOKEN IGNORED - Too Old`, {
      mint,
      age: `${ageMinutes.toFixed(1)} minutes`,
      maximum: `${maxMinutes} minutes`,
      reason: 'Only tokens younger than 60 minutes are eligible',
    });
  }

  static waitingForDexScreener(mint: string, elapsedSeconds: number) {
    this.log(LogLevel.DEBUG, '⏳', `Waiting for DexScreener data... (${elapsedSeconds}s elapsed)`, { mint });
  }

  static dexScreenerTimeout(mint: string, waitedSeconds: number) {
    this.log(LogLevel.WARN, '❌', `TOKEN IGNORED - DexScreener Timeout`, {
      mint,
      waited: `${waitedSeconds} seconds`,
      reason: 'DexScreener data never appeared - token may not have liquidity yet',
    });
  }

  static marketCapTooLow(mint: string, currentMcap: number, requiredMcap: number) {
    this.log(LogLevel.INFO, '📉', `TOKEN IGNORED - Market Cap Too Low`, {
      mint,
      currentMarketCap: this.formatMoney(currentMcap),
      requiredMarketCap: this.formatMoney(requiredMcap),
      reason: 'Market cap must reach at least $20,000 within 60 minutes',
    });
  }

  static liquidityTooLow(mint: string, liquidity: number) {
    this.log(LogLevel.INFO, '💧', `TOKEN IGNORED - Low Liquidity`, {
      mint,
      liquidity: this.formatMoney(liquidity),
      reason: 'Insufficient liquidity for safe trading',
    });
  }

  static holderConcentrationFailed(mint: string, topHolderPercent: number, maxAllowed: number, topHolderAddress: string) {
    this.log(LogLevel.WARN, '🐋', `TOKEN IGNORED - Holder Concentration Risk`, {
      mint,
      topHolder: topHolderAddress,
      topHolderOwnership: this.formatPercent(topHolderPercent),
      maxAllowed: this.formatPercent(maxAllowed),
      reason: 'Single wallet holds too much supply - high rug pull risk',
    });
  }

  static trackingForATH(mint: string, currentMcap: number) {
    this.log(LogLevel.INFO, '📊', `TOKEN QUALIFIED - Now Tracking for ATH`, {
      mint,
      currentMarketCap: this.formatMoney(currentMcap),
      nextStep: 'Waiting for market cap to reach ATH, then drop 40%',
    });
  }

  static newATH(mint: string, newATH: number, previousATH: number) {
    this.log(LogLevel.DEBUG, '📈', `New ATH Recorded`, {
      mint,
      previousATH: this.formatMoney(previousATH),
      newATH: this.formatMoney(newATH),
    });
  }

  static drawdownDetected(mint: string, ath: number, currentMcap: number, drawdownPercent: number) {
    this.log(LogLevel.INFO, '📉', `DRAWDOWN DETECTED - ${this.formatPercent(drawdownPercent)}`, {
      mint,
      ath: this.formatMoney(ath),
      currentMarketCap: this.formatMoney(currentMcap),
      drawdown: this.formatPercent(drawdownPercent),
      status: drawdownPercent >= 40 ? '✅ Meets 40% requirement' : '⏳ Waiting for 40%',
    });
  }

  static insufficientDrawdown(mint: string, ath: number, currentMcap: number, drawdownPercent: number, required: number) {
    this.log(LogLevel.INFO, '📊', `TOKEN IGNORED - Insufficient Drawdown`, {
      mint,
      ath: this.formatMoney(ath),
      currentMarketCap: this.formatMoney(currentMcap),
      drawdown: this.formatPercent(drawdownPercent),
      required: this.formatPercent(required),
      reason: 'Must experience at least 40% drop from ATH within 60 minutes',
    });
  }

  // Trade Execution
  static allCriteriaPass(mint: string, mcap: number, drawdown: number, topHolderPercent: number) {
    this.log(LogLevel.INFO, '✅', `ALL CRITERIA PASSED - READY TO BUY`, {
      mint,
      marketCap: this.formatMoney(mcap),
      drawdownFromATH: this.formatPercent(drawdown),
      topHolderConcentration: this.formatPercent(topHolderPercent),
      nextStep: 'Executing buy via Jupiter...',
    });
  }

  static paperTradingMode(mint: string, solAmount: number) {
    this.log(LogLevel.WARN, '📝', `PAPER TRADING - Simulating Buy (No Real Trade)`, {
      mint,
      amount: `${solAmount} SOL`,
      reason: 'ENABLE_LIVE_TRADING is set to false',
    });
  }

  static jupiterQuoteRequested(mint: string, solAmount: number) {
    this.log(LogLevel.DEBUG, '💱', `Requesting Jupiter quote`, {
      from: 'SOL',
      to: mint,
      amount: `${solAmount} SOL`,
    });
  }

  static jupiterQuoteReceived(mint: string, solAmount: number, tokenAmount: string, price: number) {
    this.log(LogLevel.DEBUG, '💱', `Jupiter quote received`, {
      mint,
      input: `${solAmount} SOL`,
      expectedOutput: tokenAmount,
      pricePerToken: price.toFixed(8),
    });
  }

  static buyExecuted(mint: string, solAmount: number, tokenAmount: string, signature: string) {
    this.log(LogLevel.INFO, '🟢', `BUY EXECUTED - Position Opened`, {
      mint,
      invested: `${solAmount} SOL`,
      tokensReceived: tokenAmount,
      signature,
      nextStep: 'Monitoring position every second for 2x profit...',
    });
  }

  static buyFailed(mint: string, error: string) {
    this.log(LogLevel.ERROR, '❌', `BUY FAILED`, {
      mint,
      error,
      action: 'Skipping this token',
    });
  }

  // Position Monitoring
  static positionCheck(mint: string, currentValue: number, invested: number, profitPercent: number, profitTarget: number) {
    this.log(LogLevel.DEBUG, '🔍', `Position Check`, {
      mint,
      invested: `${invested} SOL`,
      currentValue: `${currentValue.toFixed(4)} SOL`,
      profit: this.formatPercent(profitPercent),
      target: `${profitTarget}x (${this.formatPercent((profitTarget - 1) * 100)})`,
    });
  }

  static profitTargetReached(mint: string, invested: number, currentValue: number, profitPercent: number) {
    this.log(LogLevel.INFO, '🎯', `PROFIT TARGET REACHED - Selling Position`, {
      mint,
      invested: `${invested} SOL`,
      currentValue: `${currentValue.toFixed(4)} SOL`,
      profit: this.formatPercent(profitPercent),
      action: 'Executing sell via Jupiter...',
    });
  }

  static sellExecuted(mint: string, tokenAmount: string, solReceived: number, invested: number, profit: number, signature: string) {
    this.log(LogLevel.INFO, '🔴', `SELL EXECUTED - Position Closed`, {
      mint,
      tokensSold: tokenAmount,
      solReceived: `${solReceived.toFixed(4)} SOL`,
      invested: `${invested} SOL`,
      profit: `${profit.toFixed(4)} SOL (${this.formatPercent(((solReceived - invested) / invested) * 100)})`,
      signature,
      status: '✅ Trade Complete',
    });
  }

  static sellFailed(mint: string, error: string) {
    this.log(LogLevel.ERROR, '❌', `SELL FAILED`, {
      mint,
      error,
      action: 'Will retry on next check...',
    });
  }

  // Errors
  static error(message: string, error: any) {
    this.log(LogLevel.ERROR, '🔥', message, {
      error: error.message || error,
      stack: error.stack,
    });
  }

  static debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, '🐛', message, data);
  }
}

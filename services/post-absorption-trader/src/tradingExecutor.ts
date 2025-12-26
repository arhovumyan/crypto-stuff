import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config';
import logger from './logger';
import {
  Position,
  AbsorptionEvent,
  StabilizationAnalysis,
  RiskMetrics,
} from './types';

/**
 * TradingExecutor handles entry and exit of positions
 * 
 * Key Concept: 
 * - Enter ONLY after absorption + stabilization confirmed
 * - Use proper risk management and position sizing
 * - Exit based on profit targets, stop losses, or time decay
 */
export class TradingExecutor {
  private wallet: Keypair;
  
  // Track open positions
  private positions: Map<string, Position> = new Map();
  
  // Track daily P&L
  private dailyPnl: number = 0;
  private dailyTradeCount: number = 0;
  private lastResetDate: string = new Date().toISOString().split('T')[0];

  constructor() {
    // Initialize wallet (if live trading enabled)
    if (config.enableLiveTrading) {
      try {
        // Try to decode as base58 private key
        const secretKey = bs58.decode(config.copyWalletPrivateKey);
        this.wallet = Keypair.fromSecretKey(secretKey);
        logger.info(`[TradingExecutor] Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
      } catch (error) {
        logger.error('[TradingExecutor] Failed to load wallet. Check COPY_WALLET_PRIVATE_KEY in .env');
        throw error;
      }
    } else {
      // Paper trading mode - generate temporary keypair
      this.wallet = Keypair.generate();
      logger.info('[TradingExecutor] Paper trading mode - no real trades will be executed');
    }

    // Monitor positions periodically
    setInterval(() => this.monitorPositions(), 30000); // Every 30 seconds
    
    // Reset daily stats at midnight
    setInterval(() => this.resetDailyStatsIfNeeded(), 60000); // Every minute
  }

  /**
   * Attempt to enter a position after stabilization confirmed
   */
  async enterPosition(
    event: AbsorptionEvent,
    stabilization: StabilizationAnalysis
  ): Promise<Position | null> {
    try {
      // Check risk limits
      const riskCheck = await this.checkRiskLimits(event.token);
      if (!riskCheck.canTrade) {
        logger.warn(`[TradingExecutor] Risk limits prevent entry: ${riskCheck.reasons.join(', ')}`);
        return null;
      }

      // Calculate position size
      const entryAmountSol = config.entry.buyAmountSol;
      const entryPrice = stabilization.currentPrice;

      logger.info(`[TradingExecutor] 🎯 ENTERING POSITION: ${event.tokenSymbol || event.token.slice(0, 8)}`);
      logger.info(`  - Amount: ${entryAmountSol} SOL`);
      logger.info(`  - Price: $${entryPrice.toFixed(6)}`);
      logger.info(`  - Absorption Event: ${event.id}`);

      // Execute trade (or simulate if paper trading)
      let signature: string;
      let amountToken: number;

      if (config.enableLiveTrading) {
        // Real trade via Jupiter
        const result = await this.executeSwap(
          'SOL',
          event.token,
          entryAmountSol,
          config.entry.maxSlippageBps
        );
        signature = result.signature;
        amountToken = result.outputAmount;
      } else {
        // Paper trading
        signature = 'PAPER_TRADE_' + Date.now();
        amountToken = (entryAmountSol / entryPrice) * 0.98; // Assume 2% slippage
        logger.info('[TradingExecutor] 📄 Paper trade (no real execution)');
      }

      // Create position
      const position: Position = {
        id: `${event.token}-${Date.now()}`,
        token: event.token,
        tokenSymbol: event.tokenSymbol,
        entryTime: Date.now() / 1000,
        entryPrice,
        entryAmountSol,
        entryAmountToken: amountToken,
        entrySignature: signature,
        currentPrice: entryPrice,
        highestPrice: entryPrice,
        lowestPrice: entryPrice,
        absorptionEventId: event.id,
        status: 'open',
      };

      this.positions.set(event.token, position);
      this.dailyTradeCount++;

      logger.info(`[TradingExecutor] ✅ Position opened: ${position.id}`);
      logger.info(`  - Entry Signature: ${signature}`);
      logger.info(`  - Amount Token: ${amountToken.toFixed(4)}`);

      return position;
    } catch (error) {
      logger.error('[TradingExecutor] Error entering position:', error);
      return null;
    }
  }

  /**
   * Monitor all open positions and check exit conditions
   */
  private async monitorPositions(): Promise<void> {
    for (const [token, position] of this.positions) {
      if (position.status !== 'open') {
        continue;
      }

      try {
        await this.checkExitConditions(position);
      } catch (error) {
        logger.error(`[TradingExecutor] Error monitoring position ${token}:`, error);
      }
    }
  }

  /**
   * Check if position should be exited
   */
  private async checkExitConditions(position: Position): Promise<void> {
    // Fetch current price (in production, use real market data)
    const currentPrice = await this.getCurrentPrice(position.token);
    position.currentPrice = currentPrice;

    // Update highest/lowest
    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
    }
    if (currentPrice < position.lowestPrice) {
      position.lowestPrice = currentPrice;
    }

    // Calculate P&L
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    position.unrealizedPnlPercent = pnlPercent;
    position.unrealizedPnlSol = (pnlPercent / 100) * position.entryAmountSol;

    const now = Date.now() / 1000;
    const holdTime = now - position.entryTime;

    // Check exit conditions
    let exitReason: string | null = null;

    // 1. Profit target hit
    if (pnlPercent >= config.exit.profitTargetPercent) {
      exitReason = `Profit target hit (${pnlPercent.toFixed(2)}%)`;
    }

    // 2. Stop loss hit
    if (pnlPercent <= -config.exit.stopLossPercent) {
      exitReason = `Stop loss hit (${pnlPercent.toFixed(2)}%)`;
    }

    // 3. Trailing stop
    if (pnlPercent >= config.exit.trailingStopActivationPercent) {
      const trailingStopPrice = position.highestPrice * (1 - config.exit.trailingStopDistancePercent / 100);
      position.trailingStopPrice = trailingStopPrice;

      if (currentPrice <= trailingStopPrice) {
        exitReason = `Trailing stop hit (${pnlPercent.toFixed(2)}%)`;
      }
    }

    // 4. Maximum hold time
    if (holdTime >= config.exit.maxHoldTimeSec) {
      exitReason = `Max hold time reached (${(holdTime / 3600).toFixed(1)}h)`;
    }

    // 5. Idle exit (no significant movement)
    if (holdTime >= config.exit.idleExitTimeSec && Math.abs(pnlPercent) < 5) {
      exitReason = `Idle exit (${(holdTime / 3600).toFixed(1)}h, ${pnlPercent.toFixed(2)}%)`;
    }

    // Exit if any condition met
    if (exitReason) {
      await this.exitPosition(position, exitReason);
    }
  }

  /**
   * Exit a position
   */
  private async exitPosition(position: Position, reason: string): Promise<void> {
    try {
      logger.info(`[TradingExecutor] 🚪 EXITING POSITION: ${position.tokenSymbol || position.token.slice(0, 8)}`);
      logger.info(`  - Reason: ${reason}`);
      logger.info(`  - Entry Price: $${position.entryPrice.toFixed(6)}`);
      logger.info(`  - Exit Price: $${position.currentPrice!.toFixed(6)}`);
      logger.info(`  - P&L: ${position.unrealizedPnlPercent!.toFixed(2)}% (${position.unrealizedPnlSol!.toFixed(4)} SOL)`);

      let signature: string;
      let exitAmountSol: number;

      if (config.enableLiveTrading) {
        // Real trade
        const result = await this.executeSwap(
          position.token,
          'SOL',
          position.entryAmountToken,
          config.entry.maxSlippageBps
        );
        signature = result.signature;
        exitAmountSol = result.outputAmount;
      } else {
        // Paper trading
        signature = 'PAPER_EXIT_' + Date.now();
        exitAmountSol = position.entryAmountSol * (1 + (position.unrealizedPnlPercent! / 100)) * 0.98;
        logger.info('[TradingExecutor] 📄 Paper exit (no real execution)');
      }

      // Update position
      position.exitTime = Date.now() / 1000;
      position.exitPrice = position.currentPrice;
      position.exitAmountSol = exitAmountSol;
      position.exitSignature = signature;
      position.exitReason = reason;
      position.realizedPnlSol = exitAmountSol - position.entryAmountSol;
      position.realizedPnlPercent = (position.realizedPnlSol / position.entryAmountSol) * 100;
      position.status = 'closed';

      // Update daily P&L
      this.dailyPnl += position.realizedPnlSol!;

      logger.info(`[TradingExecutor] ✅ Position closed`);
      logger.info(`  - Exit Signature: ${signature}`);
      logger.info(`  - Realized P&L: ${position.realizedPnlPercent!.toFixed(2)}% (${position.realizedPnlSol!.toFixed(4)} SOL)`);
      logger.info(`  - Daily P&L: ${this.dailyPnl.toFixed(4)} SOL`);
    } catch (error) {
      logger.error('[TradingExecutor] Error exiting position:', error);
    }
  }

  /**
   * Execute a swap (placeholder - integrate with Jupiter in production)
   */
  private async executeSwap(
    _inputMint: string,
    _outputMint: string,
    _amount: number,
    _slippageBps: number
  ): Promise<{ signature: string; outputAmount: number }> {
    // Placeholder - in production, use Jupiter API
    throw new Error('Jupiter integration not implemented - set ABSORPTION_ENABLE_LIVE_TRADING=false for paper trading');
  }

  /**
   * Get current price for a token (placeholder)
   */
  private async getCurrentPrice(_token: string): Promise<number> {
    // Placeholder - in production, fetch from Jupiter/DexScreener
    return Math.random() * 0.001 + 0.0001;
  }

  /**
   * Check risk limits before entering position
   */
  private async checkRiskLimits(token: string): Promise<{ canTrade: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Check if already have position in this token
    if (this.positions.has(token)) {
      reasons.push('Already have position in this token');
    }

    // Check max positions
    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'open').length;
    if (openPositions >= config.entry.maxPositions) {
      reasons.push(`Max positions reached (${openPositions}/${config.entry.maxPositions})`);
    }

    // Check daily loss limit
    if (this.dailyPnl <= -config.risk.maxDailyLossUsd) {
      reasons.push(`Daily loss limit reached ($${this.dailyPnl.toFixed(2)})`);
    }

    // Check portfolio exposure
    const totalExposure = Array.from(this.positions.values())
      .filter(p => p.status === 'open')
      .reduce((sum, p) => sum + p.entryAmountSol, 0) * 100; // Assume SOL = $100

    if (totalExposure + (config.entry.buyAmountSol * 100) > config.risk.maxPortfolioExposureUsd) {
      reasons.push(`Portfolio exposure limit ($${totalExposure.toFixed(2)})`);
    }

    return {
      canTrade: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Reset daily stats if new day
   */
  private resetDailyStatsIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      logger.info(`[TradingExecutor] New day - resetting daily stats`);
      logger.info(`  - Previous day P&L: ${this.dailyPnl.toFixed(4)} SOL`);
      logger.info(`  - Previous day trades: ${this.dailyTradeCount}`);
      
      this.dailyPnl = 0;
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Get all positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

  /**
   * Get risk metrics
   */
  getRiskMetrics(): RiskMetrics {
    const openPositions = this.getOpenPositions();
    const totalExposureUsd = openPositions.reduce((sum, p) => sum + p.entryAmountSol * 100, 0);
    
    const tokenExposures = new Map<string, number>();
    openPositions.forEach(p => {
      tokenExposures.set(p.token, p.entryAmountSol * 100);
    });

    const limitReasons: string[] = [];
    let isRiskLimitReached = false;

    if (openPositions.length >= config.entry.maxPositions) {
      limitReasons.push('Max positions reached');
      isRiskLimitReached = true;
    }

    if (this.dailyPnl <= -config.risk.maxDailyLossUsd) {
      limitReasons.push('Daily loss limit reached');
      isRiskLimitReached = true;
    }

    return {
      dailyPnlUsd: this.dailyPnl * 100,
      dailyTradeCount: this.dailyTradeCount,
      openPositions: openPositions.length,
      totalExposureUsd,
      tokenExposures,
      isRiskLimitReached,
      limitReasons,
    };
  }
}

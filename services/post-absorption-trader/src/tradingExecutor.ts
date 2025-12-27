import { Keypair, Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { config } from './config';
import logger from './logger';
import {
  Position,
  AbsorptionEvent,
  StabilizationAnalysis,
  RiskMetrics,
} from './types';
import { MarketDataService } from './marketDataService';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Trade record saved to history file
 */
interface TradeRecord {
  id: string;
  token: string;
  tokenSymbol?: string;
  
  // Entry
  entryTime: string;
  entryTimestamp: number;
  entryPrice: number;
  entryAmountSol: number;
  entryAmountToken: number;
  entrySignature: string;
  triggeredByWallet: string;  // Which infra wallet triggered this
  
  // Exit (if closed)
  exitTime?: string;
  exitTimestamp?: number;
  exitPrice?: number;
  exitAmountSol?: number;
  exitSignature?: string;
  exitReason?: string;
  sellPercent?: number;  // 50% or 100%
  
  // P&L
  holdDurationMinutes?: number;
  pnlPercent?: number;
  pnlSol?: number;
  pnlUsd?: number;
  
  // Status
  status: 'open' | 'partial_exit' | 'closed';
  isPaperTrade: boolean;
}

/**
 * Extended Position with partial sell tracking
 */
interface ExtendedPosition extends Position {
  remainingTokens: number;
  triggeredByWallet: string;
  partialExits: Array<{
    time: number;
    price: number;
    percentSold: number;
    reason: string;
    pnlPercent: number;
  }>;
}

/**
 * TradingExecutor handles entry and exit of positions
 * 
 * Exit Strategy:
 * - 50% profit → sell 100%
 * - 30% profit → sell 50%
 * - 20% loss → sell 100%
 */
export class TradingExecutor {
  private wallet: Keypair;
  private connection: Connection;
  private marketDataService: MarketDataService;
  
  // Track open positions
  private positions: Map<string, ExtendedPosition> = new Map();
  
  // Track daily P&L
  private dailyPnl: number = 0;
  private dailyTradeCount: number = 0;
  private lastResetDate: string = new Date().toISOString().split('T')[0];
  
  // Trade history file path
  private historyDir: string;
  private historyFile: string;

  constructor() {
    this.marketDataService = new MarketDataService();
    this.connection = new Connection(config.rpcUrl);
    
    // Setup trade history directory
    this.historyDir = join(__dirname, '..', 'trade-history');
    if (!existsSync(this.historyDir)) {
      mkdirSync(this.historyDir, { recursive: true });
    }
    this.historyFile = join(this.historyDir, `trades_${new Date().toISOString().split('T')[0]}.json`);
    
    // Initialize wallet (if live trading enabled)
    if (config.enableLiveTrading) {
      try {
        const seedPhrase = config.copyWalletPrivateKey; // Actually contains seed phrase
        const privateKeyStr = process.env.COPY_WALLET_PRIVATE_KEY; // Optional base58 private key
        
        if (seedPhrase) {
          // Try to load from seed phrase
          const trimmed = seedPhrase.trim();
          
          // Validate seed phrase
          if (!bip39.validateMnemonic(trimmed)) {
            throw new Error('Invalid seed phrase format. Must be 12 or 24 words.');
          }
          
          // Derive keypair from seed phrase (Solana derivation path)
          const seed = bip39.mnemonicToSeedSync(trimmed);
          const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
          this.wallet = Keypair.fromSeed(derivedSeed);
          
          logger.info(`[TradingExecutor] 💰 LIVE TRADING ENABLED`);
          logger.info(`[TradingExecutor] ✅ Wallet loaded from seed phrase`);
          logger.info(`[TradingExecutor] Wallet: ${this.wallet.publicKey.toBase58()}`);
        } else if (privateKeyStr) {
          // Fallback to base58 private key
          const secretKey = bs58.decode(privateKeyStr);
          this.wallet = Keypair.fromSecretKey(secretKey);
          logger.info(`[TradingExecutor] 💰 LIVE TRADING ENABLED`);
          logger.info(`[TradingExecutor] ✅ Wallet loaded from private key`);
          logger.info(`[TradingExecutor] Wallet: ${this.wallet.publicKey.toBase58()}`);
        } else {
          throw new Error('Neither COPY_WALLET_SEED_PHRASE nor COPY_WALLET_PRIVATE_KEY found in .env');
        }
      } catch (error) {
        logger.error('[TradingExecutor] Failed to load wallet:', error);
        logger.error('[TradingExecutor] Please check COPY_WALLET_SEED_PHRASE in .env');
        throw error;
      }
    } else {
      this.wallet = Keypair.generate();
      logger.info('[TradingExecutor] 📄 Paper trading mode - no real trades will be executed');
    }
    
    logger.info(`[TradingExecutor] 📊 Trade history: ${this.historyFile}`);

    // Monitor positions every 10 seconds for faster response
    setInterval(() => this.monitorPositions(), 10000);
    
    // Reset daily stats at midnight
    setInterval(() => this.resetDailyStatsIfNeeded(), 60000);
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

      const entryAmountSol = config.entry.buyAmountSol;
      const entryPrice = stabilization.currentPrice;
      const triggeredByWallet = event.infraWalletBuys[0]?.wallet || 'unknown';

      logger.info(`[TradingExecutor] 🎯 ENTERING POSITION: ${event.tokenSymbol || event.token.slice(0, 8)}`);
      logger.info(`  📍 Token: ${event.token}`);
      logger.info(`  💵 Amount: ${entryAmountSol} SOL`);
      logger.info(`  💰 Price: $${entryPrice.toFixed(8)}`);
      logger.info(`  👛 Triggered by wallet: ${triggeredByWallet.slice(0, 8)}...`);
      logger.info(`  📅 Time: ${new Date().toISOString()}`);

      let signature: string;
      let amountToken: number;

      if (config.enableLiveTrading) {
        try {
          // Real trade via Jupiter
          const result = await this.executeJupiterSwap(
            SOL_MINT,
            event.token,
            entryAmountSol * 1e9, // Convert to lamports
            config.entry.maxSlippageBps
          );
          signature = result.signature;
          // outputAmount is in raw token units (with decimals)
          // We'll store it as-is and use actual wallet balance for exits
          amountToken = result.outputAmount;
          logger.info(`[TradingExecutor] ✅ LIVE TRADE EXECUTED: ${signature}`);
          logger.info(`[TradingExecutor] Received: ${amountToken} raw token units`);
        } catch (jupiterError: any) {
          logger.error(`[TradingExecutor] ❌ Jupiter swap failed: ${jupiterError.message}`);
          logger.warn(`[TradingExecutor] ⚠️  Falling back to paper trade for this position`);
          // Fallback to paper trading if Jupiter fails
          signature = 'PAPER_FALLBACK_' + Date.now();
          amountToken = (entryAmountSol * 100) / entryPrice; // Assume SOL = $100
          logger.info('[TradingExecutor] 📄 Paper trade (Jupiter failed)');
        }
      } else {
        // Paper trading
        signature = 'PAPER_' + Date.now();
        amountToken = (entryAmountSol * 100) / entryPrice; // Assume SOL = $100
        logger.info('[TradingExecutor] 📄 Paper trade (simulated)');
      }

      // Create position
      const position: ExtendedPosition = {
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
        remainingTokens: amountToken,
        triggeredByWallet,
        partialExits: [],
      };

      this.positions.set(event.token, position);
      this.dailyTradeCount++;

      // Save to trade history
      this.saveTradeRecord({
        id: position.id,
        token: position.token,
        tokenSymbol: position.tokenSymbol,
        entryTime: new Date().toISOString(),
        entryTimestamp: position.entryTime,
        entryPrice,
        entryAmountSol,
        entryAmountToken: amountToken,
        entrySignature: signature,
        triggeredByWallet,
        status: 'open',
        isPaperTrade: !config.enableLiveTrading,
      });

      logger.info(`[TradingExecutor] ✅ Position opened: ${position.id}`);
      logger.info(`  🪙 Tokens: ${amountToken.toFixed(4)}`);
      logger.info(`  📝 Signature: ${signature}`);

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
      if (position.status === 'closed') {
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
   * Check if position should be exited - TIERED EXIT STRATEGY
   * - 50% profit → sell 100%
   * - 30% profit → sell 50% (first time only)
   * - 20% loss → sell 100%
   */
  private async checkExitConditions(position: ExtendedPosition): Promise<void> {
    const currentPrice = await this.getCurrentPrice(position.token);
    if (currentPrice === 0) return;
    
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

    const holdTimeSeconds = Date.now() / 1000 - position.entryTime;
    const holdTimeMinutes = holdTimeSeconds / 60;
    
    // Check for partial exit already done
    const hasPartialExit = position.partialExits.length > 0;

    // === TIERED EXIT STRATEGY ===
    
    // 1. 50% profit → sell 100%
    if (pnlPercent >= 50) {
      await this.exitPosition(position, 100, `🚀 50% PROFIT TARGET HIT (+${pnlPercent.toFixed(1)}%)`);
      return;
    }

    // 2. 30% profit → sell 50% (first time only)
    if (pnlPercent >= 30 && !hasPartialExit) {
      await this.exitPosition(position, 50, `📈 30% PROFIT - Taking 50% off (+${pnlPercent.toFixed(1)}%)`);
      return;
    }

    // 3. 20% loss → sell 100%
    if (pnlPercent <= -20) {
      await this.exitPosition(position, 100, `🛑 STOP LOSS HIT (${pnlPercent.toFixed(1)}%)`);
      return;
    }

    // Log position status periodically (every 30 seconds via monitor interval)
    if (position.status === 'open') {
      logger.info(
        `[Position] ${position.tokenSymbol || position.token.slice(0, 8)}: ` +
        `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% | ` +
        `$${currentPrice.toFixed(8)} | ` +
        `Hold: ${holdTimeMinutes.toFixed(1)}m | ` +
        `Remaining: ${(position.remainingTokens / position.entryAmountToken * 100).toFixed(0)}%`
      );
    }
  }

  /**
   * Exit a position (full or partial)
   */
  private async exitPosition(
    position: ExtendedPosition,
    sellPercent: number,
    reason: string
  ): Promise<void> {
    try {
      const tokensToSell = position.remainingTokens * (sellPercent / 100);
      const currentPrice = position.currentPrice!;
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const holdTimeMinutes = (Date.now() / 1000 - position.entryTime) / 60;

      logger.info(`[TradingExecutor] 🚪 EXITING POSITION: ${position.tokenSymbol || position.token.slice(0, 8)}`);
      logger.info(`  📍 Token: ${position.token}`);
      logger.info(`  📊 Sell: ${sellPercent}% (${tokensToSell.toFixed(4)} tokens)`);
      logger.info(`  💡 Reason: ${reason}`);
      logger.info(`  💵 Entry: $${position.entryPrice.toFixed(8)}`);
      logger.info(`  💰 Exit: $${currentPrice.toFixed(8)}`);
      logger.info(`  📈 P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
      logger.info(`  ⏱️ Hold time: ${holdTimeMinutes.toFixed(1)} minutes`);
      logger.info(`  👛 Triggered by: ${position.triggeredByWallet.slice(0, 8)}...`);

      let signature: string;
      let exitAmountSol: number;

      if (config.enableLiveTrading) {
        // Real trade via Jupiter
        // Get actual token balance to ensure we have the right amount
        const tokenBalanceRaw = await this.getTokenBalanceRaw(position.token);
        
        if (tokenBalanceRaw === 0) {
          logger.warn(`[TradingExecutor] No token balance found for ${position.token.slice(0, 8)}`);
          // Fallback to paper trade
          signature = 'PAPER_EXIT_NO_BALANCE_' + Date.now();
          const solValue = (tokensToSell * currentPrice) / 100;
          exitAmountSol = solValue * 0.98;
          logger.info('[TradingExecutor] 📄 Paper exit (no balance found)');
        } else {
          // Calculate how much to sell in raw units
          const sellAmountRaw = Math.floor(tokenBalanceRaw * (sellPercent / 100));
          
          const result = await this.executeJupiterSwap(
            position.token,
            SOL_MINT,
            sellAmountRaw, // Raw token amount (with decimals)
            config.entry.maxSlippageBps
          );
          signature = result.signature;
          exitAmountSol = result.outputAmount / 1e9; // Convert from lamports
          logger.info(`[TradingExecutor] ✅ LIVE SELL EXECUTED: ${signature}`);
        }
      } else {
        // Paper trading
        signature = 'PAPER_EXIT_' + Date.now();
        const solValue = (tokensToSell * currentPrice) / 100; // Assume SOL = $100
        exitAmountSol = solValue * 0.98; // 2% slippage
        logger.info('[TradingExecutor] 📄 Paper exit (simulated)');
      }

      // Calculate realized P&L for this exit
      const proportionSold = tokensToSell / position.entryAmountToken;
      const entryCostSol = position.entryAmountSol * proportionSold;
      const realizedPnlSol = exitAmountSol - entryCostSol;
      const realizedPnlUsd = realizedPnlSol * 100; // Assume SOL = $100

      // Update position
      position.remainingTokens -= tokensToSell;
      position.partialExits.push({
        time: Date.now() / 1000,
        price: currentPrice,
        percentSold: sellPercent,
        reason,
        pnlPercent,
      });

      // Update daily P&L
      this.dailyPnl += realizedPnlSol;

      // Determine final status
      if (sellPercent === 100 || position.remainingTokens <= 0) {
        position.status = 'closed';
        position.exitTime = Date.now() / 1000;
        position.exitPrice = currentPrice;
        position.exitAmountSol = exitAmountSol;
        position.exitSignature = signature;
        position.exitReason = reason;
        position.realizedPnlSol = realizedPnlSol;
        position.realizedPnlPercent = pnlPercent;
      }

      // Save to trade history
      this.saveTradeRecord({
        id: position.id + (sellPercent < 100 ? '_partial' : '_closed'),
        token: position.token,
        tokenSymbol: position.tokenSymbol,
        entryTime: new Date(position.entryTime * 1000).toISOString(),
        entryTimestamp: position.entryTime,
        entryPrice: position.entryPrice,
        entryAmountSol: position.entryAmountSol,
        entryAmountToken: position.entryAmountToken,
        entrySignature: position.entrySignature,
        triggeredByWallet: position.triggeredByWallet,
        exitTime: new Date().toISOString(),
        exitTimestamp: Date.now() / 1000,
        exitPrice: currentPrice,
        exitAmountSol,
        exitSignature: signature,
        exitReason: reason,
        sellPercent,
        holdDurationMinutes: holdTimeMinutes,
        pnlPercent,
        pnlSol: realizedPnlSol,
        pnlUsd: realizedPnlUsd,
        status: sellPercent === 100 ? 'closed' : 'partial_exit',
        isPaperTrade: !config.enableLiveTrading,
      });

      logger.info(`[TradingExecutor] ✅ Exit complete`);
      logger.info(`  💵 Received: ${exitAmountSol.toFixed(4)} SOL`);
      logger.info(`  💰 Realized P&L: ${realizedPnlSol >= 0 ? '+' : ''}${realizedPnlSol.toFixed(4)} SOL ($${realizedPnlUsd.toFixed(2)})`);
      logger.info(`  📊 Daily P&L: ${this.dailyPnl >= 0 ? '+' : ''}${this.dailyPnl.toFixed(4)} SOL`);
      
      if (position.status === 'closed') {
        logger.info(`  ✅ Position fully closed`);
      } else {
        logger.info(`  ⏳ Remaining: ${((position.remainingTokens / position.entryAmountToken) * 100).toFixed(0)}%`);
      }
    } catch (error) {
      logger.error('[TradingExecutor] Error exiting position:', error);
    }
  }

  /**
   * Execute swap via Jupiter Ultra API
   * Uses the two-step process: GET /order then POST /execute
   */
  private async executeJupiterSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<{ signature: string; outputAmount: number }> {
    try {
      if (!config.jupiterApiKey) {
        throw new Error('JUPITER_API_KEY not found in .env');
      }

      logger.info(`[Jupiter] Getting order: ${inputMint.slice(0, 8)} → ${outputMint.slice(0, 8)}`);
      
      // Log amount appropriately based on input type
      if (inputMint === SOL_MINT) {
        logger.info(`[Jupiter] Amount: ${amount} lamports (${amount / 1e9} SOL)`);
      } else {
        logger.info(`[Jupiter] Amount: ${amount} raw token units`);
      }
      
      const taker = this.wallet.publicKey.toBase58();
      const amountStr = Math.floor(amount).toString();
      
      // 1. Get order from Jupiter Ultra API
      const orderParams = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amountStr,
        taker,
      });
      
      const orderUrl = `${config.jupiterApiUrl}/ultra/v1/order?${orderParams}`;
      logger.debug(`[Jupiter] Order URL: ${orderUrl}`);
      
      const orderResponse = await fetch(orderUrl, {
        method: 'GET',
        headers: {
          'x-api-key': config.jupiterApiKey,
          'Accept': 'application/json',
        },
      });
      
      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        logger.error(`[Jupiter] Order failed: ${orderResponse.status} ${orderResponse.statusText}`);
        logger.error(`[Jupiter] Error response: ${errorText}`);
        throw new Error(`Order failed: ${orderResponse.status} - ${errorText}`);
      }
      
      const orderData = await orderResponse.json() as {
        transaction?: string;
        requestId?: string;
        outAmount?: string;
        inAmount?: string;
        errorCode?: number;
        errorMessage?: string;
        [key: string]: unknown;
      };
      
      // Check for errors in response
      if (orderData.errorCode) {
        logger.error(`[Jupiter] Order error: ${orderData.errorCode} - ${orderData.errorMessage}`);
        throw new Error(`Order error: ${orderData.errorMessage || 'Unknown error'}`);
      }
      
      if (!orderData.transaction || !orderData.requestId) {
        throw new Error('Invalid order response: missing transaction or requestId');
      }
      
      logger.info(`[Jupiter] Order received: ${orderData.outAmount} output, requestId: ${orderData.requestId}`);
      
      // 2. Deserialize and sign transaction
      const transactionBuf = Buffer.from(orderData.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.wallet]);
      
      // 3. Serialize signed transaction
      const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString('base64');
      
      // 4. Execute via Jupiter Ultra API
      const executeUrl = `${config.jupiterApiUrl}/ultra/v1/execute`;
      logger.debug(`[Jupiter] Executing swap with requestId: ${orderData.requestId}`);
      
      const executeResponse = await fetch(executeUrl, {
        method: 'POST',
        headers: {
          'x-api-key': config.jupiterApiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction: signedTransactionBase64,
          requestId: orderData.requestId,
        }),
      });
      
      if (!executeResponse.ok) {
        const errorText = await executeResponse.text();
        logger.error(`[Jupiter] Execute failed: ${executeResponse.status} ${executeResponse.statusText}`);
        logger.error(`[Jupiter] Error response: ${errorText}`);
        throw new Error(`Execute failed: ${executeResponse.status} - ${errorText}`);
      }
      
      const executeData = await executeResponse.json() as {
        status: string;
        signature?: string;
        error?: string;
        code?: number;
        outputAmountResult?: string;
        [key: string]: unknown;
      };
      
      if (executeData.status !== 'Success' || !executeData.signature) {
        logger.error(`[Jupiter] Execution failed: ${executeData.status} - ${executeData.error || 'Unknown error'}`);
        throw new Error(`Execution failed: ${executeData.error || executeData.status}`);
      }
      
      logger.info(`[Jupiter] ✅ Swap executed: ${executeData.signature}`);
      
      // Parse output amount (use result if available, otherwise use order estimate)
      const outputAmount = executeData.outputAmountResult 
        ? parseInt(executeData.outputAmountResult)
        : parseInt(orderData.outAmount || '0');
      
      return {
        signature: executeData.signature,
        outputAmount,
      };
    } catch (error) {
      logger.error('[Jupiter] Swap error:', error);
      throw error;
    }
  }

  /**
   * Save trade record to history file
   */
  private saveTradeRecord(record: TradeRecord): void {
    try {
      // Read existing records
      let records: TradeRecord[] = [];
      if (existsSync(this.historyFile)) {
        const content = readFileSync(this.historyFile, 'utf-8');
        records = JSON.parse(content);
      }
      
      // Add new record
      records.push(record);
      
      // Write back
      writeFileSync(this.historyFile, JSON.stringify(records, null, 2));
      
      // Also append to a simple log file for easy viewing
      const logLine = `${record.exitTime || record.entryTime} | ${record.status} | ${record.tokenSymbol || record.token.slice(0, 8)} | ` +
        `Entry: $${record.entryPrice.toFixed(8)} | ` +
        (record.exitPrice ? `Exit: $${record.exitPrice.toFixed(8)} | ` : '') +
        (record.pnlPercent !== undefined ? `P&L: ${record.pnlPercent >= 0 ? '+' : ''}${record.pnlPercent.toFixed(2)}% | ` : '') +
        (record.holdDurationMinutes !== undefined ? `Hold: ${record.holdDurationMinutes.toFixed(1)}m | ` : '') +
        `Wallet: ${record.triggeredByWallet.slice(0, 8)} | ` +
        (record.isPaperTrade ? 'PAPER' : 'LIVE') + '\n';
      
      const logFile = join(this.historyDir, 'trades.log');
      appendFileSync(logFile, logLine);
      
      logger.info(`[TradingExecutor] 📝 Trade saved to ${this.historyFile}`);
    } catch (error) {
      logger.error('[TradingExecutor] Error saving trade record:', error);
    }
  }

  /**
   * Get current price for a token using real market data
   */
  private async getCurrentPrice(token: string): Promise<number> {
    try {
      const marketData = await this.marketDataService.fetchMarketData(token);
      if (marketData) {
        return marketData.priceUsd;
      }
      logger.warn(`[TradingExecutor] Could not fetch price for ${token.slice(0, 8)}`);
      return 0;
    } catch (error) {
      logger.error(`[TradingExecutor] Error fetching price:`, error);
      return 0;
    }
  }

  /**
   * Get raw token balance (with decimals) from wallet
   */
  private async getTokenBalanceRaw(tokenMint: string): Promise<number> {
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { mint: new PublicKey(tokenMint) }
      );

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      // Get the first token account balance (raw amount with decimals)
      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      return parseInt(balance);
    } catch (error) {
      logger.error(`[TradingExecutor] Error getting token balance for ${tokenMint.slice(0, 8)}:`, error);
      return 0;
    }
  }

  /**
   * Check risk limits before entering position
   */
  private async checkRiskLimits(token: string): Promise<{ canTrade: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    if (this.positions.has(token)) {
      const existing = this.positions.get(token)!;
      if (existing.status === 'open') {
        reasons.push('Already have open position in this token');
      }
    }

    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'open').length;
    if (openPositions >= config.entry.maxPositions) {
      reasons.push(`Max positions reached (${openPositions}/${config.entry.maxPositions})`);
    }

    if (this.dailyPnl <= -config.risk.maxDailyLossUsd) {
      reasons.push(`Daily loss limit reached ($${this.dailyPnl.toFixed(2)})`);
    }

    return { canTrade: reasons.length === 0, reasons };
  }

  /**
   * Reset daily stats if new day
   */
  private resetDailyStatsIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      logger.info(`[TradingExecutor] 📅 New day - resetting stats`);
      logger.info(`  Previous day P&L: ${this.dailyPnl >= 0 ? '+' : ''}${this.dailyPnl.toFixed(4)} SOL`);
      logger.info(`  Previous day trades: ${this.dailyTradeCount}`);
      
      // Update history file for new day
      this.historyFile = join(this.historyDir, `trades_${today}.json`);
      
      this.dailyPnl = 0;
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
    }
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

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

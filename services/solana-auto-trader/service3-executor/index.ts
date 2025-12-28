// Service 3: Trading Executor
// Executes trades on validated tokens and monitors positions for 2x exit

import { Database } from '../shared/database';
import { DexScreenerClient } from '../shared/dexscreener';
import { JupiterClient } from '../shared/jupiter';
import { Logger } from '../shared/logger';
import { Token, Position } from '../shared/types';

const SERVICE_NAME = 'TRADING-EXECUTOR';
const SCAN_INTERVAL_MS = 5000; // Check for new trades every 5 seconds
const POSITION_CHECK_INTERVAL_MS = 1000; // Check positions every 1 second
const BUY_AMOUNT_SOL = 0.1; // Buy amount in SOL
const PROFIT_TARGET = 100; // 100% = 2x
const MAX_POSITIONS = 3; // Maximum concurrent positions

class TradingExecutorService {
  private running = false;
  private positionCheckInterval: NodeJS.Timeout | null = null;

  async start() {
    Logger.info(SERVICE_NAME, 'Starting Trading Executor Service...');
    
    try {
      await Database.connect();
      Logger.success(SERVICE_NAME, 'Database connected');
      
      // Initialize Jupiter client
      JupiterClient.initialize();
      Logger.success(SERVICE_NAME, 'Jupiter client initialized');
      
      this.running = true;
      
      // Start position monitoring in parallel
      this.startPositionMonitoring();
      
      // Start main trading loop
      await this.tradingLoop();
    } catch (error) {
      Logger.error(SERVICE_NAME, 'Failed to start service', error);
      process.exit(1);
    }
  }

  private async tradingLoop() {
    while (this.running) {
      try {
        await this.checkForNewTrades();
        
        // Wait before next check
        await this.sleep(SCAN_INTERVAL_MS);
      } catch (error) {
        Logger.error(SERVICE_NAME, 'Error in trading loop', error);
        await this.sleep(5000);
      }
    }
  }

  private startPositionMonitoring() {
    this.positionCheckInterval = setInterval(async () => {
      try {
        await this.checkPositions();
      } catch (error) {
        Logger.error(SERVICE_NAME, 'Error checking positions', error);
      }
    }, POSITION_CHECK_INTERVAL_MS);
    
    Logger.info(SERVICE_NAME, 'Position monitoring started (checking every 1 second)');
  }

  private async checkForNewTrades() {
    try {
      // Get current active positions
      const activePositions = await Database.getActivePositions();
      
      if (activePositions.length >= MAX_POSITIONS) {
        return; // Already at max positions
      }

      // Get validated tokens that meet criteria
      const validatedTokens = await Database.getValidatedTokens();
      
      if (validatedTokens.length === 0) {
        return; // No tokens ready for trading
      }

      // Filter out tokens we already have positions in
      const activeTokens = new Set(activePositions.map(p => p.tokenAddress));
      const availableTokens = validatedTokens.filter(t => !activeTokens.has(t.address));

      if (availableTokens.length === 0) {
        return; // No new tokens to trade
      }

      // Take the first available token
      const token = availableTokens[0];
      
      Logger.info(SERVICE_NAME, `Found validated token ready for trading: ${token.symbol} (${token.address.substring(0, 8)}...)`);
      
      // Execute buy
      await this.executeBuy(token);

    } catch (error) {
      Logger.error(SERVICE_NAME, 'Error checking for new trades', error);
    }
  }

  private async executeBuy(token: Token) {
    try {
      Logger.info(SERVICE_NAME, `Executing BUY for ${token.symbol}...`);
      Logger.info(SERVICE_NAME, `  Amount: ${BUY_AMOUNT_SOL} SOL`);
      Logger.info(SERVICE_NAME, `  Entry Price: $${token.currentPrice}`);

      // Get quote first to estimate output
      const quote = await JupiterClient.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        token.address,
        BUY_AMOUNT_SOL * 1e9, // Convert to lamports
        100 // 1% slippage
      );

      if (!quote) {
        Logger.error(SERVICE_NAME, 'Failed to get quote');
        return;
      }

      const estimatedTokenAmount = parseFloat(quote.outAmount) / Math.pow(10, token.decimals || 9);
      Logger.info(SERVICE_NAME, `  Estimated tokens: ${estimatedTokenAmount.toFixed(2)}`);

      // Execute the swap
      const signature = await JupiterClient.buyToken(token.address, BUY_AMOUNT_SOL);

      if (!signature) {
        Logger.error(SERVICE_NAME, 'Failed to execute buy transaction');
        return;
      }

      Logger.success(SERVICE_NAME, `BUY executed successfully!`);
      Logger.info(SERVICE_NAME, `  Transaction: ${signature}`);

      // Create position
      const position: Position = {
        tokenAddress: token.address,
        entryPrice: token.currentPrice!,
        entryTime: new Date(),
        solAmount: BUY_AMOUNT_SOL,
        tokenAmount: estimatedTokenAmount,
        status: 'active'
      };

      await Database.savePosition(position);
      Logger.success(SERVICE_NAME, `Position opened for ${token.symbol}`);

    } catch (error) {
      Logger.error(SERVICE_NAME, `Error executing buy for ${token.address}`, error);
    }
  }

  private async checkPositions() {
    try {
      const positions = await Database.getActivePositions();
      
      if (positions.length === 0) {
        return;
      }

      for (const position of positions) {
        await this.checkPosition(position);
      }
    } catch (error) {
      // Don't log every error to avoid spam
      // Logger.error(SERVICE_NAME, 'Error in checkPositions', error);
    }
  }

  private async checkPosition(position: Position) {
    try {
      // Get current token data
      const tokenData = await DexScreenerClient.getTokenInfo(position.tokenAddress);
      
      if (!tokenData) {
        return;
      }

      const currentPrice = parseFloat(tokenData.priceUsd);
      const entryPrice = position.entryPrice;
      const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

      // Update position
      position.currentPrice = currentPrice;
      position.profitPercent = profitPercent;

      // Check if we hit 2x (100% profit)
      if (profitPercent >= PROFIT_TARGET) {
        Logger.success(SERVICE_NAME, `🎯 PROFIT TARGET HIT! ${profitPercent.toFixed(2)}% profit on ${position.tokenAddress.substring(0, 8)}...`);
        await this.executeSell(position);
      }

    } catch (error) {
      // Silent fail to avoid log spam
    }
  }

  private async executeSell(position: Position) {
    try {
      const token = await Database.getToken(position.tokenAddress);
      if (!token) {
        Logger.error(SERVICE_NAME, 'Token not found in database');
        return;
      }

      Logger.info(SERVICE_NAME, `Executing SELL for ${token.symbol}...`);
      Logger.info(SERVICE_NAME, `  Entry Price: $${position.entryPrice}`);
      Logger.info(SERVICE_NAME, `  Current Price: $${position.currentPrice}`);
      Logger.info(SERVICE_NAME, `  Profit: ${position.profitPercent?.toFixed(2)}%`);

      // Execute the swap
      const signature = await JupiterClient.sellToken(
        position.tokenAddress,
        position.tokenAmount,
        token.decimals || 9
      );

      if (!signature) {
        Logger.error(SERVICE_NAME, 'Failed to execute sell transaction');
        return;
      }

      Logger.success(SERVICE_NAME, `SELL executed successfully!`);
      Logger.info(SERVICE_NAME, `  Transaction: ${signature}`);

      // Close position
      await Database.closePosition(position.tokenAddress, position.currentPrice!);
      
      Logger.success(SERVICE_NAME, `Position closed for ${token.symbol} with ${position.profitPercent?.toFixed(2)}% profit`);

    } catch (error) {
      Logger.error(SERVICE_NAME, `Error executing sell for ${position.tokenAddress}`, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    Logger.info(SERVICE_NAME, 'Stopping Trading Executor Service...');
    this.running = false;
    
    if (this.positionCheckInterval) {
      clearInterval(this.positionCheckInterval);
    }
    
    await Database.disconnect();
  }
}

// Start the service
const service = new TradingExecutorService();

process.on('SIGINT', async () => {
  await service.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await service.stop();
  process.exit(0);
});

service.start();

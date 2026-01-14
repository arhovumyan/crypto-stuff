import { Connection } from '@solana/web3.js';
import { WebSocketManager } from './websocket-manager.js';
import { TransactionParser } from './transaction-parser.js';
import { TradeRecorder } from './trade-recorder.js';
import {
  config,
  createLogger,
  connectRedis,
  closeRedis,
  closeDatabase,
  isTransactionProcessed,
  markTransactionProcessed,
} from '@copytrader/shared';

const logger = createLogger('listener-service');

export class ListenerService {
  private wsManager: WebSocketManager;
  private connection: Connection;
  private parser: TransactionParser;
  private recorder: TradeRecorder;
  private isRunning = false;
  private serviceStartTime: number; // Track when service started to ignore old transactions

  constructor() {
    this.wsManager = new WebSocketManager(config.HELIUS_WS_URL);
    this.connection = new Connection(config.HELIUS_RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: config.HELIUS_WS_URL,
    });
    this.parser = new TransactionParser(this.connection);
    this.recorder = new TradeRecorder();
    this.serviceStartTime = Date.now() / 1000; // Unix timestamp in seconds
  }

  async start(): Promise<void> {
    logger.info('Starting Solana Copy Trader - Listener Service');

    try {
      // Connect to Redis (with retry logic)
      logger.info('Connecting to Redis...');
      try {
        await connectRedis(10, 1000); // Try 10 times with 1 second delay
      } catch (error: any) {
        logger.error('❌ Failed to connect to Redis. Cannot start service without Redis.');
        logger.error('');
        logger.error('🔧 Please start Redis first, then restart this service:');
        logger.error('   docker-compose up -d redis');
        logger.error('');
        throw new Error('Redis connection required. Service cannot start without Redis.');
      }

      // Connect to WebSocket
      logger.info('Connecting to Helius WebSocket...');
      await this.wsManager.connect();

      // Set up message handler
      this.setupMessageHandler();

      // Get followed wallets from database
      const wallets = await this.recorder.getFollowedWallets();
      
      if (wallets.length === 0) {
        logger.warn('No followed wallets found!');
        logger.info('Add wallets to database OR set LEADER_WALLET_* in .env file');
        return;
      }

      logger.info(`Found ${wallets.length} followed wallets to monitor`);
      logger.info('To change wallets: Edit LEADER_WALLET_* in .env and restart');

      // Subscribe to each wallet
      for (const wallet of wallets) {
        await this.wsManager.subscribeToAccount(wallet);
        logger.info(`Now monitoring wallet: ${wallet}`);
      }

      this.isRunning = true;
      logger.info('Listener service is running and waiting for transactions');
      logger.info('Waiting for transactions...\n');

      // Display stats
      await this.displayStats();
    } catch (error) {
      logger.error({ error }, 'Failed to start listener service');
      throw error;
    }
  }

  private setupMessageHandler(): void {
    this.wsManager.onMessage(async (message) => {
      try {
        // Handle subscription confirmation
        if (message.result !== undefined && !message.method) {
          logger.debug({ subscriptionId: message.result }, 'Subscription confirmed');
          return;
        }

        // Handle log notifications
        if (message.method === 'logsNotification') {
          await this.handleLogNotification(message);
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error handling WebSocket message');
      }
    });
  }

  private async handleLogNotification(message: any): Promise<void> {
    const { params } = message;
    if (!params || !params.result) return;

    const { signature, err } = params.result.value;

    // Ignore failed transactions
    if (err) {
      logger.debug({ signature, err }, 'Transaction failed, skipping');
      return;
    }

    // Check if we've already processed this transaction
    if (await isTransactionProcessed(signature)) {
      logger.debug({ signature }, 'Transaction already processed');
      return;
    }

    // Fetch transaction to check block time - only process NEW transactions
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        logger.debug({ signature }, 'Transaction not found, skipping');
        return;
      }

      // Get transaction block time (in seconds since Unix epoch)
      const txBlockTime = tx.blockTime;
      if (!txBlockTime) {
        logger.debug({ signature }, 'Transaction has no block time, skipping');
        return;
      }

      // Only process transactions that happened AFTER service started
      // This prevents processing old/historical transactions
      if (txBlockTime < this.serviceStartTime) {
        logger.debug(
          { 
            signature, 
            txBlockTime: new Date(txBlockTime * 1000).toISOString(),
            serviceStartTime: new Date(this.serviceStartTime * 1000).toISOString(),
            ageSeconds: this.serviceStartTime - txBlockTime
          }, 
          'Transaction is older than service start time, skipping'
        );
        return;
      }

      // Also skip transactions older than 5 minutes as a safety measure
      const currentTime = Date.now() / 1000;
      const MAX_TRANSACTION_AGE_SECONDS = 5 * 60; // 5 minutes
      if (currentTime - txBlockTime > MAX_TRANSACTION_AGE_SECONDS) {
        logger.debug(
          { 
            signature, 
            txBlockTime: new Date(txBlockTime * 1000).toISOString(),
            ageSeconds: currentTime - txBlockTime
          }, 
          'Transaction is too old (>5 minutes), skipping'
        );
        return;
      }
    } catch (error) {
      logger.warn({ error, signature }, 'Failed to fetch transaction for time check, skipping');
      return;
    }

    logger.info(`Transaction detected: ${signature}`);

    // Mark as processed immediately (idempotency)
    await markTransactionProcessed(signature);

    // Parse transaction for each followed wallet
    const wallets = await this.recorder.getFollowedWallets();
    
    for (const wallet of wallets) {
      const swap = await this.parser.parseSwap(signature, wallet);
      
      if (swap) {
        // Record to database
        const trade = await this.recorder.recordLeaderTrade(swap);
        
        if (trade) {
          this.logTradeDetection(trade);
        }
      }
    }
  }

  private logTradeDetection(trade: any): void {
    // Handle both snake_case (from DB) and camelCase (from code)
    const leaderWallet = trade.leader_wallet || trade.leaderWallet;
    const signature = trade.signature;
    const tokenInMint = trade.token_in_mint || trade.tokenInMint;
    const tokenInSymbol = trade.token_in_symbol || trade.tokenInSymbol;
    const tokenOutMint = trade.token_out_mint || trade.tokenOutMint;
    const tokenOutSymbol = trade.token_out_symbol || trade.tokenOutSymbol;
    const amountIn = trade.amount_in || trade.amountIn;
    const amountOut = trade.amount_out || trade.amountOut;
    
    const tokenInDisplay = this.getTokenSymbol(tokenInMint, tokenInSymbol);
    const tokenOutDisplay = this.getTokenSymbol(tokenOutMint, tokenOutSymbol);
    const action = tokenOutDisplay === 'SOL' ? '🔴 SELL' : '🟢 BUY';
    
    logger.info('');
    logger.info('─────────────────────────────────────────────────────────────────────────────────');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`${action} DETECTED`);
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`Wallet:     ${leaderWallet}`);
    logger.info(`Token:      ${tokenInDisplay} → ${tokenOutDisplay}`);
    logger.info(`Amount:     ${Number(amountIn).toFixed(4)} ${tokenInDisplay} → ${Number(amountOut).toFixed(6)} ${tokenOutDisplay}`);
    logger.info(`Signature:  ${signature}`);
    logger.info('═══════════════════════════════════════════════════');
    logger.info('─────────────────────────────────────────────────────────────────────────────────');
    logger.info('');
  }

  private getTokenSymbol(mint: string, symbol: string | null | undefined): string {
    // SOL native mint
    if (mint === 'So11111111111111111111111111111111111111112') {
      return 'SOL';
    }
    // Use symbol if available, otherwise show truncated mint
    if (symbol && symbol !== 'Unknown') {
      return symbol;
    }
    return mint.slice(0, 4) + '...' + mint.slice(-4);
  }

  private async displayStats(): Promise<void> {
    const stats = await this.recorder.getWalletStats();
    
    logger.info('\n========== Wallet Statistics ==========');
    logger.info('─────────────────────────────────────────────────');
    
    for (const stat of stats) {
      const status = stat.enabled ? 'ENABLED' : 'DISABLED';
      logger.info(
        `${status} | ${stat.address} | Trades: ${stat.trade_count} | Last: ${
          stat.last_detected_trade 
            ? new Date(stat.last_detected_trade).toLocaleString()
            : 'Never'
        }`
      );
    }
    
    logger.info('─────────────────────────────────────────────────\n');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping listener service...');
    this.isRunning = false;

    await this.wsManager.close();
    await closeRedis();
    await closeDatabase();

    logger.info('✅ Listener service stopped');
  }
}

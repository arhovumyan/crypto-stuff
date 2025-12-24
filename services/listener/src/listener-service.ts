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

  constructor() {
    this.wsManager = new WebSocketManager(config.HELIUS_WS_URL);
    this.connection = new Connection(config.HELIUS_RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: config.HELIUS_WS_URL,
    });
    this.parser = new TransactionParser(this.connection);
    this.recorder = new TradeRecorder();
  }

  async start(): Promise<void> {
    logger.info('Starting Solana Copy Trader - Listener Service');

    try {
      // Connect to Redis
      logger.info('Connecting to Redis...');
      await connectRedis();

      // Connect to WebSocket
      logger.info('Connecting to Helius WebSocket...');
      await this.wsManager.connect();

      // Set up message handler
      this.setupMessageHandler();

      // Get followed wallets from database
      const wallets = await this.recorder.getFollowedWallets();
      
      if (wallets.length === 0) {
        logger.warn('⚠️  No followed wallets found in database!');
        logger.info('Make sure to run the database migrations first.');
        return;
      }

      logger.info(`Found ${wallets.length} followed wallets to monitor`);

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
        logger.error({ error, message }, 'Error handling message');
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
    logger.info('');
    logger.info('═══════════════════════════════════════════════════');
    logger.info('🎯 TRADE DETECTED');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`Leader:     ${trade.leaderWallet.slice(0, 8)}...${trade.leaderWallet.slice(-4)}`);
    logger.info(`Signature:  ${trade.signature.slice(0, 16)}...`);
    logger.info(`Token In:   ${trade.tokenInSymbol || 'Unknown'} (${trade.amountIn})`);
    logger.info(`Token Out:  ${trade.tokenOutSymbol || 'Unknown'} (${trade.amountOut})`);
    logger.info(`DEX:        ${trade.dexProgram?.slice(0, 8) || 'Unknown'}...`);
    logger.info(`Time:       ${new Date(trade.blockTime).toISOString()}`);
    logger.info('═══════════════════════════════════════════════════');
    logger.info('');
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

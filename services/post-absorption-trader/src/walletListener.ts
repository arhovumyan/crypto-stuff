import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { config } from './config';
import logger from './logger';
import { Transaction } from './types';

/**
 * WalletListener monitors infrastructure wallets for transactions
 * This is similar to copy-executor's listening mechanism but focused on detecting absorption
 */
export class WalletListener {
  private connection: Connection;
  private subscriptions: Map<string, number> = new Map();
  private transactionHandlers: Array<(tx: Transaction) => void> = [];

  constructor() {
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.wsUrl,
    });
  }

  /**
   * Start listening to all infrastructure wallets
   */
  async start(): Promise<void> {
    logger.info('[WalletListener] Starting wallet listener...');
    logger.info(`[WalletListener] Monitoring ${config.infraWallets.length} infrastructure wallets`);

    for (const wallet of config.infraWallets) {
      await this.subscribeToWallet(wallet);
    }

    logger.info('[WalletListener] All wallets subscribed');
  }

  /**
   * Subscribe to a specific wallet's transactions
   */
  private async subscribeToWallet(walletAddress: string): Promise<void> {
    try {
      const publicKey = new PublicKey(walletAddress);
      
      logger.info(`[WalletListener] Subscribing to wallet: ${walletAddress.slice(0, 8)}...`);

      const subscriptionId = this.connection.onLogs(
        publicKey,
        async (logs, _context) => {
          try {
            await this.handleWalletLogs(walletAddress, logs.signature);
          } catch (error) {
            logger.error('[WalletListener] Error handling logs:', error);
          }
        },
        'confirmed'
      );

      this.subscriptions.set(walletAddress, subscriptionId);
      logger.info(`[WalletListener] Subscribed to ${walletAddress.slice(0, 8)}... (ID: ${subscriptionId})`);
    } catch (error) {
      logger.error(`[WalletListener] Failed to subscribe to wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Handle transaction logs from a wallet
   */
  private async handleWalletLogs(walletAddress: string, signature: string): Promise<void> {
    try {
      // Fetch the full transaction
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta) {
        return;
      }

      // Parse the transaction to extract trade information
      const parsedTx = await this.parseTransaction(tx, walletAddress);
      
      if (parsedTx) {
        logger.info(`[WalletListener] Infra wallet ${walletAddress.slice(0, 8)}... ${parsedTx.type.toUpperCase()}: ${parsedTx.tokenSymbol || parsedTx.token.slice(0, 8)} - $${parsedTx.amountUsd.toFixed(2)}`);
        
        // Notify all handlers
        this.transactionHandlers.forEach(handler => handler(parsedTx));
      }
    } catch (error) {
      logger.error(`[WalletListener] Error handling wallet logs for ${signature}:`, error);
    }
  }

  /**
   * Parse a transaction to extract trading information
   */
  private async parseTransaction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string
  ): Promise<Transaction | null> {
    try {
      if (!tx.meta || !tx.blockTime) {
        return null;
      }

      const { preTokenBalances, postTokenBalances } = tx.meta;

      if (!preTokenBalances || !postTokenBalances) {
        return null;
      }

      // Find token balance changes for this wallet
      for (let i = 0; i < preTokenBalances.length; i++) {
        const preBal = preTokenBalances[i];
        const postBal = postTokenBalances.find(
          (post) => post.accountIndex === preBal.accountIndex
        );

        if (!postBal || preBal.owner !== walletAddress) {
          continue;
        }

        const preAmount = preBal.uiTokenAmount.uiAmount || 0;
        const postAmount = postBal.uiTokenAmount.uiAmount || 0;
        const change = postAmount - preAmount;

        if (Math.abs(change) < 0.000001) {
          continue; // No significant change
        }

        const token = preBal.mint;
        const type = change > 0 ? 'buy' : 'sell';

        // Get SOL balance change
        const preSOL = (tx.meta.preBalances[0] || 0) / 1e9;
        const postSOL = (tx.meta.postBalances[0] || 0) / 1e9;
        const solChange = Math.abs(postSOL - preSOL);

        // Estimate USD value (we'll enhance this with real price data later)
        const amountUsd = solChange * 100; // Rough estimate, assuming SOL = $100

        return {
          signature: tx.transaction.signatures[0],
          blockTime: tx.blockTime,
          slot: tx.slot,
          wallet: walletAddress,
          token,
          type,
          amountToken: Math.abs(change),
          amountSol: solChange,
          amountUsd,
          price: solChange / Math.abs(change),
          priceUsd: amountUsd / Math.abs(change),
        };
      }

      return null;
    } catch (error) {
      logger.error('[WalletListener] Error parsing transaction:', error);
      return null;
    }
  }

  /**
   * Register a handler for new transactions
   */
  onTransaction(handler: (tx: Transaction) => void): void {
    this.transactionHandlers.push(handler);
  }

  /**
   * Fetch historical transactions for a wallet
   */
  async fetchHistoricalTransactions(
    walletAddress: string,
    limit: number = 100
  ): Promise<Transaction[]> {
    try {
      logger.info(`[WalletListener] Fetching historical transactions for ${walletAddress.slice(0, 8)}...`);

      const publicKey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(publicKey, { limit });

      const transactions: Transaction[] = [];

      for (const sig of signatures) {
        const tx = await this.connection.getParsedTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx) {
          const parsed = await this.parseTransaction(tx, walletAddress);
          if (parsed) {
            transactions.push(parsed);
          }
        }
      }

      logger.info(`[WalletListener] Fetched ${transactions.length} transactions`);
      return transactions;
    } catch (error) {
      logger.error(`[WalletListener] Error fetching historical transactions:`, error);
      return [];
    }
  }

  /**
   * Stop listening and cleanup
   */
  async stop(): Promise<void> {
    logger.info('[WalletListener] Stopping wallet listener...');

    for (const [wallet, subscriptionId] of this.subscriptions) {
      try {
        await this.connection.removeOnLogsListener(subscriptionId);
        logger.info(`[WalletListener] Unsubscribed from ${wallet.slice(0, 8)}...`);
      } catch (error) {
        logger.error(`[WalletListener] Error unsubscribing from ${wallet}:`, error);
      }
    }

    this.subscriptions.clear();
    this.transactionHandlers = [];
    logger.info('[WalletListener] Wallet listener stopped');
  }
}

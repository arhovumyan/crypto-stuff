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
  private lastCheckedSignatures: Map<string, string> = new Map(); // wallet -> last signature
  private pollingInterval?: NodeJS.Timeout;

  constructor() {
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: config.wsUrl,
    });
    
    // Log connection details
    logger.info(`[WalletListener] 🔌 RPC: ${config.rpcUrl}`);
    logger.info(`[WalletListener] 🔌 WS: ${config.wsUrl}`);
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
    logger.info('[WalletListener] 👂 Listening for transactions...');
    
    // Start polling as backup (checks every 10 seconds)
    this.startPolling();
  }

  /**
   * Start polling for new transactions (backup to websockets)
   */
  private startPolling(): void {
    logger.info('[WalletListener] 🔄 Starting transaction polling (10s interval)...');
    
    this.pollingInterval = setInterval(async () => {
      for (const wallet of config.infraWallets) {
        try {
          const publicKey = new PublicKey(wallet);
          const signatures = await this.connection.getSignaturesForAddress(publicKey, { limit: 5 });
          
          if (signatures.length === 0) continue;
          
          const latestSig = signatures[0].signature;
          const lastChecked = this.lastCheckedSignatures.get(wallet);
          
          // If this is a new signature we haven't seen
          if (lastChecked !== latestSig) {
            // Process all new signatures since last check
            for (const sigInfo of signatures) {
              if (lastChecked && sigInfo.signature === lastChecked) break;
              
              logger.info(`[WalletListener] 📩 Polling detected new tx for ${wallet}`);
              await this.handleWalletLogs(wallet, sigInfo.signature);
            }
            
            this.lastCheckedSignatures.set(wallet, latestSig);
          }
        } catch (error) {
          logger.error(`[WalletListener] Error polling wallet ${wallet}:`, error);
        }
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Subscribe to a specific wallet's transactions
   */
  private async subscribeToWallet(walletAddress: string): Promise<void> {
    try {
      const publicKey = new PublicKey(walletAddress);
      
      logger.info(`[WalletListener] Subscribing to wallet: ${walletAddress}`);

      const subscriptionId = this.connection.onLogs(
        publicKey,
        async (logs, _context) => {
          try {
            logger.info(`[WalletListener] 🔔 NEW TRANSACTION for ${walletAddress} signature: ${logs.signature}`);
            await this.handleWalletLogs(walletAddress, logs.signature);
          } catch (error) {
            logger.error('[WalletListener] Error handling logs:', error);
          }
        },
        'confirmed'
      );

      this.subscriptions.set(walletAddress, subscriptionId);
      logger.info(`[WalletListener] Subscribed to ${walletAddress} (ID: ${subscriptionId})`);
    } catch (error) {
      logger.error(`[WalletListener] Failed to subscribe to wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Handle transaction logs from a wallet
   */
  private async handleWalletLogs(walletAddress: string, signature: string): Promise<void> {
    try {
      logger.info(`[WalletListener] 🔍 Processing transaction ${signature} for wallet ${walletAddress}`);
      
      // Fetch the full transaction
      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        logger.warn(`[WalletListener] ⚠️ No transaction found for ${signature}`);
        return;
      }

      if (!tx.meta) {
        logger.warn(`[WalletListener] ⚠️ No transaction meta for ${signature}`);
        return;
      }

      logger.info(`[WalletListener] ✅ Transaction fetched, parsing...`);

      // Parse the transaction to extract trade information
      const parsedTx = await this.parseTransaction(tx, walletAddress);
      
      if (parsedTx) {
        logger.info(
          `[WalletListener] 💰 Infra wallet ${walletAddress} ${parsedTx.type.toUpperCase()}: ` +
          `${parsedTx.tokenSymbol || parsedTx.token} - ` +
          `${parsedTx.amountSol.toFixed(4)} SOL`
        );
        
        // Notify all handlers
        this.transactionHandlers.forEach(handler => handler(parsedTx));
      } else {
        logger.info(`[WalletListener] ⏭️ Transaction ${signature} didn't meet criteria (no swap or below minimum)`);
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
      const sig = tx.transaction.signatures[0];
      
      if (!tx.meta || !tx.blockTime) {
        logger.info(`[WalletListener] ❌ ${sig} - No meta or blockTime`);
        return null;
      }

      const { preTokenBalances, postTokenBalances } = tx.meta;

      if (!preTokenBalances || preTokenBalances.length === 0) {
        logger.info(`[WalletListener] ❌ ${sig} - No preTokenBalances (not a token swap)`);
        return null;
      }

      if (!postTokenBalances || postTokenBalances.length === 0) {
        logger.info(`[WalletListener] ❌ ${sig} - No postTokenBalances (not a token swap)`);
        return null;
      }

      // Find the wallet's account index in the transaction
      const walletPubkey = new PublicKey(walletAddress);
      const accountIndex = tx.transaction.message.accountKeys.findIndex(
        (key) => key.pubkey.equals(walletPubkey)
      );

      if (accountIndex === -1) {
        logger.info(`[WalletListener] ❌ ${sig} - Wallet not in account keys`);
        return null; // Wallet not involved in this transaction
      }

      // Get the wallet's SOL balance change (using correct account index)
      // preBalances and postBalances are in lamports, so divide by 1e9 to get SOL
      const preSOL = (tx.meta.preBalances[accountIndex] || 0) / 1e9;
      const postSOL = (tx.meta.postBalances[accountIndex] || 0) / 1e9;
      const solChange = preSOL - postSOL; // BUY: pre > post (positive), SELL: post > pre (negative)

      // Also check for the largest SOL transfer in inner instructions
      // This helps capture the actual swap amount in complex transactions
      let largestTransfer = Math.abs(solChange);
      
      if (tx.meta.innerInstructions) {
        for (const inner of tx.meta.innerInstructions) {
          for (const ix of inner.instructions) {
            // Look for system program transfers (type: "transfer")
            if ('parsed' in ix && ix.parsed?.type === 'transfer') {
              const info = ix.parsed.info;
              // Check if this transfer involves our wallet
              if (info.source === walletAddress || info.destination === walletAddress) {
                const transferAmount = (info.lamports || 0) / 1e9;
                if (transferAmount > largestTransfer) {
                  largestTransfer = transferAmount;
                  logger.info(`[WalletListener] 🔍 ${sig} - Found larger inner transfer: ${transferAmount.toFixed(4)} SOL`);
                }
              }
            }
          }
        }
      }

      logger.info(
        `[WalletListener] 🔎 ${sig} - SOL change: ${solChange.toFixed(4)} (${preSOL.toFixed(4)} → ${postSOL.toFixed(4)}), ` +
        `Largest transfer: ${largestTransfer.toFixed(4)} SOL`
      );

      // CRITICAL LOGIC: In Pump.fun swaps, there are TWO token balance changes:
      // 1. The actual token being traded (e.g., NOMORE67)
      // 2. WSOL (wrapped SOL) - the medium of exchange
      // 
      // When infra wallet SELLS token for WSOL:
      //   - Token balance goes DOWN (sell)
      //   - WSOL balance goes UP (receive)
      //   → We should track this token with the WSOL value
      // 
      // When infra wallet BUYS token with WSOL:
      //   - Token balance goes UP (buy)
      //   - WSOL balance goes DOWN (spend)
      //   → We should also track this token with the WSOL value
      
      const WSOL_MINT = 'So11111111111111111111111111111111111111112';
      
      let tokenChange: any = null;
      let wsolChange: number = 0;
      let checkedAccounts = 0;
      
      // First pass: collect both token and WSOL changes
      for (let i = 0; i < preTokenBalances.length; i++) {
        const preBal = preTokenBalances[i];
        
        if (preBal.owner !== walletAddress) {
          continue;
        }
        
        checkedAccounts++;
        
        const postBal = postTokenBalances.find(
          (post) => post.accountIndex === preBal.accountIndex && post.owner === walletAddress
        );

        if (!postBal) {
          continue;
        }

        const preAmount = preBal.uiTokenAmount.uiAmount || 0;
        const postAmount = postBal.uiTokenAmount.uiAmount || 0;
        const change = postAmount - preAmount;

        if (Math.abs(change) < 0.000001) {
          continue;
        }

        const token = preBal.mint;
        
        if (token === WSOL_MINT) {
          // Track WSOL change (this is the trade value)
          wsolChange = change;
          logger.info(
            `[WalletListener] 💰 ${sig} - WSOL change: ${change > 0 ? '+' : ''}${change.toFixed(4)} WSOL`
          );
        } else {
          // This is the actual token being traded
          tokenChange = {
            mint: token,
            change: change,
            type: change > 0 ? 'buy' : 'sell',
            amountToken: Math.abs(change),
          };
          logger.info(
            `[WalletListener] 🪙 ${sig} - Token change: ${token.slice(0, 8)}... ${change > 0 ? '+' : ''}${change.toFixed(6)}`
          );
        }
      }
      
      // If we have both token and WSOL changes, this is a swap we want to track
      if (tokenChange && Math.abs(wsolChange) > 0) {
        const tradeValueSol = Math.abs(wsolChange);
        
        // Check minimum trade value
        if (tradeValueSol < 0.1) {
          logger.info(
            `[WalletListener] ⏭️  ${sig} - Below minimum: ${tradeValueSol.toFixed(4)} SOL < 0.1 SOL`
          );
          return null;
        }
        
        logger.info(
          `[WalletListener] ✅ ${sig} - Valid swap detected: ` +
          `${tokenChange.type.toUpperCase()} ${tokenChange.mint.slice(0, 8)}... for ${tradeValueSol.toFixed(4)} SOL`
        );
        
        const amountUsd = tradeValueSol * 100; // Rough estimate
        
        return {
          signature: tx.transaction.signatures[0],
          blockTime: tx.blockTime,
          slot: tx.slot,
          wallet: walletAddress,
          token: tokenChange.mint,
          type: tokenChange.type,
          amountToken: tokenChange.amountToken,
          amountSol: tradeValueSol,
          amountUsd,
          price: tradeValueSol / tokenChange.amountToken,
          priceUsd: amountUsd / tokenChange.amountToken,
        };
      }

      // If we found token balances but no valid trade, log why
      if (checkedAccounts === 0) {
        logger.info(
          `[WalletListener] ❌ ${sig} - No token accounts owned by wallet ` +
          `(${preTokenBalances.length} token accounts in tx, but none owned by ${walletAddress})`
        );
      } else if (tokenChange && Math.abs(wsolChange) === 0) {
        logger.info(
          `[WalletListener] ❌ ${sig} - Token change without WSOL change (not a swap)`
        );
      } else if (!tokenChange && Math.abs(wsolChange) > 0) {
        logger.info(
          `[WalletListener] ❌ ${sig} - WSOL-only transaction (no other token involved)`
        );
      } else {
        logger.info(
          `[WalletListener] ❌ ${sig} - Found ${checkedAccounts} token account(s) but no valid swap detected`
        );
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
      logger.info(`[WalletListener] Fetching historical transactions for ${walletAddress}`);

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

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      logger.info('[WalletListener] Stopped polling');
    }

    for (const [wallet, subscriptionId] of this.subscriptions) {
      try {
        await this.connection.removeOnLogsListener(subscriptionId);
        logger.info(`[WalletListener] Unsubscribed from ${wallet}`);
      } catch (error) {
        logger.error(`[WalletListener] Error unsubscribing from ${wallet}:`, error);
      }
    }

    this.subscriptions.clear();
    this.transactionHandlers = [];
    logger.info('[WalletListener] Wallet listener stopped');
  }
}

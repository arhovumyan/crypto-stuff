/**
 * Trade Feed
 * WebSocket streaming of real-time DEX trades from PumpSwap, Raydium, etc.
 */

import WebSocket from 'ws';
import axios from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from './logger.js';
import { RawTrade, PoolState } from './types.js';

const log = createLogger('trade-feed');

// DEX Program IDs
const DEX_PROGRAMS = {
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMP_SWAP: 'PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP',
  PUMP_AMM: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // This is the main Pump.fun AMM program!
  ORCA: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  JUPITER: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
};

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

interface HeliusWebSocketMessage {
  jsonrpc: string;
  method?: string;
  params?: {
    result: {
      signature?: string;
      slot?: number;
      err?: any;
      logs?: string[];
      value?: {
        signature?: string;
        err?: any;
        logs?: string[];
      };
      context?: {
        slot?: number;
      };
    };
    subscription: number;
  };
  result?: number;
  id?: number;
}

export class TradeFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private heliusApiKey: string;
  private rpcUrl: string;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private subscriptionId: number | null = null;
  private poolCache: Map<string, PoolState> = new Map();
  private processedSignatures: Set<string> = new Set();
  private signatureCleanupInterval: NodeJS.Timeout | null = null;
  private walletAddresses: string[] = []; // Wallet addresses to monitor

  constructor(rpcUrl: string, wsUrl: string, heliusApiKey: string, walletAddresses: string[] = []) {
    super();
    this.rpcUrl = rpcUrl;
    this.wsUrl = wsUrl;
    this.heliusApiKey = heliusApiKey;
    this.walletAddresses = walletAddresses;
  }

  /**
   * Connect to WebSocket and start streaming
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Validate API key
      if (!this.heliusApiKey || this.heliusApiKey.trim() === '') {
        const error = new Error(
          'HELIUS_API_KEY is required for WebSocket streaming. ' +
          'Please set HELIUS_API_KEY in your .env file.'
        );
        log.error(error.message);
        reject(error);
        return;
      }

      log.info('Connecting to Helius WebSocket...', {
        wsUrl: this.wsUrl,
        apiKeyLength: this.heliusApiKey.length,
        apiKeyPrefix: this.heliusApiKey.substring(0, 8) + '...',
      });

      // Use Helius enhanced WebSocket for transaction streaming
      // Check if wsUrl already has api-key parameter
      let fullWsUrl: string;
      if (this.wsUrl.includes('api-key=')) {
        // API key already in URL, use as-is
        fullWsUrl = this.wsUrl;
        log.info('Using WebSocket URL with embedded API key');
      } else {
        // Add API key to URL
        fullWsUrl = `${this.wsUrl}/?api-key=${this.heliusApiKey}`;
        log.info('Added API key to WebSocket URL');
      }
      
      this.ws = new WebSocket(fullWsUrl);

      this.ws.on('open', () => {
        log.info('WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.subscribeToPrograms();
        this.startSignatureCleanup();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error: any) => {
        log.error(`WebSocket error: ${error.message}`, {
          errorType: error.constructor.name,
          statusCode: error.statusCode,
          statusMessage: error.statusMessage,
        });
        if (!this.isConnected) {
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        log.warn(`WebSocket closed: ${code} - ${reason.toString()}`);
        this.isConnected = false;
        this.attemptReconnect();
      });
    });
  }

  /**
   * Subscribe to wallet addresses or DEX program logs
   */
  private subscribeToPrograms(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot subscribe: WebSocket not open');
      return;
    }

    // If wallet addresses are provided, subscribe to those instead of DEX programs
    if (this.walletAddresses.length > 0) {
      log.info(`📡 Subscribing to ${this.walletAddresses.length} wallet address(es)...`);
      for (const wallet of this.walletAddresses) {
        const subscribeRequest = {
          jsonrpc: '2.0',
          id: Math.floor(Math.random() * 1000000),
          method: 'logsSubscribe',
          params: [
            { mentions: [wallet] },
            { commitment: 'confirmed' },
          ],
        };

        log.info(`  → ${wallet.slice(0, 12)}...${wallet.slice(-6)} (infra wallet)`);
        this.ws.send(JSON.stringify(subscribeRequest));
      }
      log.info('✅ Wallet subscription requests sent, waiting for confirmations...');
      return;
    }

    // Fallback: Subscribe to DEX programs if no wallet addresses provided
    const programs = [
      DEX_PROGRAMS.PUMP_AMM,     // Main Pump.fun AMM program - most common!
      DEX_PROGRAMS.PUMP_SWAP,
      DEX_PROGRAMS.PUMP_FUN,
      DEX_PROGRAMS.RAYDIUM_AMM,
    ];

    log.info('📡 Subscribing to DEX programs...');
    for (const program of programs) {
      const subscribeRequest = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000000),
        method: 'logsSubscribe',
        params: [
          { mentions: [program] },
          { commitment: 'confirmed' },
        ],
      };

      log.info(`  → ${program.slice(0, 8)}... (PumpSwap/PumpFun/Raydium)`);
      this.ws.send(JSON.stringify(subscribeRequest));
    }
    log.info('✅ Subscription requests sent, waiting for confirmations...');
  }

  private tradeCount = 0;
  private lastActivityLog = Date.now();

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: HeliusWebSocketMessage = JSON.parse(data.toString());

      // Subscription confirmation
      if (message.result !== undefined && message.id !== undefined) {
        this.subscriptionId = message.result;
        log.info(`✅ Subscription confirmed: ID ${message.result}`);
        return;
      }

      // Log notification
      if (message.method === 'logsNotification' && message.params?.result) {
        const result = message.params.result;
        
        // Extract signature - it might be in result.value.signature
        const signature = result.signature || result.value?.signature;
        const slot = result.context?.slot || result.slot || 0;
        const err = result.value?.err || result.err;
        const logs = result.value?.logs || result.logs || [];

        // Skip failed transactions
        if (err) return;

        // Validate signature exists
        if (!signature || typeof signature !== 'string') {
          // Debug: log the structure once to see what we're getting
          if (this.tradeCount === 0) {
            const resultStr = JSON.stringify(result, null, 2);
            log.debug('Message structure: ' + resultStr.slice(0, 500));
          }
          return;
        }

        // Skip already processed
        if (this.processedSignatures.has(signature)) return;
        this.processedSignatures.add(signature);

        // Log activity periodically
        this.tradeCount++;
        const now = Date.now();
        if (this.tradeCount % 10 === 0 || now - this.lastActivityLog > 30000) {
          log.info(`📊 Processing transactions: ${this.tradeCount} total`, {
            lastTx: signature.slice(0, 8) + '...',
          });
          this.lastActivityLog = now;
        }

        // Parse the transaction for trade details
        this.parseTransaction(signature, slot, logs);
      }
    } catch (error) {
      log.error(`Failed to parse message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse transaction logs to extract trade details
   */
  private async parseTransaction(signature: string, slot: number, logs: string[]): Promise<void> {
    try {
      // Validate inputs
      if (!signature || typeof signature !== 'string') {
        log.warn('parseTransaction called with invalid signature');
        return;
      }

      if (!logs || !Array.isArray(logs)) {
        log.warn(`parseTransaction called with invalid logs for ${signature.slice(0, 8)}...`);
        return;
      }

      // Quick check if this looks like a swap
      const isSwap = logs.some(log => 
        log.includes('Swap') || 
        log.includes('swap') ||
        log.includes('Transfer') ||
        log.includes('TokenBalance')
      );

      if (!isSwap) return;

      // Fetch full transaction for details
      const txDetails = await this.fetchTransactionDetails(signature);
      if (!txDetails) return;

      // Extract trade from transaction
      const trade = this.extractTradeFromTransaction(signature, slot, txDetails);
      if (trade) {
        this.emit('trade', trade);
      }
    } catch (error) {
      const sigPreview = signature && typeof signature === 'string' ? signature.slice(0, 8) + '...' : 'invalid';
      log.debug(`Failed to parse tx ${sigPreview}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetch full transaction details from RPC
   */
  private async fetchTransactionDetails(signature: string): Promise<any> {
    try {
      const response = await axios.post(
        this.rpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            {
              encoding: 'jsonParsed',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            },
          ],
        },
        { timeout: 5000 }
      );

      return response.data?.result || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract trade details from parsed transaction
   */
  private extractTradeFromTransaction(signature: string, slot: number, tx: any): RawTrade | null {
    try {
      const meta = tx.meta;
      if (!meta || meta.err) return null;

      const blockTime = tx.blockTime || Math.floor(Date.now() / 1000);
      const preBalances = meta.preTokenBalances || [];
      const postBalances = meta.postTokenBalances || [];

      // Extract pool address and program ID from instructions
      let poolAddress = '';
      let programId = '';
      
      // Check all instructions for DEX program
      const instructions = tx.transaction?.message?.instructions || [];
      for (const ix of instructions) {
        const ixProgramId = ix.programId?.toString() || '';
        if (Object.values(DEX_PROGRAMS).includes(ixProgramId)) {
          programId = ixProgramId;
          // Pool address is typically the first or second account in swap instructions
          // For Raydium: account[1] is usually the pool
          // For PumpFun/PumpSwap: account[2-3] is usually the bonding curve/pool
          const accounts = ix.accounts || [];
          if (accounts.length > 1) {
            poolAddress = accounts[1]?.toString() || accounts[0]?.toString() || '';
          }
          break;
        }
      }

      // Find token balance changes
      const balanceChanges: Map<string, { mint: string; change: number; owner: string }> = new Map();

      for (const post of postBalances) {
        const pre = preBalances.find(
          (p: any) => p.accountIndex === post.accountIndex && p.mint === post.mint
        );

        const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
        const preAmount = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || '0') : 0;
        const change = postAmount - preAmount;

        if (Math.abs(change) > 0.000001) {
          const key = `${post.mint}-${post.owner}`;
          balanceChanges.set(key, {
            mint: post.mint,
            change,
            owner: post.owner,
          });
        }
      }

      // Find the trader: the wallet that has BOTH SOL and token balance changes
      // This is the actual trader, not pool accounts
      
      // Debug: log balance changes for first few transactions
      if (this.tradeCount < 3) {
        log.debug(`Balance changes for ${signature.slice(0, 12)}:`, {
          changes: Array.from(balanceChanges.entries()).map(([k, v]) => ({
            key: k.slice(0, 20),
            mint: v.mint === NATIVE_SOL ? 'SOL' : v.mint.slice(0, 8),
            change: v.change,
            owner: v.owner.slice(0, 12),
          })),
        });
      }
      
      // Group changes by owner
      const ownerChanges: Map<string, { solChange: number; tokenChange: number; tokenMint: string }> = new Map();
      
      for (const [, data] of balanceChanges) {
        const existing = ownerChanges.get(data.owner) || { solChange: 0, tokenChange: 0, tokenMint: '' };
        if (data.mint === NATIVE_SOL) {
          existing.solChange += data.change;
        } else {
          existing.tokenChange += data.change;
          existing.tokenMint = data.mint;
        }
        ownerChanges.set(data.owner, existing);
      }
      
      // Find owner with both SOL and token changes (the actual trader)
      let traderWallet = '';
      let solChange = 0;
      let tokenChange = 0;
      let tokenMint = '';
      
      for (const [owner, changes] of ownerChanges) {
        // Trader is the one who has both SOL and token changes
        // Buy: SOL decreases (negative), token increases (positive)
        // Sell: Token decreases (negative), SOL increases (positive)
        if (changes.solChange !== 0 && changes.tokenChange !== 0 && changes.tokenMint) {
          traderWallet = owner;
          solChange = changes.solChange;
          tokenChange = changes.tokenChange;
          tokenMint = changes.tokenMint;
          break;
        }
      }
      
      // Fallback: if no wallet has both changes, use any wallet with token changes
      if (!traderWallet) {
        for (const [owner, changes] of ownerChanges) {
          if (changes.tokenChange !== 0 && changes.tokenMint) {
            traderWallet = owner;
            tokenChange = changes.tokenChange;
            tokenMint = changes.tokenMint;
            // Get SOL change from the first SOL entry
            for (const [, c] of ownerChanges) {
              if (c.solChange !== 0) {
                solChange = c.solChange;
                break;
              }
            }
            break;
          }
        }
      }

      // Need both SOL and token changes
      if (!tokenMint || tokenChange === 0) return null;

      // Determine trade type
      // Buy: SOL decreases, token increases
      // Sell: Token decreases, SOL increases
      const isBuy = tokenChange > 0 && solChange < 0;
      const isSell = tokenChange < 0 && solChange > 0;

      if (!isBuy && !isSell) return null;

      // Log extracted trader for debugging (every 100th trade)
      if (this.tradeCount % 100 === 0) {
        log.debug(`Extracted trade: trader=${traderWallet?.slice(0, 12)}... token=${tokenMint?.slice(0, 8)}... type=${isBuy ? 'buy' : 'sell'}`);
      }
      
      const trade: RawTrade = {
        signature,
        slot,
        blockTime,
        poolAddress: poolAddress || 'unknown', // Extracted from instruction accounts
        programId: programId || 'unknown', // Extracted from instruction
        tokenMint,
        type: isBuy ? 'buy' : 'sell',
        amountToken: Math.abs(tokenChange),
        amountSOL: Math.abs(solChange),
        amountIn: isBuy ? Math.abs(solChange) : Math.abs(tokenChange),
        amountOut: isBuy ? Math.abs(tokenChange) : Math.abs(solChange),
        traderWallet,
        priceSOL: Math.abs(solChange) / Math.abs(tokenChange),
      };

      return trade;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get pool state for a token
   */
  async getPoolState(tokenMint: string): Promise<PoolState | null> {
    // Check cache first
    const cached = this.poolCache.get(tokenMint);
    if (cached && Date.now() - cached.lastUpdated.getTime() < 30000) {
      return cached;
    }

    try {
      // Use DexScreener API for pool data
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`,
        { timeout: 5000 }
      );

      if (!response.data?.pairs?.[0]) return null;

      const pair = response.data.pairs[0];
      const poolState: PoolState = {
        poolAddress: pair.pairAddress,
        tokenMint,
        liquiditySOL: (pair.liquidity?.usd || 0) / (pair.priceUsd || 1), // Approximate
        liquidityToken: parseFloat(pair.liquidity?.quote || '0'),
        liquidityUSD: pair.liquidity?.usd || 0,
        priceUSD: parseFloat(pair.priceUsd || '0'),
        priceSOL: parseFloat(pair.priceNative || '0'),
        lastUpdated: new Date(),
      };

      this.poolCache.set(tokenMint, poolState);
      return poolState;
    } catch (error) {
      return null;
    }
  }

  /**
   * Attempt to reconnect on disconnect
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error('Max reconnection attempts reached');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      this.attemptReconnect();
    }
  }

  /**
   * Clean up old processed signatures
   */
  private startSignatureCleanup(): void {
    this.signatureCleanupInterval = setInterval(() => {
      if (this.processedSignatures.size > 10000) {
        // Keep only last 5000
        const arr = Array.from(this.processedSignatures);
        this.processedSignatures = new Set(arr.slice(-5000));
        log.debug(`Cleaned up signature cache: ${arr.length} -> ${this.processedSignatures.size}`);
      }
    }, 60000);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    log.info('Disconnecting trade feed...');
    
    if (this.signatureCleanupInterval) {
      clearInterval(this.signatureCleanupInterval);
      this.signatureCleanupInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isActive(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}


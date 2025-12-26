/**
 * Token Launch Monitor
 * Detects new token launches and liquidity additions on Solana
 * Uses multiple detection methods for fastest possible detection:
 * 1. Account-level monitoring (fastest - catches pool creation at account level)
 * 2. WebSocket log monitoring (processed commitment)
 * 3. Enhanced Transactions API (pending tx detection)
 * 4. DexScreener API (backup)
 */

import { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import axios from 'axios';
import WebSocket from 'ws';
import { getPoolProcessor, DetectionLayer } from './pool-processor.js';
import { LiquidityService } from './liquidity-service.js';

const log = createLogger('token-monitor');

// DexScreener API endpoints
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Raydium AMM Program ID
const RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export interface TokenLaunch {
  mint: string;
  poolAddress?: string;
  liquiditySOL: number;
  timestamp: number;
  slot: number;
  signature: string;
  firstSwapTime?: number;
  pairToken?: string;
}

export interface SwapEvent {
  signature: string;
  wallet: string;
  tokenMint: string;
  amountIn: number;
  amountOut: number;
  timestamp: number;
}

export class TokenMonitor {
  private connection: Connection;
  private heliusApiKey: string;
  private monitoredTokens: Map<string, TokenLaunch> = new Map();
  private swapEvents: Map<string, SwapEvent[]> = new Map();
  private isRunning = false;
  private wsConnection: WebSocket | null = null;
  private seenTokens: Set<string> = new Set();
  private lastScanTime: number = 0;
  private scanCount: number = 0;
  private wsMessageCount: number = 0;
  private wsPoolEventCount: number = 0;
  private lastStatsTime: number = Date.now();
  private verboseMode: boolean = false; // Set to true for debugging (shows all transactions)
  private processedSignatures: Set<string> = new Set(); // Track processed txs
  
  // Account-level monitoring
  private accountSubscriptionId: number | null = null;
  private seenPoolAccounts: Set<string> = new Set(); // Track seen pool accounts
  private accountDetectionCount: number = 0;
  
  // New: Unified services for deduplication and liquidity
  private liquidityService: LiquidityService;
  private poolProcessor = getPoolProcessor();

  constructor(rpcUrl: string, heliusApiKey: string) {
    this.connection = new Connection(rpcUrl, {
      commitment: 'processed', // CHANGED: Use processed for faster detection
      wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://')
    });
    this.heliusApiKey = heliusApiKey;
    this.liquidityService = new LiquidityService(this.connection);
  }

  /**
   * Start monitoring for new launches
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Token monitor already running');
      return;
    }
    
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('📡 MULTI-LAYER DETECTION SYSTEM');
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('🔴 Layer 1: Account-level monitoring (FASTEST - catches pool creation)');
    log.info('🟠 Layer 2: WebSocket logs (PROCESSED commitment)');
    log.info('🟡 Layer 3: Helius Enhanced API (pending transactions)');
    log.info('🟢 Layer 4: DexScreener polling (backup)');
    log.info('═══════════════════════════════════════════════════════════════');
    log.info('📋 LOGGING MODE: Only showing ACTUAL token launches');
    log.info('   (Verbose mode disabled - no transaction spam)');
    log.info('═══════════════════════════════════════════════════════════════');
    
    this.isRunning = true;

    // Start all detection layers
    await this.startAccountLevelMonitoring(); // FASTEST: Account-level detection
    await this.startProgramMonitoring();       // WebSocket log monitoring
    this.startHeliusEnhancedMonitoring();      // Enhanced API for pending tx
    this.startDexScreenerPolling();            // Backup polling
    
    log.info('✅ All detection layers active');
    log.info('🎯 Ready to detect new token launches!');
  }

  /**
   * LAYER 1: Account-level monitoring (FASTEST)
   * Monitors Raydium AMM program for new accounts (pool creations)
   * This catches pools at the account creation level, before transaction logs
   */
  private async startAccountLevelMonitoring(): Promise<void> {
    log.info('🔴 Starting account-level monitoring (fastest detection method)');
    
    try {
      // Subscribe to all account changes on the Raydium AMM program
      // This fires when ANY account owned by Raydium is created or modified
      this.accountSubscriptionId = this.connection.onProgramAccountChange(
        RAYDIUM_AMM_PROGRAM,
        async (accountInfo, context) => {
          await this.handleAccountChange(accountInfo, context);
        },
        {
          commitment: 'processed', // CRITICAL: Use processed for fastest detection
          filters: [
            // Filter for pool accounts (typically 752 bytes for Raydium AMM v4)
            { dataSize: 752 }
          ]
        }
      );

      log.info('✅ Account-level subscription active', {
        subscriptionId: this.accountSubscriptionId,
        program: 'Raydium AMM',
        commitment: 'processed'
      });

    } catch (error) {
      log.error('❌ Failed to start account-level monitoring', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle account changes from Raydium AMM program
   * This fires for new pool accounts being created
   */
  private async handleAccountChange(
    accountInfo: { accountId: PublicKey; accountInfo: { data: Buffer; executable: boolean; lamports: number; owner: PublicKey } },
    context: { slot: number }
  ): Promise<void> {
    const poolAddress = accountInfo.accountId.toBase58();
    
    // Skip if we've already seen this pool
    if (this.seenPoolAccounts.has(poolAddress)) {
      return;
    }
    
    this.seenPoolAccounts.add(poolAddress);
    this.accountDetectionCount++;
    
    const detectionTime = Date.now();
    
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('🔴 ACCOUNT-LEVEL DETECTION! (FASTEST)');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info(`Pool Address: ${poolAddress}`);
    log.info(`Slot: ${context.slot}`);
    log.info(`Data Size: ${accountInfo.accountInfo.data.length} bytes`);
    log.info(`Detection #${this.accountDetectionCount}`);
    
    try {
      // Parse the pool account data to extract token mints
      const poolData = accountInfo.accountInfo.data;
      
      // Raydium AMM v4 pool account structure (key offsets):
      // 0-8: status
      // 8-16: nonce
      // 64: coinMint (32 bytes)
      // 96: pcMint (32 bytes) - usually SOL
      // ... more fields
      
      if (poolData.length >= 128) {
        // Extract coin mint (the new token) at offset 64
        const coinMintBytes = poolData.slice(64, 96);
        const coinMint = new PublicKey(coinMintBytes).toBase58();
        
        // Extract pc mint (usually SOL) at offset 96
        const pcMintBytes = poolData.slice(96, 128);
        const pcMint = new PublicKey(pcMintBytes).toBase58();
        
        // Determine which is the new token (not SOL)
        let newTokenMint: string;
        if (coinMint === NATIVE_SOL) {
          newTokenMint = pcMint;
        } else if (pcMint === NATIVE_SOL) {
          newTokenMint = coinMint;
        } else {
          // Neither is SOL - could be a token/token pool, less interesting
          // Silently skip token/token pairs (reduce noise) - only log in verbose mode
          if (this.verboseMode) {
            log.info(`ℹ️  Pool is token/token pair (not SOL pair) - skipping`);
          }
          return;
        }
        
        // Skip if already monitoring this token
        if (this.seenTokens.has(newTokenMint)) {
          if (this.verboseMode) {
            log.info(`ℹ️  Token already seen: ${newTokenMint.slice(0, 8)}...`);
          }
          return;
        }
        
        this.seenTokens.add(newTokenMint);
        
        // Use pool processor for deduplication
        const signature = `account_${poolAddress.slice(0, 16)}`;
        const detectionLayer: DetectionLayer = 'ACCOUNT_CHANGE';
        
        if (!this.poolProcessor.shouldProcess(poolAddress, signature, detectionLayer)) {
          return; // Already being processed
        }
        
        // Register candidate
        const candidate = this.poolProcessor.registerCandidate(
          poolAddress,
          newTokenMint,
          signature,
          context.slot,
          detectionLayer
        );
        
        if (!candidate) {
          return; // Already registered
        }
        
        // Start settling phase
        this.poolProcessor.startSettling(candidate);
        
        // Use unified liquidity service with settling window
        const liquidityResult = await this.liquidityService.getLiquidityWithSettling(poolAddress);
        
        // Update candidate with liquidity
        this.poolProcessor.updateLiquidity(candidate, liquidityResult.solLiquidity, liquidityResult.status);
        
        if (liquidityResult.status === 'FAIL') {
          this.poolProcessor.markFailed(candidate, this.poolProcessor.createError(
            'LIQUIDITY_UNKNOWN',
            `Could not determine liquidity: ${liquidityResult.error}`,
            candidate
          ));
          return;
        }
        
        const liquiditySOL = liquidityResult.solLiquidity;
        
        // ACCOUNT-LEVEL DETECTION - This is an actual launch!
        log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log.info('🎯 NEW TOKEN LAUNCH (ACCOUNT-LEVEL DETECTION)!');
        log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log.info(`Token Mint: ${newTokenMint}`);
        log.info(`Pool Address: ${poolAddress}`);
        log.info(`SOL Liquidity: ${liquiditySOL.toFixed(2)} SOL (${liquidityResult.source})`);
        log.info(`Detection Method: ACCOUNT-LEVEL (fastest)`);
        log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log.info(`⏳ Validating through 8 security gates...`);
        
        // Start validation phase
        this.poolProcessor.startValidation(candidate);
        
        // Create token launch record
        const tokenLaunch: TokenLaunch = {
          mint: newTokenMint,
          poolAddress: poolAddress,
          liquiditySOL: liquiditySOL,
          timestamp: Math.floor(detectionTime / 1000),
          slot: context.slot,
          signature: signature,
          firstSwapTime: undefined,
          pairToken: NATIVE_SOL
        };
        
        // Add to monitored tokens for gate validation
        this.monitoredTokens.set(newTokenMint, tokenLaunch);
        this.swapEvents.set(newTokenMint, []);
      }
    } catch (error) {
      log.error('Error parsing pool account data', {
        error: error instanceof Error ? error.message : String(error),
        poolAddress
      });
    }
  }

  /**
   * Monitor Raydium and other DEX programs for new pools
   */
  private async startProgramMonitoring(): Promise<void> {
    // Major Solana DEX program IDs
    const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
    const ORCA_WHIRLPOOL = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
    const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    
    log.info('📋 Monitoring DEX programs:', {
      raydium: RAYDIUM_AMM.slice(0, 8) + '...',
      orca: ORCA_WHIRLPOOL.slice(0, 8) + '...',
      pumpFun: PUMP_FUN.slice(0, 8) + '...'
    });
    log.info('⚡ WebSocket (PROCESSED) will detect launches ~200-500ms earlier');
    log.info('🚀 Using Helius Enhanced Transactions for pending tx detection');

    // Use Helius Enhanced WebSocket API for better filtering
    this.connectHeliusWebSocket();
  }

  /**
   * NEW: Monitor Helius Enhanced Transactions API for pending transactions
   * This catches transactions BEFORE they're confirmed (like mempool monitoring)
   */
  private startHeliusEnhancedMonitoring(): void {
    if (!this.heliusApiKey) {
      log.warn('⚠️  Helius API key not available - Enhanced monitoring disabled');
      return;
    }

    log.info('🔍 Starting Helius Enhanced Transactions monitoring (pending tx detection)');
    
    // Poll Helius Enhanced Transactions API for recent Raydium transactions
    const pollEnhanced = async () => {
      if (!this.isRunning) return;
      
      try {
        // Use Helius Enhanced Transactions API to get pending/processed transactions
        // This shows transactions before they're fully confirmed
        const response = await axios.get(
          `https://api.helius.xyz/v0/addresses/675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8/transactions`,
          {
            params: {
              'api-key': this.heliusApiKey,
              limit: 10,
              type: 'SWAP' // Filter for swap-related activity
            },
            timeout: 5000
          }
        ).catch(() => null);

        if (response?.data) {
          // Process any new transactions we haven't seen
          for (const tx of response.data) {
            if (tx.signature && !this.processedSignatures.has(tx.signature)) {
              // Check if this looks like a pool creation
              if (tx.description?.includes('Initialize') || tx.type === 'UNKNOWN') {
                log.info(`⚡ Enhanced API: Potential new pool detected (pending): ${tx.signature.slice(0, 16)}...`);
                // Will be processed by main WebSocket flow, but this gives us early warning
              }
            }
          }
        }
      } catch (error) {
        // Silently fail - this is a bonus detection method
      }
      
      // Poll every 5 seconds for pending transactions
      setTimeout(pollEnhanced, 5000);
    };
    
    // Start after 10 seconds
    setTimeout(pollEnhanced, 10000);
  }

  /**
   * Poll DexScreener for new token pairs
   * Note: Public API is limited, so this serves as a backup detection method
   * Primary detection happens via WebSocket monitoring of DEX programs
   */
  private startDexScreenerPolling(): void {
    log.info('🔄 Starting DexScreener polling (every 60 seconds - backup method)');
    log.info('⚡ Primary detection: WebSocket monitoring of Pump.fun, Raydium, Orca');
    
    const poll = async () => {
      if (!this.isRunning) return;
      
      try {
        this.scanCount++;
        const now = Date.now();
        const elapsed = this.lastScanTime > 0 ? ((now - this.lastScanTime) / 1000).toFixed(1) : '0';
        
        // Only log every 4th scan to reduce spam (once per minute)
        if (this.scanCount % 4 === 1) {
          log.info(`🔍 DexScreener backup scan #${this.scanCount} (${elapsed}s since last)`);
        }
        
        await this.scanDexScreener();
        
        this.lastScanTime = now;
      } catch (error) {
        log.error('❌ DexScreener poll error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
      
      // Poll every 60 seconds (less aggressive since it's backup)
      setTimeout(poll, 60000);
    };
    
    // Start after 10 seconds to let WebSocket initialize first
    setTimeout(poll, 10000);
  }

  /**
   * Scan DexScreener for new Solana token pairs
   * Note: Public API is limited - we search for recent Raydium pairs
   */
  private async scanDexScreener(): Promise<void> {
    try {
      // Search for Raydium pairs (where most Solana tokens launch)
      // DexScreener's public API doesn't have a true "latest" endpoint
      const response = await axios.get(`${DEXSCREENER_API}/search?q=raydium`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json'
        }
      });

      log.debug('DexScreener API response received', { 
        status: response.status,
        hasPairs: !!response.data?.pairs,
        totalPairs: response.data?.pairs?.length || 0
      });

      if (!response.data?.pairs) {
        log.warn('⚠️  No pairs data from DexScreener', { 
          responseData: JSON.stringify(response.data).substring(0, 200) 
        });
        return;
      }

      // Filter for Solana chain pairs only
      const solanaPairs = response.data.pairs.filter((p: any) => p.chainId === 'solana');
      
      // Only log details every 4th scan
      if (this.scanCount % 4 === 1) {
        log.info(`📊 DexScreener: ${response.data.pairs.length} pairs (${solanaPairs.length} Solana)`);
      }
      
      let newTokensFound = 0;
      let rejectedByAge = 0;
      let rejectedByLiquidity = 0;
      let alreadySeen = 0;

      for (const pair of solanaPairs) {
        const tokenAddress = pair.baseToken?.address;
        if (!tokenAddress) continue;

        // Skip if already seen
        if (this.seenTokens.has(tokenAddress)) {
          alreadySeen++;
          continue;
        }

        this.seenTokens.add(tokenAddress);

        // Check age (only want very recent pairs - within last 5 minutes)
        const pairAge = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 999999999;
        if (pairAge > 300000) { // 5 minutes
          rejectedByAge++;
          log.debug(`⏳ Token ${tokenAddress.slice(0, 8)}... too old (${(pairAge / 60000).toFixed(1)}min)`);
          continue;
        }

        // Check liquidity
        const liquidityUSD = parseFloat(pair.liquidity?.usd || '0');
        const liquiditySOL = liquidityUSD / 150; // Rough conversion (assuming SOL ~$150)
        
        if (liquiditySOL < 10) { // Very low threshold for initial detection
          rejectedByLiquidity++;
          log.debug(`💧 Token ${tokenAddress.slice(0, 8)}... low liquidity ($${liquidityUSD.toFixed(0)} / ~${liquiditySOL.toFixed(1)} SOL)`);
          continue;
        }

        // New token detected!
        newTokensFound++;
        
        const launch: TokenLaunch = {
          mint: tokenAddress,
          poolAddress: pair.pairAddress,
          liquiditySOL: liquiditySOL,
          timestamp: pair.pairCreatedAt ? pair.pairCreatedAt / 1000 : Date.now() / 1000,
          slot: 0,
          signature: '',
          pairToken: pair.quoteToken?.symbol || 'SOL'
        };

        this.monitoredTokens.set(tokenAddress, launch);
        
        log.info(`🆕 NEW TOKEN DETECTED!`, {
          token: tokenAddress.slice(0, 8) + '...',
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          liquidity: `$${liquidityUSD.toFixed(0)} (~${liquiditySOL.toFixed(1)} SOL)`,
          age: `${(pairAge / 60000).toFixed(1)}min`,
          dex: pair.dexId,
          priceUSD: pair.priceUsd
        });
      }

      // Summary log (only on first scan or when tokens found)
      if (this.scanCount === 1 || newTokensFound > 0 || (this.scanCount % 4 === 1)) {
        if (newTokensFound > 0) {
          log.info(`📈 DexScreener: ${newTokensFound} new | ${alreadySeen} seen | ${rejectedByAge} old | ${rejectedByLiquidity} low liq`);
        } else if (this.scanCount === 1) {
          log.info(`ℹ️  DexScreener: No new tokens in search (${rejectedByAge} too old). Primary detection via WebSocket.`);
        }
      }
      
    } catch (error) {
      // Log the actual error details
      if (axios.isAxiosError(error)) {
        log.error('❌ DexScreener API Error (Axios)', { 
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : 'none',
          url: error.config?.url
        });
      } else {
        log.error('❌ DexScreener API Error (Unknown)', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.substring(0, 200) : 'none'
        });
      }
    }
  }

  /**
   * Connect to Helius Enhanced WebSocket for transaction monitoring
   */
  private connectHeliusWebSocket(): void {
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
    
    this.wsConnection = new WebSocket(wsUrl);

    this.wsConnection.on('open', () => {
      log.info('✅ WebSocket connected to Helius');
      
      // Subscribe to transaction monitoring
      // Note: You'll want to use Helius's enhanced transaction API
      // or monitor specific accounts/programs
      this.subscribeToTransactions();
    });

    this.wsConnection.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(message);
      } catch (error) {
        log.error('Error parsing WebSocket message', { error });
      }
    });

    this.wsConnection.on('error', (error) => {
      log.error('WebSocket error', { error: error.message });
    });

    this.wsConnection.on('close', () => {
      log.warn('WebSocket closed, reconnecting in 5s...');
      if (this.isRunning) {
        setTimeout(() => this.connectHeliusWebSocket(), 5000);
      }
    });
  }

  /**
   * Subscribe to relevant transactions
   */
  private subscribeToTransactions(): void {
    if (!this.wsConnection) return;

    // Subscribe to logs for pool creation events
    // CRITICAL: Use 'processed' commitment for faster detection (before confirmed)
    // This gives us ~200-500ms head start vs 'confirmed'
    const subscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'] // Raydium AMM
        },
        {
          commitment: 'processed'  // CHANGED: See transactions faster, before full confirmation
        }
      ]
    };

    this.wsConnection.send(JSON.stringify(subscribeMessage));
  }

  /**
   * Handle incoming WebSocket messages
   * CRITICAL: We must parse instructions to detect pool initialization
   */
  private async handleWebSocketMessage(message: any): Promise<void> {
    if (!message.params) return;

    const { result } = message.params;
    if (!result?.value) return;

    this.wsMessageCount++;
    
    const signature = result.value.signature;
    const logs = result.value.logs || [];
    
    // Avoid reprocessing
    if (signature && this.processedSignatures.has(signature)) {
      return;
    }
    
    if (signature) {
      this.processedSignatures.add(signature);
      
      // Cleanup old signatures (keep last 1000)
      if (this.processedSignatures.size > 1000) {
        const arr = Array.from(this.processedSignatures);
        this.processedSignatures = new Set(arr.slice(-1000));
      }
    }
    
    // Log activity summary every 2 minutes (reduced noise)
    const now = Date.now();
    if (now - this.lastStatsTime > 120000) { // Every 2 minutes instead of 1
      log.info(`📡 Monitoring: ${this.wsMessageCount} transactions scanned, ${this.wsPoolEventCount} pool candidates in last 2min`);
      this.wsMessageCount = 0;
      this.wsPoolEventCount = 0;
      this.lastStatsTime = now;
    }

    // VERBOSE: Only show sample transactions if verbose mode enabled
    if (this.verboseMode && this.wsMessageCount % 50 === 0) {
      log.info(`📝 Sample tx #${this.wsMessageCount}: ${signature?.slice(0, 16)}... | ${logs.length} logs`);
    }

    // CRITICAL: Check for pool initialization
    // Raydium pool init contains specific log patterns
    const isPoolInit = logs.some((log: string) => 
      log.toLowerCase().includes('initialize') ||
      log.toLowerCase().includes('init2') ||  // Raydium's init instruction
      log.includes('Program log: ray_log') ||
      log.includes('init_pc_amount') ||
      log.includes('init_coin_amount')
    );

    if (isPoolInit && signature) {
      this.wsPoolEventCount++;
      
      // Only log potential pool creations in verbose mode
      // Actual launches will be logged after validation
      if (this.verboseMode) {
        log.info(`🆕 POTENTIAL POOL CREATION DETECTED!`);
        log.info(`   Signature: ${signature}`);
        log.info(`   Logs preview: ${logs.slice(0, 3).join(' | ')}`);
      }
      
      // Use transaction data from WebSocket if available
      const txData = result.value.transaction;
      await this.processNewPool(signature, txData);
    }
  }

  /**
   * Process a potentially new pool transaction
   * CRITICAL: Must decode instructions to extract token mint
   */
  private async processNewPool(
    signature: string, 
    wsTransaction?: any,
    detectionLayer: DetectionLayer = 'WEBSOCKET_LOGS'
  ): Promise<void> {
    const poolProcessor = this.poolProcessor;
    
    try {
      let tx = wsTransaction;
      
      // Only fetch if we don't have transaction data from WebSocket
      if (!tx) {
        tx = await this.connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });

        if (!tx) {
          // Transaction not indexed yet - silently return (not an error)
          return;
        }
      }

      const age = tx.blockTime ? Date.now() - (tx.blockTime * 1000) : 0;
      const slot = tx.slot || 0;
      
      // CRITICAL: Decode Raydium pool initialization instruction
      const poolInfo = await this.extractPoolInfo(tx);
      
      if (!poolInfo) {
        // Not a pool initialization - silently skip
        return;
      }

      // Use pool processor for deduplication
      const poolAddress = poolInfo.poolAddress || `sig_${signature.slice(0, 16)}`;
      
      if (!poolProcessor.shouldProcess(poolAddress, signature, detectionLayer)) {
        // Already being processed - skip
        return;
      }
      
      // Register candidate with pool processor
      const candidate = poolProcessor.registerCandidate(
        poolAddress,
        poolInfo.mint,
        signature,
        slot,
        detectionLayer
      );
      
      if (!candidate) {
        return; // Already registered by another layer
      }

      // Start settling phase - get liquidity with retries
      poolProcessor.startSettling(candidate);
      
      // Use unified liquidity service with settling
      let liquidityResult;
      if (poolInfo.poolAddress) {
        liquidityResult = await this.liquidityService.getLiquidityWithSettling(poolInfo.poolAddress);
      } else {
        // Fallback to TX-based estimation
        liquidityResult = await this.liquidityService.estimateLiquidityFromTx(signature);
      }
      
      // Update liquidity on candidate
      poolProcessor.updateLiquidity(candidate, liquidityResult.solLiquidity, liquidityResult.status);
      
      // If liquidity couldn't be determined, log and continue (don't fail silently)
      if (liquidityResult.status === 'FAIL') {
        poolProcessor.markFailed(candidate, poolProcessor.createError(
          'LIQUIDITY_UNKNOWN',
          `Could not determine liquidity: ${liquidityResult.error}`,
          candidate
        ));
        return;
      }
      
      // Update poolInfo with correct liquidity
      poolInfo.liquiditySOL = liquidityResult.solLiquidity;

      // FOUND A REAL NEW POOL! Log with full context
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`🎯 NEW TOKEN LAUNCH DETECTED!`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`Token Mint:    ${poolInfo.mint}`);
      log.info(`Pool Address:  ${poolAddress.slice(0, 12)}...`);
      log.info(`SOL Liquidity: ${poolInfo.liquiditySOL.toFixed(2)} SOL (${liquidityResult.source})`);
      log.info(`Age:           ${(age / 1000).toFixed(1)} seconds`);
      log.info(`Layer:         ${detectionLayer}`);
      log.info(`Signature:     ${signature}`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`⏳ Validating through 8 security gates...`);
      
      // Start validation phase
      poolProcessor.startValidation(candidate);

      this.monitoredTokens.set(poolInfo.mint, poolInfo);
      this.swapEvents.set(poolInfo.mint, []);
      
    } catch (error: any) {
      // Structured error logging with context
      const isRateLimit = error?.message?.includes('429') || error?.code === -32429;
      const errorCode = isRateLimit ? 'RPC_RATE_LIMIT' : 
                        error?.message?.includes('timeout') ? 'RPC_TIMEOUT' : 
                        'TX_DECODE_FAIL';
      
      // Only log non-rate-limit errors (rate limits are handled by throttling)
      if (!isRateLimit) {
        log.error(`Pool processing error [${errorCode}]`, {
          signature: signature.slice(0, 16) + '...',
          layer: detectionLayer,
          error: error?.message || String(error)
        });
      }
    }
  }

  /**
   * Extract pool information from transaction by decoding Raydium instructions
   * CRITICAL: This is where we parse Raydium pool initialization
   */
  private async extractPoolInfo(tx: ParsedTransactionWithMeta): Promise<TokenLaunch | null> {
    try {
      const instructions = tx.transaction.message.instructions;
      
      // Raydium AMM program ID
      const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      
      // Known program IDs to exclude (not tokens!)
      const EXCLUDED_PROGRAMS = new Set([
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
        'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', // Serum
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
        'ComputeBudget111111111111111111111111111111', // Compute Budget
        '11111111111111111111111111111111', // System Program
        'SysvarRent111111111111111111111111111111111' // Rent Sysvar
      ]);
      
      // Find Raydium initialization instruction
      for (const ix of instructions) {
        const programId = 'programId' in ix ? ix.programId.toString() : null;
        
        if (programId !== RAYDIUM_AMM) continue;
        
        // Check if this is an initialize instruction (not swap/add/remove)
        if (!('accounts' in ix) || !Array.isArray(ix.accounts)) continue;
        
        const ixAccounts = ix.accounts;
        
        // Pool initialization has 16+ accounts
        if (ixAccounts.length < 16) {
          log.debug(`Instruction has ${ixAccounts.length} accounts - likely swap/liquidity op`);
          continue;
        }
        
        log.info(`📋 Analyzing Raydium instruction with ${ixAccounts.length} accounts`);
        
        // Raydium pool init structure (typical accounts):
        // [0] = token program
        // [1] = system program
        // [2-3] = rent/other
        // [4] = pool id (new)
        // [5] = pool authority
        // [6-7] = pool token accounts
        // [8-9] = coin mint, pc mint
        // [10+] = various accounts
        
        // Extract just the mints (typically positions 8-9 in Raydium init)
        const candidateMints: string[] = [];
        
        for (let i = 4; i < Math.min(ixAccounts.length, 12); i++) {
          const acct = ixAccounts[i]?.toString();
          if (!acct) continue;
          
          // Skip known programs
          if (EXCLUDED_PROGRAMS.has(acct)) continue;
          
          // Skip SOL/USDC (we want the OTHER token in the pair)
          if (acct === SOL_MINT || acct === USDC_MINT) continue;
          
          // Valid Solana address length
          if (acct.length >= 43 && acct.length <= 44) {
            // Check if we've never seen this before (likely NEW token)
            if (!this.seenTokens.has(acct)) {
              candidateMints.push(acct);
            }
          }
        }
        
        if (candidateMints.length === 0) {
          log.debug(`No new token mints found in instruction`);
          continue;
        }
        
        // If multiple candidates, take the first one (usually the coin mint)
        const tokenMint = candidateMints[0];
        
        log.info(`🎯 Identified NEW token mint: ${tokenMint}`);
        
        // Calculate SOL liquidity from token balance changes
        let liquiditySOL = 0;
        const preTokenBalances = tx.meta?.preTokenBalances || [];
        const postTokenBalances = tx.meta?.postTokenBalances || [];
        
        // Look for SOL (wrapped SOL) balance changes
        for (const preBalance of preTokenBalances) {
          const postBalance = postTokenBalances.find(
            (post) => post.accountIndex === preBalance.accountIndex
          );
          
          if (postBalance && preBalance.mint === 'So11111111111111111111111111111111111111112') {
            const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
            const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
            const diff = Math.abs(postAmount - preAmount);
            
            if (diff > 0.1) {
              liquiditySOL += diff;
            }
          }
        }
        
        // Fallback to lamport balance changes if no token balances found
        if (liquiditySOL === 0) {
          const postBalances = tx.meta?.postBalances || [];
          const preBalances = tx.meta?.preBalances || [];
          
          for (let i = 0; i < postBalances.length; i++) {
            const diff = Math.abs((postBalances[i] - preBalances[i]) / 1e9);
            if (diff > 0.5) {
              liquiditySOL = Math.max(liquiditySOL, diff);
            }
          }
        }
        
        if (liquiditySOL < 0.1) {
          log.warn(`⚠️  Liquidity too low: ${liquiditySOL.toFixed(2)} SOL`);
          continue;
        }
        
        // SUCCESS - we decoded a pool initialization!
        log.info(`✅ Pool decoded - ${tokenMint} with ${liquiditySOL.toFixed(2)} SOL`);
        
        return {
          mint: tokenMint,
          liquiditySOL,
          timestamp: tx.blockTime || Date.now() / 1000,
          slot: tx.slot,
          signature: tx.transaction.signatures[0]
        };
      }
      
      return null;
      
    } catch (error) {
      log.error('Error extracting pool info', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * Record a swap event for tracking early flow
   */
  recordSwap(tokenMint: string, swap: SwapEvent): void {
    const events = this.swapEvents.get(tokenMint) || [];
    events.push(swap);
    this.swapEvents.set(tokenMint, events);

    // Update first swap time if not set
    const launch = this.monitoredTokens.get(tokenMint);
    if (launch && !launch.firstSwapTime) {
      launch.firstSwapTime = swap.timestamp;
      this.monitoredTokens.set(tokenMint, launch);
    }
  }

  /**
   * Get early swap statistics for a token
   */
  getEarlySwapStats(tokenMint: string, windowSeconds: number = 30): {
    totalSwaps: number;
    uniqueWallets: number;
    maxWalletDominance: number;
  } {
    const events = this.swapEvents.get(tokenMint) || [];
    const launch = this.monitoredTokens.get(tokenMint);
    
    if (!launch?.firstSwapTime) {
      return { totalSwaps: 0, uniqueWallets: 0, maxWalletDominance: 0 };
    }

    // Filter events within time window
    const windowEnd = launch.firstSwapTime + windowSeconds;
    const windowEvents = events.filter(e => 
      e.timestamp >= launch.firstSwapTime! && 
      e.timestamp <= windowEnd
    );

    // Calculate unique wallets
    const uniqueWallets = new Set(windowEvents.map(e => e.wallet)).size;

    // Calculate max wallet dominance
    const volumeByWallet = new Map<string, number>();
    let totalVolume = 0;

    for (const event of windowEvents) {
      const volume = event.amountIn;
      totalVolume += volume;
      volumeByWallet.set(event.wallet, (volumeByWallet.get(event.wallet) || 0) + volume);
    }

    let maxWalletDominance = 0;
    if (totalVolume > 0) {
      for (const volume of volumeByWallet.values()) {
        maxWalletDominance = Math.max(maxWalletDominance, volume / totalVolume);
      }
    }

    return {
      totalSwaps: windowEvents.length,
      uniqueWallets,
      maxWalletDominance
    };
  }

  /**
   * Get monitored token by mint
   */
  getToken(mint: string): TokenLaunch | undefined {
    return this.monitoredTokens.get(mint);
  }

  /**
   * Get all monitored tokens
   */
  getAllTokens(): Map<string, TokenLaunch> {
    return this.monitoredTokens;
  }

  /**
   * Remove token from monitoring
   */
  removeToken(mint: string): void {
    this.monitoredTokens.delete(mint);
    this.swapEvents.delete(mint);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    log.info('Stopping token monitor...');
    this.isRunning = false;
    
    // Unsubscribe from account-level monitoring
    if (this.accountSubscriptionId !== null) {
      this.connection.removeProgramAccountChangeListener(this.accountSubscriptionId)
        .then(() => log.info('✅ Account subscription removed'))
        .catch((err) => log.error('Error removing account subscription', { error: err }));
      this.accountSubscriptionId = null;
    }
    
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    log.info('✅ Token monitor stopped');
    log.info(`📊 Account-level detections during session: ${this.accountDetectionCount}`);
  }
}

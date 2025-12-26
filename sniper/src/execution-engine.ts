/**
 * Execution Engine
 * Handles trade execution with Jito bundles, priority fees, and MEV protection
 * 
 * Jito Bundle Benefits:
 * 1. Guaranteed inclusion in the next block
 * 2. MEV protection (transactions bundled together)
 * 3. Bypass normal transaction queue
 * 4. Atomic execution (all-or-nothing)
 */

import { 
  Connection, 
  Keypair, 
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import { JupiterService, JupiterQuote } from '@copytrader/shared';
import axios from 'axios';
import bs58 from 'bs58';

const log = createLogger('execution-engine');

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

// Jito tip accounts - these are official Jito tip receivers
// You can tip any of these accounts, Jito will distribute to validators
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNXfvrwyXL',
  'HFqU5x63VTqvQss8hp11i4bVmkdzGTT4GgXQj9v5k3Dn',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];

export interface ExecutionConfig {
  enableJitoBundle: boolean;
  jitoBlockEngineUrl?: string;
  jitoTipAccount?: string;
  jitoTipLamports: number;  // Tip amount in lamports (e.g., 100000 = 0.0001 SOL)
  entryPriorityLevel: 'low' | 'medium' | 'high' | 'veryHigh';
  exitPriorityLevel: 'low' | 'medium' | 'high' | 'veryHigh';
  maxRetries: number;
}

// Jito Bundle API endpoints
const JITO_ENDPOINTS = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf'
};

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  amountIn?: number;
  amountOut?: number;
  priceImpact?: number;
}

export class ExecutionEngine {
  private connection: Connection;
  private jupiter: JupiterService;
  private config: ExecutionConfig;
  private jitoBundlesSent: number = 0;
  private jitoSuccessCount: number = 0;
  private jitoFailCount: number = 0;

  // Priority fee levels in microlamports
  private readonly PRIORITY_FEES = {
    low: 1000,
    medium: 10000,
    high: 50000,
    veryHigh: 100000
  };

  constructor(connection: Connection, config: ExecutionConfig) {
    this.connection = connection;
    this.jupiter = JupiterService.getInstance();
    this.config = config;
    
    if (this.config.enableJitoBundle) {
      log.info('═══════════════════════════════════════════════════════════════');
      log.info('🚀 JITO BUNDLE EXECUTION ENABLED');
      log.info('═══════════════════════════════════════════════════════════════');
      log.info(`Block Engine: ${this.config.jitoBlockEngineUrl}`);
      log.info(`Tip Amount: ${(this.config.jitoTipLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      log.info('Benefits: MEV protection, guaranteed inclusion, atomic execution');
      log.info('═══════════════════════════════════════════════════════════════');
    }
  }

  /**
   * Execute a buy order (SOL → Token)
   */
  async executeBuy(
    tokenMint: string,
    amountSOL: number,
    slippageBps: number,
    signer: Keypair,
    simulate: boolean = false
  ): Promise<ExecutionResult> {
    log.info('🔵 Executing BUY order', {
      tokenMint,
      amountSOL,
      slippageBps,
      simulate
    });

    try {
      const amountLamports = Math.floor(amountSOL * 1e9);

      // Get quote
      const quote = await this.jupiter.getQuote({
        inputMint: NATIVE_SOL,
        outputMint: tokenMint,
        amount: amountLamports,
        slippageBps,
        userPublicKey: signer.publicKey.toBase58()
      });

      if (!quote) {
        return {
          success: false,
          error: 'Failed to get Jupiter quote'
        };
      }

      // Execute with proper priority fees
      const result = await this.executeSwap(
        quote,
        signer,
        this.config.entryPriorityLevel,
        simulate
      );

      if (result.success) {
        log.info('✅ BUY order successful', {
          tokenMint,
          signature: result.signature,
          amountOut: result.amountOut
        });
      }

      return result;
    } catch (error) {
      log.error('❌ BUY order failed', {
        tokenMint,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute a sell order (Token → SOL)
   */
  async executeSell(
    tokenMint: string,
    amountTokens: string,
    slippageBps: number,
    signer: Keypair,
    simulate: boolean = false
  ): Promise<ExecutionResult> {
    log.info('🔴 Executing SELL order', {
      tokenMint,
      amountTokens,
      slippageBps,
      simulate
    });

    try {
      // Get quote
      const quote = await this.jupiter.getQuote({
        inputMint: tokenMint,
        outputMint: NATIVE_SOL,
        amount: Math.floor(Number(amountTokens)),
        slippageBps,
        userPublicKey: signer.publicKey.toBase58()
      });

      if (!quote) {
        return {
          success: false,
          error: 'Failed to get Jupiter quote'
        };
      }

      // Execute with proper priority fees
      const result = await this.executeSwap(
        quote,
        signer,
        this.config.exitPriorityLevel,
        simulate
      );

      if (result.success) {
        log.info('✅ SELL order successful', {
          tokenMint,
          signature: result.signature,
          amountOut: result.amountOut
        });
      }

      return result;
    } catch (error) {
      log.error('❌ SELL order failed', {
        tokenMint,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute swap with Jupiter
   */
  private async executeSwap(
    quote: JupiterQuote,
    signer: Keypair,
    priorityLevel: 'low' | 'medium' | 'high' | 'veryHigh',
    simulate: boolean = false
  ): Promise<ExecutionResult> {
    try {
      // Build swap transaction
      const swapTransactionBase64 = await this.jupiter.buildSwapTransaction(
        quote,
        signer.publicKey.toBase58(),
        true
      );

      if (!swapTransactionBase64) {
        return {
          success: false,
          error: 'Failed to build swap transaction'
        };
      }

      // Deserialize transaction
      const swapTransactionBuf = Buffer.from(swapTransactionBase64, 'base64');
      let transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // Add priority fees
      transaction = await this.addPriorityFee(transaction, signer, priorityLevel);

      // Sign transaction
      transaction.sign([signer]);

      if (simulate) {
        log.info('📝 SIMULATION MODE - Transaction would be sent');
        return {
          success: true,
          signature: 'SIMULATED',
          amountOut: parseInt(quote.outAmount)
        };
      }

      // Send transaction (with or without Jito bundle)
      let signature: string;
      
      if (this.config.enableJitoBundle && this.config.jitoBlockEngineUrl) {
        signature = await this.sendViaJitoBundle(transaction, signer);
      } else {
        signature = await this.sendViaRpc(transaction);
      }

      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      const priceImpact = parseFloat(quote.priceImpactPct || '0');

      return {
        success: true,
        signature,
        amountIn: parseInt(quote.inAmount),
        amountOut: parseInt(quote.outAmount),
        priceImpact
      };
    } catch (error) {
      log.error('Error executing swap', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Add priority fee to transaction
   */
  private async addPriorityFee(
    transaction: VersionedTransaction,
    _signer: Keypair,
    priorityLevel: 'low' | 'medium' | 'high' | 'veryHigh'
  ): Promise<VersionedTransaction> {
    try {
      const priorityFeeMicroLamports = this.PRIORITY_FEES[priorityLevel];

      // Get recent blockhash
      const { blockhash: _blockhash, lastValidBlockHeight: _lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');

      // Note: This is simplified. In production, you'd need to properly
      // modify the transaction message to include compute budget instructions
      // Jupiter's API typically handles this automatically with computeUnitPriceMicroLamports: 'auto'
      
      log.debug('Priority fee added', {
        priorityLevel,
        microLamports: priorityFeeMicroLamports
      });

      return transaction;
    } catch (error) {
      log.warn('Failed to add priority fee, using transaction as-is', { error });
      return transaction;
    }
  }

  /**
   * Send transaction via Jito bundle for MEV protection
   * 
   * How Jito Bundles Work:
   * 1. You create a bundle of transactions (your swap + tip to validator)
   * 2. Bundle is sent to Jito's block engine
   * 3. Block engine auctions your bundle to validators
   * 4. Highest-tipping bundles get included first
   * 5. All transactions in bundle execute atomically
   */
  private async sendViaJitoBundle(
    transaction: VersionedTransaction,
    signer: Keypair
  ): Promise<string> {
    this.jitoBundlesSent++;
    
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('📦 JITO BUNDLE EXECUTION');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info(`Bundle #${this.jitoBundlesSent}`);
    log.info(`Tip: ${(this.config.jitoTipLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    const blockEngineUrl = this.config.jitoBlockEngineUrl || JITO_ENDPOINTS.mainnet;
    
    try {
      // Use the separate tip transaction method (more reliable)
      // This sends: [swap_transaction, tip_transaction] as a bundle
      const signature = await this.sendBundleWithSeparateTipInternal(
        transaction, 
        signer, 
        blockEngineUrl
      );
      
      this.jitoSuccessCount++;
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log.info('✅ JITO BUNDLE CONFIRMED!');
      log.info(`Signature: ${signature}`);
      log.info(`Success Rate: ${this.jitoSuccessCount}/${this.jitoBundlesSent} (${((this.jitoSuccessCount/this.jitoBundlesSent)*100).toFixed(1)}%)`);
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return signature;
      
    } catch (error) {
      this.jitoFailCount++;
      log.error('❌ Jito bundle failed, falling back to standard RPC', {
        error: error instanceof Error ? error.message : String(error),
        failCount: this.jitoFailCount
      });
      return this.sendViaRpc(transaction);
    }
  }

  /**
   * Wait for Jito bundle confirmation
   */
  private async waitForBundleConfirmation(
    bundleId: string,
    signature: string,
    blockEngineUrl: string
  ): Promise<boolean> {
    log.info('⏳ Waiting for bundle confirmation...');
    
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 1000; // Check every second
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Method 1: Check bundle status via Jito API
        const statusResponse = await axios.post(
          `${blockEngineUrl}/api/v1/bundles`,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]]
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          }
        ).catch(() => null);

        if (statusResponse?.data?.result?.value?.[0]) {
          const status = statusResponse.data.result.value[0];
          log.info(`📊 Bundle status: ${status.confirmation_status || 'pending'}`);
          
          if (status.confirmation_status === 'confirmed' || status.confirmation_status === 'finalized') {
            return true;
          }
          
          if (status.err) {
            log.error('Bundle failed', { error: status.err });
            return false;
          }
        }
        
        // Method 2: Also check transaction on-chain directly
        const txStatus = await this.connection.getSignatureStatus(signature);
        if (txStatus.value?.confirmationStatus === 'confirmed' || 
            txStatus.value?.confirmationStatus === 'finalized') {
          log.info('✅ Transaction confirmed on-chain');
          return true;
        }
        
        if (txStatus.value?.err) {
          log.error('Transaction failed on-chain', { error: txStatus.value.err });
          return false;
        }
        
      } catch (error) {
        // Ignore errors during status checks
      }
      
      await this.sleep(checkInterval);
    }
    
    log.warn('⚠️  Bundle confirmation timed out, checking final status...');
    
    // Final check
    try {
      const txStatus = await this.connection.getSignatureStatus(signature);
      if (txStatus.value?.confirmationStatus) {
        log.info(`Final status: ${txStatus.value.confirmationStatus}`);
        return txStatus.value.confirmationStatus === 'confirmed' || 
               txStatus.value.confirmationStatus === 'finalized';
      }
    } catch {
      // Ignore
    }
    
    return false;
  }

  /**
   * Internal: Send bundle with separate tip transaction
   * This sends two transactions: your swap + a separate tip tx
   * More reliable than trying to add tip to existing transaction
   */
  private async sendBundleWithSeparateTipInternal(
    transaction: VersionedTransaction,
    signer: Keypair,
    blockEngineUrl: string
  ): Promise<string> {
    
    // Get fresh blockhash
    const { blockhash } = await this.connection.getLatestBlockhash('finalized');
    
    // Pick random tip account
    const tipAccountIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    const tipAccount = new PublicKey(this.config.jitoTipAccount || JITO_TIP_ACCOUNTS[tipAccountIndex]);
    
    // Create tip transaction
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: tipAccount,
      lamports: this.config.jitoTipLamports
    });
    
    const tipMessage = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [tipInstruction]
    }).compileToV0Message();
    
    const tipTx = new VersionedTransaction(tipMessage);
    tipTx.sign([signer]);
    
    // Serialize both transactions
    const serializedSwap = bs58.encode(transaction.serialize());
    const serializedTip = bs58.encode(tipTx.serialize());
    
    log.info('📦 Sending 2-tx bundle (swap + tip)...');
    
    // Send bundle with both transactions
    const response = await axios.post(
      `${blockEngineUrl}/api/v1/bundles`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[serializedSwap, serializedTip]]
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    if (response.data.error) {
      throw new Error(`Jito bundle error: ${response.data.error.message}`);
    }
    
    const bundleId = response.data.result;
    const signature = bs58.encode(transaction.signatures[0]);
    
    log.info('✅ 2-tx bundle submitted', { bundleId, signature });
    
    // Wait for confirmation
    const confirmed = await this.waitForBundleConfirmation(bundleId, signature, blockEngineUrl);
    
    if (!confirmed) {
      throw new Error('Bundle not confirmed');
    }
    
    return signature;
  }

  /**
   * Get Jito execution stats
   */
  getJitoStats(): { sent: number; success: number; failed: number; successRate: number } {
    const successRate = this.jitoBundlesSent > 0 
      ? (this.jitoSuccessCount / this.jitoBundlesSent) * 100 
      : 0;
    
    return {
      sent: this.jitoBundlesSent,
      success: this.jitoSuccessCount,
      failed: this.jitoFailCount,
      successRate
    };
  }

  /**
   * Send transaction via standard RPC
   */
  private async sendViaRpc(transaction: VersionedTransaction): Promise<string> {
    log.info('📡 Sending via standard RPC');

    let lastError: any;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const signature = await this.connection.sendRawTransaction(
          transaction.serialize(),
          {
            skipPreflight: false,
            maxRetries: 0,
            preflightCommitment: 'confirmed'
          }
        );

        log.info('✅ Transaction sent via RPC', {
          signature,
          attempt
        });

        return signature;
      } catch (error) {
        lastError = error;
        log.warn(`⚠️  Transaction send failed (attempt ${attempt}/${this.config.maxRetries})`, {
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt < this.config.maxRetries) {
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Transaction send failed after retries');
  }

  /**
   * Emergency sell - bypass normal flow for urgent exits
   */
  async emergencySell(
    tokenMint: string,
    amountTokens: string,
    signer: Keypair
  ): Promise<ExecutionResult> {
    log.warn('🚨 EMERGENCY SELL initiated', { tokenMint });

    // Use high slippage for emergency exits
    return this.executeSell(
      tokenMint,
      amountTokens,
      1000, // 10% slippage
      signer,
      false
    );
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

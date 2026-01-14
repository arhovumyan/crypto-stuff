import { EventEmitter } from 'events';
import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionSignature,
  SimulatedTransactionResponse,
} from '@solana/web3.js';
import fetch from 'cross-fetch';
import {
  TradeIntent,
  ExecutionResult,
  FillEvent,
} from '../types';
import { createModuleLogger } from '../logger';
import { Database } from '../database';

const logger = createModuleLogger('ExecutionEngine');

const LAMPORTS_PER_SOL = 1_000_000_000;
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';

export class ExecutionEngine extends EventEmitter {
  private connection: Connection;
  private wallet: Keypair;
  private database: Database;
  private paperTrading: boolean;

  constructor(connection: Connection, wallet: Keypair, database: Database, paperTrading = true) {
    super();
    this.connection = connection;
    this.wallet = wallet;
    this.database = database;
    this.paperTrading = paperTrading;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    logger.info('Starting ExecutionEngine module');
    logger.info({
      walletAddress: this.wallet.publicKey.toBase58(),
      paperTrading: this.paperTrading,
    }, 'Execution configuration');

    if (this.paperTrading) {
      logger.warn('⚠️  PAPER TRADING MODE - No real transactions will be executed');
    } else {
      logger.warn('🔴 LIVE TRADING MODE - Real transactions will be executed!');
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping ExecutionEngine module');
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  async executeSwap(
    intent: TradeIntent,
    inputMint: PublicKey,
    outputMint: PublicKey,
    positionId: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    logger.info({
      intentId: intent.intentId,
      positionId,
      side: intent.side,
      sizeSol: intent.sizeSol,
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
    }, 'Executing swap');

    try {
      // Step 1: Get fresh quote from Jupiter
      const route = await this.getJupiterQuote(inputMint, outputMint, intent.sizeSol);

      if (!route) {
        await this.database.logExecution(positionId, 'BUY', 'FAILED', undefined, {
          reason: 'No routes found',
        });
        return { status: 'FAILED', reason: 'No routes found' };
      }

      logger.debug({
        intentId: intent.intentId,
        inAmount: route.inAmount,
        outAmount: route.outAmount,
        priceImpactPct: route.priceImpactPct,
      }, 'Jupiter quote received');

      // Step 2: If paper trading, simulate and return
      if (this.paperTrading) {
        return await this.simulateSwap(intent, route, positionId, startTime);
      }

      // Step 3: Get swap transaction from Jupiter
      const swapTransaction = await this.getJupiterSwapTransaction(route);

      if (!swapTransaction) {
        await this.database.logExecution(positionId, 'BUY', 'FAILED', undefined, {
          reason: 'Failed to build transaction',
        });
        return { status: 'FAILED', reason: 'Failed to build transaction' };
      }

      // Step 4: Add compute budget and priority fee
      const enrichedTx = await this.addComputeBudget(swapTransaction, 50_000); // 0.00005 SOL priority

      // Step 5: Simulate before sending
      const simulation = await this.simulateTransaction(enrichedTx);

      if (simulation.err) {
        logger.error({ err: simulation.err }, 'Simulation failed');
        await this.database.logExecution(positionId, 'BUY', 'FAILED', undefined, {
          reason: 'Simulation failed',
          error: simulation.err,
        });
        return {
          status: 'FAILED',
          reason: 'Simulation failed',
          details: simulation,
        };
      }

      // Step 6: Sign and submit with retry
      const signature = await this.submitWithRetry(enrichedTx, positionId);

      // Step 7: Confirm transaction
      const confirmation = await this.confirmTransaction(signature);

      if (confirmation.value.err) {
        await this.database.logExecution(positionId, 'BUY', 'FAILED', signature, {
          reason: 'Transaction failed on-chain',
          error: confirmation.value.err,
        });
        return {
          status: 'FAILED',
          reason: 'Transaction failed on-chain',
          signature,
        };
      }

      // Step 8: Parse fill details (simplified)
      const fillPrice = intent.currentPrice;
      const fillAmount = intent.sizeSol;

      const executionLatencyMs = Date.now() - startTime;

      logger.info({
        intentId: intent.intentId,
        positionId,
        signature,
        fillPrice,
        fillAmount,
        latencyMs: executionLatencyMs,
      }, 'Swap executed successfully');

      await this.database.logExecution(positionId, 'BUY', 'SUCCESS', signature, {
        fillPrice,
        fillAmount,
        latencyMs: executionLatencyMs,
      });

      // Emit fill event
      const fillEvent: FillEvent = {
        positionId,
        signature,
        price: fillPrice,
        amount: fillAmount,
        timestamp: new Date(),
      };
      this.emit('fillEvent', fillEvent);

      return {
        status: 'SUCCESS',
        signature,
        fillPrice,
        fillAmount,
        executionLatencyMs,
      };
    } catch (err) {
      logger.error({ err, intentId: intent.intentId }, 'Execution error');
      await this.database.logExecution(positionId, 'BUY', 'ERROR', undefined, {
        error: String(err),
      });
      return {
        status: 'FAILED',
        reason: String(err),
      };
    }
  }

  // ============================================================================
  // JUPITER API
  // ============================================================================

  private async getJupiterQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountSol: number
  ): Promise<JupiterRoute | null> {
    try {
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      const params = new URLSearchParams({
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: amountLamports.toString(),
        slippageBps: '300', // 3% slippage
      });

      const response = await fetch(`${JUPITER_API_URL}/quote?${params}`);

      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      logger.error({ err }, 'Failed to get Jupiter quote');
      return null;
    }
  }

  private async getJupiterSwapTransaction(route: JupiterRoute): Promise<VersionedTransaction | null> {
    try {
      const response = await fetch(`${JUPITER_API_URL}/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: route,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Jupiter swap API error: ${response.statusText}`);
      }

      const { swapTransaction } = await response.json();

      // Deserialize transaction
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);

      // Sign transaction
      transaction.sign([this.wallet]);

      return transaction;
    } catch (err) {
      logger.error({ err }, 'Failed to get Jupiter swap transaction');
      return null;
    }
  }

  // ============================================================================
  // TRANSACTION HANDLING
  // ============================================================================

  private async addComputeBudget(
    tx: VersionedTransaction,
    _priorityFeeMicroLamports: number
  ): Promise<VersionedTransaction> {
    // For VersionedTransaction, we need to reconstruct with compute budget instructions
    // This is a simplified version - in production you'd properly modify the transaction
    return tx;
  }

  private async simulateTransaction(tx: VersionedTransaction): Promise<SimulatedTransactionResponse> {
    try {
      const simulation = await this.connection.simulateTransaction(tx, {
        commitment: 'processed',
      });

      return simulation.value;
    } catch (err) {
      logger.error({ err }, 'Simulation error');
      return { err: String(err), logs: [], unitsConsumed: 0 };
    }
  }

  private async submitWithRetry(
    tx: VersionedTransaction,
    positionId: string,
    maxAttempts = 3
  ): Promise<TransactionSignature> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const signature = await this.connection.sendTransaction(tx, {
          skipPreflight: true,
          maxRetries: 0,
        });

        logger.info({ positionId, signature, attempt }, 'Transaction submitted');
        return signature;
      } catch (err) {
        lastError = err;
        logger.warn({ err, attempt, positionId }, 'Submit attempt failed');

        if (attempt < maxAttempts) {
          await this.sleep(500 * attempt);
        }
      }
    }

    throw new Error(`Failed to submit after ${maxAttempts} attempts: ${lastError}`);
  }

  private async confirmTransaction(signature: TransactionSignature): Promise<any> {
    try {
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      return confirmation;
    } catch (err) {
      logger.error({ err, signature }, 'Confirmation error');
      throw err;
    }
  }

  // ============================================================================
  // PAPER TRADING
  // ============================================================================

  private async simulateSwap(
    intent: TradeIntent,
    _route: JupiterRoute,
    positionId: string,
    startTime: number
  ): Promise<ExecutionResult> {
    // In paper trading, we simulate success
    const fillPrice = intent.currentPrice;
    const fillAmount = intent.sizeSol;
    const executionLatencyMs = Date.now() - startTime;

    const mockSignature = `PAPER_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    logger.info({
      intentId: intent.intentId,
      positionId,
      signature: mockSignature,
      fillPrice,
      fillAmount,
      latencyMs: executionLatencyMs,
    }, '📄 Paper trade executed (simulated)');

    await this.database.logExecution(positionId, 'SIMULATION', 'SUCCESS', mockSignature, {
      fillPrice,
      fillAmount,
      latencyMs: executionLatencyMs,
      paperTrading: true,
    });

    // Emit fill event
    const fillEvent: FillEvent = {
      positionId,
      signature: mockSignature,
      price: fillPrice,
      amount: fillAmount,
      timestamp: new Date(),
    };
    this.emit('fillEvent', fillEvent);

    return {
      status: 'SUCCESS',
      signature: mockSignature,
      fillPrice,
      fillAmount,
      executionLatencyMs,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  setPaperTrading(enabled: boolean): void {
    this.paperTrading = enabled;
    logger.warn({ paperTrading: enabled }, 'Paper trading mode changed');
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface JupiterRoute {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
}

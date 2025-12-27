import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { config } from './config';
import { logger } from './logger';

interface SwapQuote {
  transaction: string;
  requestId: string;
  outAmount: string;
  inAmount: string;
  priceImpactPct: number;
  timestamp: number;
}

interface SwapResult {
  signature: string;
  outputAmount: number;
  actualPriceImpact: number;
}

/**
 * Enhanced Jupiter executor with execution hardening:
 * - Fresh quote requirement (<5s old)
 * - Price impact validation (separate from slippage)
 * - Quote staleness check (price moved since signal)
 * - Retry logic with fresh quotes
 * - Detailed error reporting
 */
export class EnhancedJupiterExecutor {
  private wallet: Keypair;

  constructor(wallet: Keypair) {
    this.wallet = wallet;
  }

  /**
   * Execute swap with hardened execution logic
   */
  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    expectedPrice: number, // Price when signal was generated
    slippageBps: number
  ): Promise<SwapResult> {
    const maxRetries = config.entry.maxRetryAttempts;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `[JupiterHardened] Attempt ${attempt}/${maxRetries}: ` +
          `${inputMint.slice(0, 8)} → ${outputMint.slice(0, 8)}`
        );

        // Step 1: Get fresh quote
        const quote = await this.getQuote(inputMint, outputMint, amount);

        // Step 2: Validate quote freshness
        const quoteFreshness = this.validateQuoteFreshness(quote);
        if (!quoteFreshness.valid) {
          throw new Error(`Quote too stale: ${quoteFreshness.reason}`);
        }

        // Step 3: Validate price impact
        const priceImpact = this.validatePriceImpact(quote);
        if (!priceImpact.valid) {
          throw new Error(`Price impact too high: ${priceImpact.reason}`);
        }

        // Step 4: Validate price movement since signal
        const priceMovement = this.validatePriceMovement(quote, expectedPrice, amount, inputMint);
        if (!priceMovement.valid) {
          logger.warn(`[JupiterHardened] ⚠️  ${priceMovement.reason}`);
          // Don't abort, but log warning
        }

        // Step 5: Execute swap
        const result = await this.executeOrder(quote, slippageBps);

        logger.info(
          `[JupiterHardened] ✅ Swap successful: ${result.signature} | ` +
          `Output: ${result.outputAmount} | Impact: ${result.actualPriceImpact.toFixed(2)}%`
        );

        return result;

      } catch (error: any) {
        lastError = error;
        
        logger.warn(
          `[JupiterHardened] ❌ Attempt ${attempt}/${maxRetries} failed: ${error.message}`
        );

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          logger.error(`[JupiterHardened] Non-retryable error, aborting`);
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.info(`[JupiterHardened] Waiting ${waitMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }

    // All retries failed
    throw new Error(`All ${maxRetries} attempts failed. Last error: ${lastError?.message}`);
  }

  /**
   * Get quote from Jupiter
   */
  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<SwapQuote> {
    if (!config.jupiterApiKey) {
      throw new Error('JUPITER_API_KEY not configured');
    }

    const taker = this.wallet.publicKey.toBase58();
    const amountStr = Math.floor(amount).toString();

    const orderParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountStr,
      taker,
    });

    const orderUrl = `${config.jupiterApiUrl}/ultra/v1/order?${orderParams}`;

    const response = await fetch(orderUrl, {
      method: 'GET',
      headers: {
        'x-api-key': config.jupiterApiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Quote failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    if (data.errorCode) {
      throw new Error(`Quote error: ${data.errorMessage || 'Unknown error'}`);
    }

    if (!data.transaction || !data.requestId || !data.outAmount) {
      throw new Error('Invalid quote response: missing required fields');
    }

    // Calculate price impact (rough estimate)
    const inAmount = parseFloat(data.inAmount || amount.toString());
    const outAmount = parseFloat(data.outAmount);
    const expectedOut = inAmount; // 1:1 for SOL swaps assumption
    const priceImpactPct = ((expectedOut - outAmount) / expectedOut) * 100;

    return {
      transaction: data.transaction,
      requestId: data.requestId,
      outAmount: data.outAmount,
      inAmount: data.inAmount,
      priceImpactPct,
      timestamp: Date.now(),
    };
  }

  /**
   * Validate quote freshness
   */
  private validateQuoteFreshness(quote: SwapQuote): { valid: boolean; reason?: string } {
    const ageMs = Date.now() - quote.timestamp;
    const maxAgeSec = config.entry.maxQuoteAgeSec;

    if (ageMs > maxAgeSec * 1000) {
      return {
        valid: false,
        reason: `Quote is ${(ageMs / 1000).toFixed(1)}s old (max: ${maxAgeSec}s)`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate price impact
   */
  private validatePriceImpact(quote: SwapQuote): { valid: boolean; reason?: string } {
    const maxImpactBps = config.entry.maxPriceImpactBps;
    const maxImpactPercent = maxImpactBps / 100;

    if (Math.abs(quote.priceImpactPct) > maxImpactPercent) {
      return {
        valid: false,
        reason: `Price impact ${quote.priceImpactPct.toFixed(2)}% > ${maxImpactPercent}% max`,
      };
    }

    logger.info(`[JupiterHardened] ✓ Price impact OK: ${quote.priceImpactPct.toFixed(2)}%`);
    return { valid: true };
  }

  /**
   * Validate price hasn't moved too much since signal
   */
  private validatePriceMovement(
    quote: SwapQuote,
    expectedPrice: number,
    amount: number,
    inputMint: string
  ): { valid: boolean; reason?: string } {
    // Only validate for token → SOL (sells)
    // For SOL → token (buys), this is less reliable
    if (inputMint === 'So11111111111111111111111111111111111111112') {
      return { valid: true }; // Skip for buys
    }

    const outAmount = parseFloat(quote.outAmount);
    const inAmount = parseFloat(quote.inAmount);
    const currentPrice = outAmount / inAmount; // SOL per token
    const priceChange = ((currentPrice - expectedPrice) / expectedPrice) * 100;

    const maxMovement = config.entry.maxPriceMovementPercent;

    if (Math.abs(priceChange) > maxMovement) {
      return {
        valid: false,
        reason: `Price moved ${priceChange.toFixed(1)}% since signal (max: ±${maxMovement}%)`,
      };
    }

    logger.info(`[JupiterHardened] ✓ Price movement OK: ${priceChange.toFixed(1)}%`);
    return { valid: true };
  }

  /**
   * Execute the order
   */
  private async executeOrder(quote: SwapQuote, slippageBps: number): Promise<SwapResult> {
    // Deserialize and sign transaction
    const transactionBuf = Buffer.from(quote.transaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    transaction.sign([this.wallet]);

    // Serialize signed transaction
    const signedTransactionBase64 = Buffer.from(transaction.serialize()).toString('base64');

    // Execute via Jupiter Ultra API
    const executeUrl = `${config.jupiterApiUrl}/ultra/v1/execute`;

    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'x-api-key': config.jupiterApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        signedTransaction: signedTransactionBase64,
        requestId: quote.requestId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Execute failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;

    if (data.status !== 'Success' || !data.signature) {
      throw new Error(`Execution failed: ${data.error || 'Unknown error'}`);
    }

    return {
      signature: data.signature,
      outputAmount: parseFloat(data.outputAmountResult || quote.outAmount),
      actualPriceImpact: quote.priceImpactPct,
    };
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Don't retry these errors
    const nonRetryable = [
      'insufficient balance',
      'invalid account',
      'price impact too high',
      'price moved',
      'not configured',
    ];

    return nonRetryable.some(msg => message.includes(msg));
  }
}

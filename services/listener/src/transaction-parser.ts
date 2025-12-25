import { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import { createLogger, DetectedSwap, TokenDelta } from '@copytrader/shared';

const logger = createLogger('transaction-parser');

// Known DEX program IDs (Jupiter, Raydium, Orca, etc.)
const KNOWN_DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter V6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter V4
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
]);

export class TransactionParser {
  constructor(private connection: Connection) {}

  /**
   * Fetch and parse a transaction by signature
   */
  async fetchTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      logger.debug({ signature }, 'Fetching transaction');
      
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx) {
        logger.warn({ signature }, 'Transaction not found');
        return null;
      }

      return tx;
    } catch (error) {
      logger.error({ error, signature }, 'Failed to fetch transaction');
      return null;
    }
  }

  /**
   * Compute token balance deltas for a specific wallet from transaction meta
   * This is the ROBUST method that works across all DEXs
   */
  computeTokenDeltas(
    tx: ParsedTransactionWithMeta,
    walletAddress: string
  ): TokenDelta[] {
    if (!tx.meta || !tx.meta.preTokenBalances || !tx.meta.postTokenBalances) {
      logger.debug('Transaction has no token balance data');
      return [];
    }

    const deltas: Map<string, TokenDelta> = new Map();

    // Get the account index for this wallet
    const walletPubkey = new PublicKey(walletAddress);
    const accountIndex = tx.transaction.message.accountKeys.findIndex(
      (key) => key.pubkey.equals(walletPubkey)
    );

    if (accountIndex === -1) {
      logger.debug({ walletAddress }, 'Wallet not involved in transaction');
      return [];
    }

    // Process pre-balances
    for (const preBalance of tx.meta.preTokenBalances) {
      if (preBalance.owner !== walletAddress) continue;

      const mint = preBalance.mint;
      const amount = preBalance.uiTokenAmount.uiAmount || 0;

      deltas.set(mint, {
        mint,
        amount: -amount, // Pre-balance (will be subtracted)
        decimals: preBalance.uiTokenAmount.decimals,
        uiAmount: amount,
      });
    }

    // Process post-balances
    for (const postBalance of tx.meta.postTokenBalances) {
      if (postBalance.owner !== walletAddress) continue;

      const mint = postBalance.mint;
      const amount = postBalance.uiTokenAmount.uiAmount || 0;

      const existing = deltas.get(mint);
      if (existing) {
        // Calculate delta
        existing.amount += amount;
        existing.uiAmount = existing.amount;
      } else {
        deltas.set(mint, {
          mint,
          amount: amount,
          decimals: postBalance.uiTokenAmount.decimals,
          uiAmount: amount,
        });
      }
    }

    // Also handle SOL balance changes
    const preSolBalance = tx.meta.preBalances[accountIndex] || 0;
    const postSolBalance = tx.meta.postBalances[accountIndex] || 0;
    const solDelta = (postSolBalance - preSolBalance) / 1e9; // Convert lamports to SOL

    if (Math.abs(solDelta) > 0.001) {
      // Ignore dust (< 0.001 SOL)
      deltas.set('SOL', {
        mint: 'So11111111111111111111111111111111111111112', // Wrapped SOL mint
        symbol: 'SOL',
        amount: solDelta,
        decimals: 9,
        uiAmount: solDelta,
      });
    }

    return Array.from(deltas.values()).filter(
      (delta) => Math.abs(delta.amount) > 0.000001 // Filter out dust
    );
  }

  /**
   * Classify if a transaction is a swap based on token deltas
   * A swap should have exactly 1 token decrease and 1 token increase
   */
  classifyAsSwap(deltas: TokenDelta[]): {
    isSwap: boolean;
    tokenIn?: TokenDelta;
    tokenOut?: TokenDelta;
  } {
    const decreases = deltas.filter((d) => d.amount < 0);
    const increases = deltas.filter((d) => d.amount > 0);

    // Simple case: exactly 1 decrease and 1 increase = swap
    if (decreases.length === 1 && increases.length === 1) {
      return {
        isSwap: true,
        tokenIn: { ...decreases[0], amount: Math.abs(decreases[0].amount) },
        tokenOut: increases[0],
      };
    }

    // Could have multiple deltas due to fees, intermediary tokens, etc.
    // For now, we only handle the simple case
    // TODO: Handle complex routes

    return { isSwap: false };
  }

  /**
   * Identify DEX program from transaction
   */
  identifyDexProgram(tx: ParsedTransactionWithMeta): string | undefined {
    const programIds = tx.transaction.message.accountKeys
      .filter((key) => key.signer === false && key.writable === false)
      .map((key) => key.pubkey.toString());

    for (const programId of programIds) {
      if (KNOWN_DEX_PROGRAMS.has(programId)) {
        return programId;
      }
    }

    return undefined;
  }

  /**
   * Main method: Parse transaction and extract swap details
   */
  async parseSwap(
    signature: string,
    walletAddress: string
  ): Promise<DetectedSwap | null> {
    const tx = await this.fetchTransaction(signature);
    if (!tx) return null;

    // Compute token deltas
    const deltas = this.computeTokenDeltas(tx, walletAddress);
    if (deltas.length === 0) {
      logger.debug({ signature }, 'No token deltas found');
      return null;
    }

    // Classify as swap
    const { isSwap, tokenIn, tokenOut } = this.classifyAsSwap(deltas);
    if (!isSwap || !tokenIn || !tokenOut) {
      logger.debug({ signature, deltas }, 'Not a simple swap');
      return null;
    }

    // Identify DEX
    const dexProgram = this.identifyDexProgram(tx);

    const detectedSwap: DetectedSwap = {
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime || Date.now() / 1000,
      leaderWallet: walletAddress,
      tokenIn,
      tokenOut,
      dexProgram,
      rawTransaction: tx,
    };

    const tokenInDisplay = tokenIn.symbol || (tokenIn.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : tokenIn.mint.slice(0, 6) + '...');
    const tokenOutDisplay = tokenOut.symbol || (tokenOut.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : tokenOut.mint.slice(0, 6) + '...');
    const action = tokenOutDisplay === 'SOL' ? 'SOLD' : 'BOUGHT';
    
    logger.info(
      `${action} | ${tokenInDisplay} → ${tokenOutDisplay} | Amount: ${tokenIn.amount.toFixed(4)} → ${tokenOut.amount.toFixed(6)} | Wallet: ...${walletAddress.slice(-8)}`
    );

    return detectedSwap;
  }
}

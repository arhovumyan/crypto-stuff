/**
 * Loss Monitor
 * 
 * Monitors token positions and automatically sells when loss reaches 5%
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import axios from 'axios';
import pg from 'pg';
import { createLogger } from '@copytrader/shared';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

const log = createLogger('loss-monitor');

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';
const DEXSCREENER_API_URL = 'https://api.dexscreener.com';
const LOSS_THRESHOLD_PERCENT = 5.0; // Sell when loss >= 5%
const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds (to avoid rate limiting)
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

interface TokenPosition {
  mint: string;
  symbol: string;
  balance: number;
  costBasis: number; // SOL spent to buy this token
  purchasePrice: number; // Price per token when purchased (in SOL)
  currentPrice: number; // Current price per token (in SOL)
  lossPercent: number;
  tokenAccount: PublicKey;
}

export class LossMonitor {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private db: pg.Pool;
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private enableLiveTrading: boolean;
  private trackedPositions: Map<string, TokenPosition> = new Map();

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.db = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.enableLiveTrading = process.env.ENABLE_LIVE_TRADING === 'true';

    const tradingMode = this.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER';
    log.info(`⚙️  Loss Monitor initialized | Threshold: ${LOSS_THRESHOLD_PERCENT}% | Trading: ${tradingMode}`);
  }

  /**
   * Initialize wallet from seed phrase
   */
  private async initializeWallet(): Promise<void> {
    const seedPhrase = 
      process.env.COPY_WALLET_SEED_PHREASE || 
      process.env.COPY_WALLET_SEED_PHRASE;

    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in environment');
    }

    const trimmed = seedPhrase.trim();
    
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase');
    }

    // Derive keypair using standard Solana derivation path
    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    const addr = this.keypair.publicKey.toBase58();
    log.info(`💼 Wallet initialized | Address: ${addr}`);
  }

  /**
   * Get current price of a token using Jupiter's quote API
   * This is faster and more accurate than DexScreener for our use case
   * Returns price in SOL per token
   */
  private async getTokenPrice(tokenMint: string, tokenBalance: number): Promise<number | null> {
    if (!this.keypair) {
      return null;
    }

    try {
      // Try to get a Jupiter quote for selling this token to SOL
      // Start with full balance, reduce if needed
      const amounts = [
        Math.floor(tokenBalance * LAMPORTS_PER_SOL),           // 100%
        Math.floor(tokenBalance * 0.5 * LAMPORTS_PER_SOL),     // 50%
        Math.floor(tokenBalance * 0.1 * LAMPORTS_PER_SOL),     // 10%
        Math.floor(tokenBalance * 0.01 * LAMPORTS_PER_SOL),    // 1%
      ];

      for (const amount of amounts) {
        if (amount < 1) continue;

        try {
          const apiKey = process.env.JUPITER_API_KEY;
          if (!apiKey) {
            throw new Error('JUPITER_API_KEY not found');
          }

          const params = new URLSearchParams({
            inputMint: tokenMint,
            outputMint: NATIVE_SOL,
            amount: amount.toString(),
            taker: this.keypair.publicKey.toBase58(),
          });

          const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order?${params}`, {
            headers: { 'x-api-key': apiKey },
            timeout: 3000,
          });

          if (response.data && response.data.outAmount && !response.data.errorCode) {
            const inputTokens = amount / LAMPORTS_PER_SOL;
            const outputSol = parseFloat(response.data.outAmount) / LAMPORTS_PER_SOL;
            const pricePerToken = outputSol / inputTokens; // SOL per token
            
            return pricePerToken;
          }
        } catch (error) {
          // Try next amount
          continue;
        }
      }

      // Fallback to DexScreener if Jupiter fails
      log.debug(`Falling back to DexScreener for ${tokenMint}`);
      return await this.getTokenPriceFromDexScreener(tokenMint);
    } catch (error: any) {
      log.debug({ error: error.message, tokenMint }, 'Failed to get token price');
      return null;
    }
  }

  /**
   * Fallback: Get current price of a token from DexScreener
   */
  private async getTokenPriceFromDexScreener(tokenMint: string): Promise<number | null> {
    try {
      const response = await axios.get(
        `${DEXSCREENER_API_URL}/latest/dex/tokens/${tokenMint}`,
        { timeout: 5000 }
      );

      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        return null;
      }

      // Get the main pair (usually highest liquidity)
      const mainPair = response.data.pairs[0];
      const priceUsd = parseFloat(mainPair.priceUsd || '0');
      
      if (priceUsd === 0) {
        return null;
      }

      // Get SOL price to convert to SOL
      const solResponse = await axios.get(
        `${DEXSCREENER_API_URL}/latest/dex/tokens/${NATIVE_SOL}`,
        { timeout: 5000 }
      );

      let solPriceUsd = 150; // Default fallback
      if (solResponse.data && solResponse.data.pairs && solResponse.data.pairs.length > 0) {
        solPriceUsd = parseFloat(solResponse.data.pairs[0].priceUsd || '150');
      }

      // Convert token price from USD to SOL
      return priceUsd / solPriceUsd;
    } catch (error: any) {
      log.debug({ error: error.message, tokenMint }, 'Failed to get token price');
      return null;
    }
  }

  /**
   * Get all token positions from database
   * Note: Positions table tracks by token_mint only (not by wallet)
   * avg_cost = average cost per token (in SOL)
   * size = number of tokens
   * costBasis = avg_cost * size (total SOL spent)
   */
  private async getPositionsFromDB(): Promise<Map<string, { costBasis: number; avgCost: number; symbol: string }>> {
    const positions = new Map<string, { costBasis: number; avgCost: number; symbol: string }>();

    try {
      const result = await this.db.query(
        `SELECT token_mint, token_symbol, avg_cost, size 
         FROM positions 
         WHERE size > 0 AND avg_cost IS NOT NULL AND avg_cost > 0`
      );

      for (const row of result.rows) {
        const avgCost = parseFloat(row.avg_cost || '0');
        const size = parseFloat(row.size || '0');
        
        if (size > 0 && avgCost > 0) {
          // Calculate cost basis: average cost per token * number of tokens
          const costBasis = avgCost * size;
          
          positions.set(row.token_mint, {
            costBasis,
            avgCost, // Store avg_cost for purchase price calculation
            symbol: row.token_symbol || 'Unknown',
          });
        }
      }
    } catch (error: any) {
      log.error({ error: error.message }, 'Failed to get positions from DB');
    }

    return positions;
  }

  /**
   * Get all token balances from on-chain
   */
  private async getOnChainTokenBalances(): Promise<Map<string, { balance: number; tokenAccount: PublicKey }>> {
    const balances = new Map<string, { balance: number; tokenAccount: PublicKey }>();

    if (!this.keypair) {
      return balances;
    }

    try {
      // Get token accounts from both programs
      const [tokenAccounts, token2022Accounts] = await Promise.all([
        this.connection.getParsedTokenAccountsByOwner(
          this.keypair.publicKey,
          { programId: TOKEN_PROGRAM_ID }
        ),
        this.connection.getParsedTokenAccountsByOwner(
          this.keypair.publicKey,
          { programId: TOKEN_2022_PROGRAM_ID }
        ).catch(() => ({ value: [] }))
      ]);

      const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];

      for (const { account, pubkey } of allAccounts) {
        const parsedInfo = account.data.parsed.info;
        const balance = parseFloat(parsedInfo.tokenAmount.uiAmount || '0');
        const mint = parsedInfo.mint;

        if (balance > 0 && mint !== NATIVE_SOL) {
          balances.set(mint, {
            balance,
            tokenAccount: pubkey,
          });
        }
      }
    } catch (error: any) {
      log.error({ error: error.message }, 'Failed to get on-chain balances');
    }

    return balances;
  }

  /**
   * Get Jupiter order for selling (using Ultra API)
   */
  private async getJupiterOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    taker: string
  ): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        taker, // Wallet address that will execute the swap
      });

      log.info('Requesting Jupiter order', {
        inputMint,
        outputMint,
        amount,
        taker,
      });

      const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order?${params}`, {
        headers: {
          'x-api-key': apiKey,
        },
        timeout: 10000,
      });

      if (response.data.errorCode) {
        log.error({
          errorCode: response.data.errorCode,
          errorMessage: response.data.errorMessage,
        }, 'Jupiter order error');
        return null;
      }

      log.info('Received Jupiter order', {
        inAmount: response.data.inAmount,
        outAmount: response.data.outAmount,
        priceImpact: response.data.priceImpact,
      });

      return response.data;
    } catch (error: any) {
      log.error({ error: error.message }, 'Failed to get Jupiter order');
      return null;
    }
  }

  /**
   * Execute sell transaction
   */
  private async executeSell(position: TokenPosition): Promise<boolean> {
    if (!this.keypair) {
      return false;
    }

    try {
      const amountLamports = Math.floor(position.balance * LAMPORTS_PER_SOL);
      
      log.info(`🔄 Getting Jupiter order for ${position.symbol}...`);
      const order = await this.getJupiterOrder(
        position.mint,
        NATIVE_SOL,
        amountLamports,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        log.error(`❌ Failed to get Jupiter order for ${position.symbol}`);
        return false;
      }

      if (!this.enableLiveTrading) {
        log.info(`📝 PAPER MODE | Would sell ${position.balance.toFixed(6)} ${position.symbol}`);
        log.info(`   Loss: ${position.lossPercent.toFixed(2)}% | Cost: ${position.costBasis.toFixed(6)} SOL`);
        return true;
      }

      // Deserialize and sign transaction
      const transactionBuf = Buffer.from(order.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);

      // Execute via Jupiter Ultra API
      const apiKey = process.env.JUPITER_API_KEY;
      const executeResponse = await axios.post(
        `${JUPITER_API_URL}/ultra/v1/execute`,
        {
          signedTransaction: Buffer.from(transaction.serialize()).toString('base64'),
          requestId: order.requestId,
        },
        {
          headers: {
            'x-api-key': apiKey,
          },
          timeout: 30000,
        }
      );

      if (executeResponse.data.signature) {
        const solReceived = parseFloat(order.outAmount) / LAMPORTS_PER_SOL;
        log.info('');
        log.info('═══════════════════════════════════════════════════');
        log.info('🔴 AUTO-SELL EXECUTED (5% Loss Stop)');
        log.info('═══════════════════════════════════════════════════');
        log.info(`Token:      ${position.symbol}`);
        log.info(`Amount:     ${position.balance.toFixed(6)} ${position.symbol} → ${solReceived.toFixed(6)} SOL`);
        log.info(`Loss:       ${position.lossPercent.toFixed(2)}%`);
        log.info(`Cost Basis: ${position.costBasis.toFixed(6)} SOL`);
        log.info(`Signature:  ${executeResponse.data.signature}`);
        log.info('═══════════════════════════════════════════════════');
        log.info('');

        // Update position in database (positions are tracked by token_mint only)
        await this.db.query(
          `UPDATE positions SET size = 0 WHERE token_mint = $1`,
          [position.mint]
        );

        return true;
      }

      return false;
    } catch (error: any) {
      log.error({ error: error.message, token: position.symbol }, 'Failed to execute sell');
      return false;
    }
  }

  /**
   * Check all positions for losses
   */
  private async checkPositions(): Promise<void> {
    if (!this.keypair) {
      return;
    }

    try {
      // Get positions from database
      const dbPositions = await this.getPositionsFromDB();
      
      if (dbPositions.size === 0) {
        // Log occasionally when no positions
        if (Math.random() < 0.05) { // 5% chance = ~every 20 seconds
          log.debug('No positions to monitor');
        }
        return;
      }
      
      // Get on-chain balances
      const onChainBalances = await this.getOnChainTokenBalances();

      log.debug(`Checking ${dbPositions.size} positions...`);

      // Update tracked positions
      for (const [mint, dbPos] of dbPositions) {
        // Add 500ms delay between checks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const onChain = onChainBalances.get(mint);
        
        if (!onChain || onChain.balance === 0) {
          // Token no longer in wallet, remove from tracking
          this.trackedPositions.delete(mint);
          continue;
        }

        // Purchase price per token = avg_cost from database
        const purchasePrice = dbPos.avgCost;
        
        // Get current price using Jupiter quote (passing balance for accurate quote)
        const currentPrice = await this.getTokenPrice(mint, onChain.balance);
        
        if (currentPrice === null) {
          // Can't get price, skip for now
          log.debug(`Skipping ${dbPos.symbol} - unable to get current price`);
          continue;
        }

        // Calculate loss percentage: (purchasePrice - currentPrice) / purchasePrice * 100
        const lossPercent = ((purchasePrice - currentPrice) / purchasePrice) * 100;

        // Update or create position
        const position: TokenPosition = {
          mint,
          symbol: dbPos.symbol,
          balance: onChain.balance,
          costBasis: dbPos.costBasis,
          purchasePrice,
          currentPrice,
          lossPercent,
          tokenAccount: onChain.tokenAccount,
        };

        this.trackedPositions.set(mint, position);

        // Check if loss threshold is met
        if (lossPercent >= LOSS_THRESHOLD_PERCENT) {
          log.warn(`⚠️  Loss detected: ${position.symbol} | Loss: ${lossPercent.toFixed(2)}% | Threshold: ${LOSS_THRESHOLD_PERCENT}%`);
          log.warn(`   Cost: ${position.costBasis.toFixed(6)} SOL | Current Value: ${(currentPrice * position.balance).toFixed(6)} SOL`);
          
          // Execute sell
          const sold = await this.executeSell(position);
          
          if (sold) {
            // Remove from tracking after successful sell
            this.trackedPositions.delete(mint);
          }
        } else {
          // Log occasionally (every 10 checks = ~10 seconds)
          if (Math.random() < 0.1) {
            log.debug(`${position.symbol}: ${lossPercent >= 0 ? '+' : ''}${lossPercent.toFixed(2)}% (safe)`);
          }
        }
      }

      // Remove positions that are no longer in wallet or DB
      for (const [mint] of this.trackedPositions) {
        if (!dbPositions.has(mint) || !onChainBalances.has(mint)) {
          this.trackedPositions.delete(mint);
        }
      }
    } catch (error: any) {
      log.error({ error: error.message }, 'Error checking positions');
    }
  }

  /**
   * Start the loss monitor
   */
  async start(): Promise<void> {
    log.info('Starting Loss Monitor Service...');

    try {
      await this.initializeWallet();
      
      this.isRunning = true;
      
      log.info(`✅ Loss Monitor started | Checking every ${CHECK_INTERVAL_MS / 1000} second(s)`);
      log.info(`   Loss threshold: ${LOSS_THRESHOLD_PERCENT}%`);
      log.info(`   Trading mode: ${this.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER'}`);
      log.info('');

      // Start checking positions
      this.checkInterval = setInterval(async () => {
        if (this.isRunning) {
          await this.checkPositions();
        }
      }, CHECK_INTERVAL_MS);

      // Do initial check immediately
      await this.checkPositions();
    } catch (error) {
      log.error({ error }, 'Failed to start loss monitor');
      throw error;
    }
  }

  /**
   * Stop the loss monitor
   */
  async stop(): Promise<void> {
    log.info('Stopping Loss Monitor...');
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    await this.db.end();
    log.info('✅ Loss Monitor stopped');
  }
}


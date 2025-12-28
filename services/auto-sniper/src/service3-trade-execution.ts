// ============================================================================
// SERVICE 3: TRADE EXECUTION & POSITION MONITORING
// ============================================================================
// Executes trades for qualified tokens and monitors positions for 2x exit

import { Connection, PublicKey, Keypair, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';
import bs58 from 'bs58';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import dotenv from 'dotenv';
import { Database, TokenStatus, Token, log } from './database.js';

dotenv.config({ path: '../../.env' });

interface JupiterQuoteResponse {
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

interface JupiterSwapResponse {
  swapTransaction: string;
}

class TradeExecutionService {
  private connection: Connection;
  private db: Database;
  private wallet: Keypair;
  private isRunning = false;
  private checkIntervalMs = 1000; // Check positions every second
  private buyAmountSol = 0.1; // Default buy amount
  private maxSlippageBps = 100; // 1% slippage

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in .env');
    }
    
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.db = new Database();
    
    // Initialize wallet from seed phrase
    this.wallet = this.getWalletFromSeed();
    
    // Load config
    if (process.env.FIXED_BUY_AMOUNT_SOL) {
      this.buyAmountSol = parseFloat(process.env.FIXED_BUY_AMOUNT_SOL);
    }
    
    if (process.env.MAX_SLIPPAGE_BPS) {
      this.maxSlippageBps = parseInt(process.env.MAX_SLIPPAGE_BPS);
    }
    
    log('💼 Trade Execution Service initialized');
    log(`   Wallet: ${this.wallet.publicKey.toBase58()}`);
    log(`   Buy Amount: ${this.buyAmountSol} SOL`);
    log(`   Max Slippage: ${this.maxSlippageBps / 100}%`);
  }

  private getWalletFromSeed(): Keypair {
    const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE;
    
    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in .env');
    }
    
    const seed = bip39.mnemonicToSeedSync(seedPhrase, '');
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    
    return Keypair.fromSeed(derivedSeed);
  }

  async start() {
    await this.db.connect();
    this.isRunning = true;
    
    log('🚀 Starting trade execution and position monitoring...');
    log(`⏱️  Checking every ${this.checkIntervalMs / 1000} seconds`);
    
    // Run immediately
    await this.processQualifiedTokens();
    await this.monitorPositions();
    
    // Then run periodically
    const tradeInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.processQualifiedTokens();
      }
    }, 10000); // Check for new trades every 10 seconds
    
    const monitorInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.monitorPositions();
      }
    }, this.checkIntervalMs);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      log('🛑 Shutting down Trade Execution Service...');
      this.isRunning = false;
      clearInterval(tradeInterval);
      clearInterval(monitorInterval);
      await this.db.disconnect();
      process.exit(0);
    });
  }

  private async processQualifiedTokens() {
    try {
      const qualifiedTokens = await this.db.getTokensByStatus(TokenStatus.QUALIFIED);
      
      if (qualifiedTokens.length === 0) {
        return;
      }
      
      log(`\n💰 Found ${qualifiedTokens.length} qualified tokens for trading`);
      
      for (const token of qualifiedTokens) {
        await this.executeBuy(token);
        
        // Delay between trades to avoid rate limiting
        await this.sleep(2000);
      }
      
    } catch (error: any) {
      log(`❌ Error processing qualified tokens: ${error.message}`);
    }
  }

  private async executeBuy(token: Token) {
    try {
      log(`\n💸 Executing BUY for ${token.mintAddress}`);
      log(`   Amount: ${this.buyAmountSol} SOL`);
      
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const inputAmount = Math.floor(this.buyAmountSol * 1e9); // Convert SOL to lamports
      
      // Get quote from Jupiter
      log(`   📊 Getting quote from Jupiter...`);
      const quote = await this.getJupiterQuote(
        SOL_MINT,
        token.mintAddress,
        inputAmount
      );
      
      if (!quote) {
        log(`   ❌ Could not get quote for ${token.mintAddress}`);
        return;
      }
      
      const outputAmount = parseInt(quote.outAmount);
      const estimatedPrice = (this.buyAmountSol * 1e9) / outputAmount;
      
      log(`   💱 Quote received:`);
      log(`      Input: ${this.buyAmountSol} SOL`);
      log(`      Output: ${(outputAmount / 1e9).toFixed(2)} tokens`);
      log(`      Est. Price: $${(estimatedPrice * (token.currentPrice || 0)).toFixed(10)}`);
      log(`      Price Impact: ${quote.priceImpactPct}%`);
      
      // Get swap transaction
      log(`   🔄 Building swap transaction...`);
      const swapTx = await this.getJupiterSwap(quote);
      
      if (!swapTx) {
        log(`   ❌ Could not build swap transaction`);
        return;
      }
      
      // Execute transaction
      log(`   📤 Sending transaction...`);
      const signature = await this.executeTransaction(swapTx);
      
      if (!signature) {
        log(`   ❌ Transaction failed`);
        return;
      }
      
      log(`   ✅ BUY SUCCESSFUL!`);
      log(`      TX: ${signature}`);
      
      // Update token status
      await this.db.updateToken(token.mintAddress, {
        status: TokenStatus.POSITION_OPEN,
        tradeData: {
          entryPrice: token.currentPrice || 0,
          entryAmount: outputAmount / 1e9,
          entryTime: new Date(),
        },
      });
      
      log(`   📍 Position opened - monitoring for 2x exit...`);
      
    } catch (error: any) {
      log(`❌ Error executing buy: ${error.message}`);
    }
  }

  private async monitorPositions() {
    try {
      const openPositions = await this.db.getTokensByStatus(TokenStatus.POSITION_OPEN);
      
      if (openPositions.length === 0) {
        return;
      }
      
      for (const position of openPositions) {
        await this.checkPosition(position);
      }
      
    } catch (error: any) {
      log(`❌ Error monitoring positions: ${error.message}`);
    }
  }

  private async checkPosition(token: Token) {
    try {
      if (!token.tradeData || !token.currentPrice) {
        return;
      }
      
      const entryPrice = token.tradeData.entryPrice;
      const currentPrice = token.currentPrice;
      const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      // Check if we've hit 2x (100% profit)
      if (profitPercent >= 100) {
        log(`\n🎯 TARGET HIT! ${token.mintAddress}`);
        log(`   Entry Price: $${entryPrice.toFixed(10)}`);
        log(`   Current Price: $${currentPrice.toFixed(10)}`);
        log(`   Profit: ${profitPercent.toFixed(2)}%`);
        
        await this.executeSell(token);
      }
      
    } catch (error: any) {
      log(`❌ Error checking position: ${error.message}`);
    }
  }

  private async executeSell(token: Token) {
    try {
      log(`\n💵 Executing SELL for ${token.mintAddress}`);
      
      if (!token.tradeData) {
        log(`   ❌ No trade data found`);
        return;
      }
      
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      
      // Get token balance
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(token.mintAddress),
        this.wallet.publicKey
      );
      
      const balance = await this.connection.getTokenAccountBalance(tokenAccount);
      const tokenAmount = parseInt(balance.value.amount);
      
      if (tokenAmount === 0) {
        log(`   ❌ No tokens to sell`);
        return;
      }
      
      log(`   Amount: ${(tokenAmount / 1e9).toFixed(2)} tokens`);
      
      // Get quote from Jupiter
      log(`   📊 Getting quote from Jupiter...`);
      const quote = await this.getJupiterQuote(
        token.mintAddress,
        SOL_MINT,
        tokenAmount
      );
      
      if (!quote) {
        log(`   ❌ Could not get quote`);
        return;
      }
      
      const outputSol = parseInt(quote.outAmount) / 1e9;
      
      log(`   💱 Quote received:`);
      log(`      Input: ${(tokenAmount / 1e9).toFixed(2)} tokens`);
      log(`      Output: ${outputSol.toFixed(4)} SOL`);
      
      // Get swap transaction
      log(`   🔄 Building swap transaction...`);
      const swapTx = await this.getJupiterSwap(quote);
      
      if (!swapTx) {
        log(`   ❌ Could not build swap transaction`);
        return;
      }
      
      // Execute transaction
      log(`   📤 Sending transaction...`);
      const signature = await this.executeTransaction(swapTx);
      
      if (!signature) {
        log(`   ❌ Transaction failed`);
        return;
      }
      
      const profitSol = outputSol - this.buyAmountSol;
      const profitPercent = (profitSol / this.buyAmountSol) * 100;
      
      log(`   ✅ SELL SUCCESSFUL!`);
      log(`      TX: ${signature}`);
      log(`      Profit: ${profitSol.toFixed(4)} SOL (${profitPercent.toFixed(2)}%)`);
      
      // Update token status
      await this.db.updateToken(token.mintAddress, {
        status: TokenStatus.POSITION_CLOSED,
        tradeData: {
          ...token.tradeData,
          exitPrice: token.currentPrice || 0,
          exitAmount: outputSol,
          exitTime: new Date(),
          profitLoss: profitSol,
          profitLossPercent: profitPercent,
        },
      });
      
    } catch (error: any) {
      log(`❌ Error executing sell: ${error.message}`);
    }
  }

  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<JupiterQuoteResponse | null> {
    try {
      const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: this.maxSlippageBps,
        },
        timeout: 10000,
      });
      
      return response.data;
    } catch (error: any) {
      log(`   ❌ Jupiter quote error: ${error.message}`);
      return null;
    }
  }

  private async getJupiterSwap(quote: JupiterQuoteResponse): Promise<string | null> {
    try {
      const response = await axios.post<JupiterSwapResponse>(
        'https://quote-api.jup.ag/v6/swap',
        {
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        },
        {
          timeout: 10000,
        }
      );
      
      return response.data.swapTransaction;
    } catch (error: any) {
      log(`   ❌ Jupiter swap error: ${error.message}`);
      return null;
    }
  }

  private async executeTransaction(serializedTx: string): Promise<string | null> {
    try {
      const txBuffer = Buffer.from(serializedTx, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);
      
      // Sign transaction
      tx.sign([this.wallet]);
      
      // Send transaction
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      
      // Confirm transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        log(`   ❌ Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        return null;
      }
      
      return signature;
    } catch (error: any) {
      log(`   ❌ Transaction error: ${error.message}`);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// MAIN
// ============================================================================

const service = new TradeExecutionService();
service.start().catch((error) => {
  log(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});

/**
 * Emergency Sell All Script
 * Sells all token positions for SOL one by one
 */

import { Connection, LAMPORTS_PER_SOL, Keypair, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import axios from 'axios';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://api.jup.ag';

interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
}

class SellAllTokens {
  private connection: Connection;
  private keypair: Keypair;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.keypair = this.loadWallet();
  }

  private loadWallet(): Keypair {
    const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE;
    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in .env');
    }

    const seed = bip39.mnemonicToSeedSync(seedPhrase, '');
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
  }

  private async getAllTokenBalances(): Promise<TokenBalance[]> {
    console.log('\n🔍 Scanning wallet for tokens...');
    console.log(`Wallet: ${this.keypair.publicKey.toBase58()}\n`);

    try {
      // Use TOKEN_2022_PROGRAM_ID as well for newer tokens
      const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      
      // Get token accounts from both programs
      const [tokenAccounts, token2022Accounts] = await Promise.all([
        this.connection.getParsedTokenAccountsByOwner(
          this.keypair.publicKey,
          { programId: TOKEN_PROGRAM_ID }
        ),
        this.connection.getParsedTokenAccountsByOwner(
          this.keypair.publicKey,
          { programId: TOKEN_2022_PROGRAM_ID }
        ).catch(() => ({ value: [] })) // Ignore errors for Token-2022
      ]);

      const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
      console.log(`   Found ${allAccounts.length} token account(s) total`);

      const balances: TokenBalance[] = [];

      for (const { account } of allAccounts) {
        const parsedInfo = account.data.parsed.info;
        const balance = parseFloat(parsedInfo.tokenAmount.uiAmount);
        const mint = parsedInfo.mint;
        const decimals = parsedInfo.tokenAmount.decimals;

        // Skip if balance is zero or if it's SOL
        if (balance > 0 && mint !== NATIVE_SOL) {
          console.log(`   ✓ ${mint}: ${balance.toFixed(6)}`);
          balances.push({ mint, balance, decimals });
        } else if (balance === 0) {
          console.log(`   - ${mint}: 0 (skipping)`);
        }
      }

      return balances;
    } catch (error: any) {
      console.error(`\n❌ Error scanning wallet: ${error.message}`);
      throw error;
    }
  }

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

      const response = await axios.get(`${JUPITER_API_URL}/ultra/v1/order`, {
        params: {
          inputMint,
          outputMint,
          amount: amount.toString(),
          taker,
        },
        headers: {
          'x-api-key': apiKey,
        },
        timeout: 15000,
      });

      return response.data;
    } catch (error: any) {
      console.error(`❌ Failed to get Jupiter order: ${error.message}`);
      return null;
    }
  }

  private async executeJupiterTransaction(signedTransaction: string, requestId: string): Promise<any> {
    try {
      const apiKey = process.env.JUPITER_API_KEY;
      if (!apiKey) {
        throw new Error('JUPITER_API_KEY not found in environment');
      }

      const response = await axios.post(
        `${JUPITER_API_URL}/ultra/v1/execute`,
        {
          signedTransaction,
          requestId,
        },
        {
          headers: {
            'x-api-key': apiKey,
          },
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error: any) {
      console.error(`❌ Failed to execute transaction: ${error.message}`);
      return null;
    }
  }

  private async sellToken(token: TokenBalance, index: number, total: number): Promise<boolean> {
    console.log(`\n[${index + 1}/${total}] 💰 Selling token: ${token.mint}`);
    console.log(`   Balance: ${token.balance.toFixed(6)}`);

    try {
      // Convert to smallest unit (lamports equivalent)
      const amountInSmallestUnit = Math.floor(token.balance * Math.pow(10, token.decimals));

      console.log(`   📡 Fetching Jupiter quote...`);
      const order = await this.getJupiterOrder(
        token.mint,
        NATIVE_SOL,
        amountInSmallestUnit,
        this.keypair.publicKey.toBase58()
      );

      if (!order || !order.transaction) {
        console.log(`   ⚠️  Could not get quote - skipping`);
        return false;
      }

      const expectedSOL = parseFloat(order.outAmount) / LAMPORTS_PER_SOL;
      console.log(`   💵 Expected to receive: ${expectedSOL.toFixed(6)} SOL`);

      // Deserialize and sign transaction
      const transactionBuf = Buffer.from(order.transaction, 'base64');
      const transaction = await import('@solana/web3.js').then(m => 
        m.VersionedTransaction.deserialize(transactionBuf)
      );
      
      transaction.sign([this.keypair]);
      const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');

      console.log(`   🚀 Executing swap...`);
      const result = await this.executeJupiterTransaction(signedTransaction, order.requestId);

      if (result && result.status === 'Success') {
        console.log(`   ✅ SOLD! Signature: ${result.signature}`);
        return true;
      } else {
        console.log(`   ❌ Swap failed`);
        return false;
      }
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      return false;
    }
  }

  async sellAll(): Promise<void> {
    console.log('═══════════════════════════════════════════════');
    console.log('        🔥 EMERGENCY SELL ALL TOKENS 🔥        ');
    console.log('═══════════════════════════════════════════════');

    // Get initial SOL balance
    const initialBalance = await this.connection.getBalance(this.keypair.publicKey);
    console.log(`\n💰 Current SOL balance: ${(initialBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Get all token balances
    const tokens = await this.getAllTokenBalances();

    if (tokens.length === 0) {
      console.log('\n✨ No tokens found to sell. Wallet is clean!');
      return;
    }

    console.log(`\n📊 Found ${tokens.length} token(s) to sell\n`);

    // Sell each token one by one
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < tokens.length; i++) {
      const success = await this.sellToken(tokens[i], i, tokens.length);
      if (success) {
        successCount++;
        // Wait 2 seconds between trades to avoid rate limits
        if (i < tokens.length - 1) {
          console.log('   ⏳ Waiting 2 seconds before next trade...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        failCount++;
      }
    }

    // Get final SOL balance
    const finalBalance = await this.connection.getBalance(this.keypair.publicKey);
    const profit = (finalBalance - initialBalance) / LAMPORTS_PER_SOL;

    console.log('\n═══════════════════════════════════════════════');
    console.log('                   SUMMARY                     ');
    console.log('═══════════════════════════════════════════════');
    console.log(`✅ Successful sells: ${successCount}`);
    console.log(`❌ Failed sells: ${failCount}`);
    console.log(`💰 Starting balance: ${(initialBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`💰 Final balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    console.log(`📈 Net change: ${profit >= 0 ? '+' : ''}${profit.toFixed(6)} SOL`);
    console.log('═══════════════════════════════════════════════\n');
  }
}

// Run the script
const seller = new SellAllTokens();
seller.sellAll().catch(console.error);

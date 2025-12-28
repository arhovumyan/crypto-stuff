// ============================================================================
// SERVICE 1: AGGRESSIVE TOKEN DISCOVERY
// ============================================================================
// Ultra-aggressive token discovery that polls every 3 seconds
// Designed to catch EVERY new token creation on Solana

import { Connection, PublicKey, ParsedInstruction } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Database, TokenStatus, log } from './database.js';

dotenv.config({ path: '../../.env' });

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112'; // Filter this out

class AggressiveTokenDiscoveryService {
  private connection: Connection;
  private db: Database;
  private isRunning = false;
  private lastSignature: string | undefined;
  private processedSignatures = new Set<string>();

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in .env');
    }
    
    // Extract WebSocket URL from RPC URL
    const wsUrl = rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: wsUrl,
    });
    
    this.db = new Database();
    
    log('🚀 AGGRESSIVE Token Discovery Service initialized');
    log('⚡ Polling with rate-limit-friendly intervals');
  }

  async start() {
    await this.db.connect();
    this.isRunning = true;
    
    log('👂 Starting sustainable token discovery...');
    log('📡 Polling Token Program every 10 seconds');
    
    // Poll Token Program at sustainable rate
    this.pollForNewTokens();
    setInterval(() => this.pollForNewTokens(), 10000); // Every 10 seconds
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      log('🛑 Shutting down Token Discovery Service...');
      this.isRunning = false;
      await this.db.disconnect();
      process.exit(0);
    });
  }
  
  private async pollForNewTokens() {
    if (!this.isRunning) return;
    
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        TOKEN_PROGRAM_ID,
        { 
          limit: 20, // Check 20 signatures
          until: this.lastSignature 
        },
        'confirmed'
      );
      
      if (signatures.length === 0) {
        return;
      }
      
      if (signatures.length > 0) {
        this.lastSignature = signatures[0].signature;
      }
      
      log(`🔍 Checking ${signatures.length} signatures...`);
      
      // Process with delays to avoid rate limits
      let discovered = 0;
      for (const sigInfo of signatures) {
        const found = await this.processSignature(sigInfo.signature);
        if (found) discovered++;
        
        // 200ms delay between each request
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      if (discovered > 0) {
        log(`✅ Discovered ${discovered} new tokens!`);
      }
      
    } catch (error) {
      log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processSignature(signature: string): Promise<boolean> {
    // Skip if we've already processed this
    if (this.processedSignatures.has(signature)) {
      return false;
    }
    this.processedSignatures.add(signature);
    
    // Clean up old signatures from memory (keep last 10000)
    if (this.processedSignatures.size > 10000) {
      const iterator = this.processedSignatures.values();
      for (let i = 0; i < 5000; i++) {
        const value = iterator.next().value;
        if (value) this.processedSignatures.delete(value);
      }
    }
    
    try {
      const tx = await this.connection.getParsedTransaction(
        signature,
        {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        }
      );
      
      if (!tx || !tx.meta || !tx.meta.logMessages) {
        return false;
      }
      
      // Check if this transaction initialized a mint
      const hasInitializeMint = tx.meta.logMessages.some(log => 
        log.includes('InitializeMint') || 
        log.includes('InitializeMint2')
      );
      
      if (!hasInitializeMint) {
        return false;
      }
      
      // Extract mint address from the transaction
      const mintAddress = await this.extractMintAddress(tx, signature);
      
      if (!mintAddress) {
        return false;
      }
      
      // Filter out wrapped SOL and system tokens
      if (mintAddress === WRAPPED_SOL) {
        return false;
      }
      
      // Check if we already have this token
      const existingToken = await this.db.getToken(mintAddress);
      if (existingToken) {
        return false;
      }
      
      const mintTime = new Date(tx.blockTime ? tx.blockTime * 1000 : Date.now());
      
      // Save to database
      await this.db.saveToken({
        mintAddress,
        mintTime,
        txSignature: signature,
        status: TokenStatus.UNPROCESSED,
        priceHistory: [],
        ath: null,
        athTimestamp: null,
        currentPrice: null,
        criteria: {
          marketCapAbove20KWithin60Min: null,
          droppedBy50PercentFromATH: null,
          maxLiquidityHolderUnder30Percent: null,
          bondingCurveProgress100Percent: null,
        },
        rejectionReason: null,
        checkCount: 0,
        liquidityFailCount: 0,
        lastCheckedAt: null,
      });
      
      log(`🆕 NEW TOKEN DISCOVERED: ${mintAddress}`);
      log(`   ├─ Mint Time: ${mintTime.toLocaleString()}`);
      log(`   ├─ TX: ${signature}`);
      log(`   └─ Status: UNPROCESSED`);
      
      return true;
      
    } catch (error) {
      // Silently skip errors (transaction might not be ready yet)
      return false;
    }
  }

  private async extractMintAddress(tx: any, signature: string): Promise<string | null> {
    try {
      // Look through all instructions for initializeMint
      const instructions = tx.transaction.message.instructions;
      
      for (const instruction of instructions) {
        // Check if it's a parsed instruction with initializeMint
        if (
          instruction.program === 'spl-token' &&
          (instruction.parsed?.type === 'initializeMint' ||
           instruction.parsed?.type === 'initializeMint2')
        ) {
          const mintAddress = instruction.parsed.info?.mint;
          if (mintAddress) {
            return mintAddress;
          }
        }
      }
      
      // Fallback: look for newly created accounts
      const postTokenBalances = tx.meta?.postTokenBalances || [];
      if (postTokenBalances.length > 0) {
        // The first token balance is usually the new mint
        return postTokenBalances[0].mint;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
}

// Start the service
const service = new AggressiveTokenDiscoveryService();
service.start().catch(error => {
  log(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});

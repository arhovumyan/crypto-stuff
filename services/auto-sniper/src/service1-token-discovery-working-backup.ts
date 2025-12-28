// ============================================================================
// SERVICE 1: TOKEN DISCOVERY
// ============================================================================
// Listens to Solana blockchain for new token mints and saves them to database
// Uses Helius WebSocket to monitor SPL Token program for InitializeMint instructions

import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Database, TokenStatus, log } from './database.js';

dotenv.config({ path: '../../.env' });

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

class TokenDiscoveryService {
  private connection: Connection;
  private db: Database;
  private isRunning = false;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in .env');
    }
    
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint: process.env.HELIUS_WS_URL,
    });
    
    this.db = new Database();
    
    log('🚀 Token Discovery Service initialized');
  }

  async start() {
    await this.db.connect();
    this.isRunning = true;
    
    log('👂 Starting to listen for new token mints...');
    log('📡 Monitoring Token Program and Token-2022 Program');
    
    // Monitor using logs subscription for new mint accounts
    this.subscribeToNewMints();
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      log('🛑 Shutting down Token Discovery Service...');
      this.isRunning = false;
      await this.db.disconnect();
      process.exit(0);
    });
  }

  private subscribeToNewMints() {
    // Multi-pronged approach to catch EVERY token:
    // 1. Subscribe to Token Program
    // 2. Subscribe to Token-2022 Program  
    // 3. Subscribe to Pump.fun Program
    // 4. Poll for recent signatures periodically
    
    log('🌐 Subscribing to token programs...');
    
    const subscriptionId = this.connection.onLogs(
      TOKEN_PROGRAM_ID,
      async (logs, context) => {
        await this.handleLogEntry(logs, context);
      },
      'confirmed'
    );

    const subscription2022 = this.connection.onLogs(
      TOKEN_2022_PROGRAM_ID,
      async (logs, context) => {
        await this.handleLogEntry(logs, context);
      },
      'confirmed'
    );
    
    const subscriptionPumpFun = this.connection.onLogs(
      PUMP_FUN_PROGRAM,
      async (logs, context) => {
        await this.handleLogEntry(logs, context);
      },
      'confirmed'
    );

    log(`✅ Subscribed to Token Program (ID: ${subscriptionId})`);
    log(`✅ Subscribed to Token-2022 Program (ID: ${subscription2022})`);
    log(`✅ Subscribed to Pump.fun Program (ID: ${subscriptionPumpFun})`);
    
    // ADDITIONAL: Poll for recent signatures every 5 seconds to catch anything we missed
    this.startPollingForNewTokens();
  }
  
  private startPollingForNewTokens() {
    log('🔄 Starting aggressive polling for new tokens...');
    let lastSignature: string | undefined = undefined;
    
    setInterval(async () => {
      try {
        // Get recent signatures for Token Program
        const signatures = await this.connection.getSignaturesForAddress(
          TOKEN_PROGRAM_ID,
          { limit: 50, until: lastSignature },
          'confirmed'
        );
        
        if (signatures.length > 0) {
          lastSignature = signatures[0].signature;
          
          // Process each signature
          for (const sigInfo of signatures) {
            try {
              const tx = await this.connection.getTransaction(sigInfo.signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed'
              });
              
              if (tx && tx.meta && tx.meta.logMessages) {
                const hasInitializeMint = tx.meta.logMessages.some((log: string) => 
                  log.includes('InitializeMint') || log.includes('InitializeMint2')
                );
                
                if (hasInitializeMint) {
                  const mintAddress = await this.extractMintAddress(tx, sigInfo.signature);
                  if (mintAddress) {
                    const existingToken = await this.db.getToken(mintAddress);
                    if (!existingToken) {
                      const mintTime = new Date(tx.blockTime ? tx.blockTime * 1000 : Date.now());
                      
                      await this.db.saveToken({
                        mintAddress,
                        mintTime,
                        txSignature: sigInfo.signature,
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
                      
                      log(`🔍 POLLED TOKEN: ${mintAddress}`);
                    }
                  }
                }
              }
            } catch (error) {
              // Skip individual transaction errors
            }
          }
        }
      } catch (error) {
        log(`⚠️ Polling error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 5000); // Poll every 5 seconds
  }
  }

  private async handleLogEntry(logs: any, context: any) {
    try {
      const signature = logs.signature;
      
      // Check if this is an InitializeMint instruction
      if (!logs.logs || !Array.isArray(logs.logs)) return;
      
      const hasInitializeMint = logs.logs.some((log: string) => 
        log.includes('InitializeMint') || 
        log.includes('InitializeMint2') ||
        log.includes('Program log: Instruction: InitializeMint') ||
        log.includes('create') ||
        log.includes('Create')
      );
      
      if (!hasInitializeMint) return;
      
      // Fetch the transaction to extract mint address
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });
      
      if (!tx || !tx.transaction) {
        log(`⚠️  Could not fetch transaction: ${signature}`);
        return;
      }
      
      // Extract mint address from transaction
      const mintAddress = await this.extractMintAddress(tx, signature);
      
      if (!mintAddress) {
        return; // Not a new mint we're interested in
      }
      
      // Check if we already have this token
      const existingToken = await this.db.getToken(mintAddress);
      if (existingToken) {
        return; // Already tracked
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
      
    } catch (error: any) {
      log(`❌ Error processing log entry: ${error.message}`);
    }
  }

  private async extractMintAddress(tx: any, signature: string): Promise<string | null> {
    try {
      // Look for newly created accounts in the transaction
      const accountKeys = tx.transaction.message.accountKeys;
      
      if (!accountKeys || accountKeys.length === 0) {
        return null;
      }
      
      // The mint is typically one of the writable accounts
      // Look through account keys for new mint accounts
      const postBalances = tx.meta?.postBalances || [];
      const preBalances = tx.meta?.preBalances || [];
      
      // Find accounts that were created in this transaction (0 pre-balance, non-zero post-balance)
      for (let i = 0; i < accountKeys.length; i++) {
        if (preBalances[i] === 0 && postBalances[i] > 0) {
          const potentialMint = accountKeys[i];
          
          // Verify this is actually a mint account by checking if it's a valid token account
          try {
            const accountInfo = await this.connection.getAccountInfo(new PublicKey(potentialMint.toString()));
            
            // Check if owned by Token Program or Token-2022 Program
            if (accountInfo && 
                (accountInfo.owner.equals(TOKEN_PROGRAM_ID) || 
                 accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) {
              
              // Check if it's a mint account (82 bytes for mint account)
              if (accountInfo.data.length === 82) {
                return potentialMint.toString();
              }
            }
          } catch (e) {
            // Continue to next account
            continue;
          }
        }
      }
      
      return null;
    } catch (error: any) {
      log(`⚠️  Error extracting mint address: ${error.message}`);
      return null;
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

const service = new TokenDiscoveryService();
service.start().catch((error) => {
  log(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});

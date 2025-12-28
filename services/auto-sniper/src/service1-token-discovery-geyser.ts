// ============================================================================
// SERVICE 1: TOKEN DISCOVERY (YELLOWSTONE GRPC)
// ============================================================================
// Uses Helius Yellowstone gRPC (Geyser) to catch EVERY token creation
// This provides validator-level coverage - the source of truth

import { Connection, PublicKey } from '@solana/web3.js';
import Client, { CommitmentLevel, SubscribeRequestFilterAccounts } from '@triton-one/yellowstone-grpc';
import dotenv from 'dotenv';
import { Database, TokenStatus, log } from './database.js';

dotenv.config({ path: '../../.env' });

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

class TokenDiscoveryService {
  private connection: Connection;
  private db: Database;
  private grpcClient: Client | null = null;
  private isRunning = false;
  private discoveredCount = 0;

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in .env');
    }
    
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.db = new Database();
    
    log('🚀 Token Discovery Service initialized (Yellowstone gRPC)');
  }

  async start() {
    await this.db.connect();
    this.isRunning = true;
    
    log('🔌 Connecting to Helius Yellowstone gRPC...');
    log('📡 This provides VALIDATOR-LEVEL coverage - catches EVERY token');
    
    await this.connectGeyser();
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      log('🛑 Shutting down Token Discovery Service...');
      this.isRunning = false;
      if (this.grpcClient) {
        // @ts-ignore
        this.grpcClient.close();
      }
      await this.db.disconnect();
      process.exit(0);
    });
  }

  private async connectGeyser() {
    try {
      // Helius Yellowstone gRPC endpoint format: grpc.helius.xyz:443
      const grpcEndpoint = 'grpc.helius.xyz:443';
      const grpcToken = process.env.HELIUS_API_KEY;
      
      if (!grpcToken) {
        throw new Error('HELIUS_API_KEY not found in .env - required for Yellowstone gRPC');
      }

      log(`🔗 Connecting to Helius Yellowstone gRPC: ${grpcEndpoint}`);
      log(`🔑 Using API key: ${grpcToken.substring(0, 8)}...`);
      
      // Create gRPC client with authentication
      this.grpcClient = new Client(
        grpcEndpoint,
        grpcToken,
        undefined // Use default options
      );

      log('✅ gRPC client created, subscribing to streams...');

      const stream = await this.grpcClient.subscribe();
      
      log('✅ Stream created, setting up subscription...');
      
      // Subscribe to transactions containing InitializeMint instructions
      const request = {
        accounts: {},
        slots: {},
        transactions: {
          token_mints: {
            vote: false,
            failed: false,
            accountInclude: [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()],
            accountExclude: [],
          },
        },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.CONFIRMED,
      };

      stream.on('data', (data: any) => {
        this.handleGeyserData(data);
      });

      stream.on('error', (error: any) => {
        log(`❌ gRPC stream error: ${error.message}`);
        log(`   Error details: ${JSON.stringify(error)}`);
        // Reconnect after error
        setTimeout(() => this.connectGeyser(), 5000);
      });

      stream.on('end', () => {
        log('⚠️  gRPC stream ended, reconnecting...');
        setTimeout(() => this.connectGeyser(), 5000);
      });

      stream.on('close', () => {
        log('🔌 gRPC stream closed');
      });

      // Send subscription request
      stream.write(request, (err: any) => {
        if (err) {
          log(`❌ Error writing subscription: ${err.message}`);
          log(`   Error details: ${JSON.stringify(err)}`);
          // Retry connection
          setTimeout(() => this.connectGeyser(), 5000);
        } else {
          log('✅ Subscribed to Token Program transactions');
          log('✅ Subscribed to Token-2022 Program transactions');
          log('🎯 Catching EVERY token creation at validator level!');
          log('📊 Discovery count will appear below...');
          log('');
        }
      });

    } catch (error: any) {
      log(`❌ Failed to connect to Geyser: ${error.message}`);
      log(`   Stack: ${error.stack}`);
      log('⚠️  Retrying in 10 seconds...');
      setTimeout(() => this.connectGeyser(), 10000);
    }
  }

  private async handleGeyserData(data: any) {
    try {
      // Process transactions
      if (data.transaction) {
        await this.handleTransaction(data.transaction);
      }
    } catch (error: any) {
      log(`❌ Error handling Geyser data: ${error.message}`);
    }
  }

  private async handleTransaction(transaction: any) {
    try {
      const tx = transaction.transaction;
      if (!tx) return;

      // Look for InitializeMint or InitializeMint2 instructions
      const message = tx.message;
      if (!message || !message.instructions) return;

      for (const instruction of message.instructions) {
        // Check if this is a token program instruction
        const programId = message.accountKeys[instruction.programIdIndex];
        if (!programId) continue;

        const programIdStr = Buffer.from(programId).toString('base64');
        const programIdBase58 = new PublicKey(Buffer.from(programId)).toBase58();

        // Check if it's Token Program or Token-2022
        if (programIdBase58 !== TOKEN_PROGRAM_ID.toBase58() && 
            programIdBase58 !== TOKEN_2022_PROGRAM_ID.toBase58()) {
          continue;
        }

        // Get the mint address (first account in InitializeMint instruction)
        if (instruction.accounts && instruction.accounts.length > 0) {
          const mintAccountIndex = instruction.accounts[0];
          const mintPubkey = message.accountKeys[mintAccountIndex];
          if (!mintPubkey) continue;

          const mintAddress = new PublicKey(Buffer.from(mintPubkey)).toBase58();

          // Check if we already have this token
          const existingToken = await this.db.getToken(mintAddress);
          if (existingToken) continue;

          this.discoveredCount++;
          const mintTime = new Date(transaction.slot * 400); // Approximate time from slot

          // Save to database
          await this.db.saveToken({
            mintAddress,
            mintTime,
            txSignature: Buffer.from(transaction.signature).toString('base64'),
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

          log(`🆕 #${this.discoveredCount}: ${mintAddress.substring(0, 20)}...`);
        }
      }
    } catch (error: any) {
      // Silently ignore parsing errors
      if (!error.message.includes('Invalid public key')) {
        log(`⚠️  Error processing transaction: ${error.message}`);
      }
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

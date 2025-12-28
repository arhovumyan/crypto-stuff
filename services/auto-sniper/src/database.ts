// ============================================================================
// Database Schema and MongoDB Connection
// ============================================================================

import { MongoClient, Db, Collection } from 'mongodb';

export enum TokenStatus {
  UNPROCESSED = 'UNPROCESSED',
  CHECKING = 'CHECKING',
  QUALIFIED = 'QUALIFIED',
  REJECTED = 'REJECTED',
  TRADED = 'TRADED',
  POSITION_OPEN = 'POSITION_OPEN',
  POSITION_CLOSED = 'POSITION_CLOSED'
}

export interface Token {
  mintAddress: string;
  mintTime: Date;
  txSignature: string;
  status: TokenStatus;
  
  // Price tracking
  priceHistory: PricePoint[];
  ath: number | null;
  athTimestamp: Date | null;
  currentPrice: number | null;
  
  // Criteria checks
  criteria: {
    marketCapAbove20KWithin60Min: boolean | null;
    droppedBy50PercentFromATH: boolean | null;
    maxLiquidityHolderUnder30Percent: boolean | null;
    bondingCurveProgress100Percent: boolean | null;
  };
  
  // Rejection reason
  rejectionReason: string | null;
  
  // Check tracking
  checkCount: number;
  liquidityFailCount: number;
  
  // Trade data
  tradeData?: {
    entryPrice: number;
    entryAmount: number;
    entryTime: Date;
    exitPrice?: number;
    exitAmount?: number;
    exitTime?: Date;
    profitLoss?: number;
    profitLossPercent?: number;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastCheckedAt: Date | null;
}

export interface PricePoint {
  price: number;
  timestamp: Date;
  marketCap: number;
}

export class Database {
  private client: MongoClient;
  private db: Db | null = null;
  private tokensCollection: Collection<Token> | null = null;

  constructor(private mongoUrl: string = 'mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/') {}

  async connect(dbName: string = 'solana_auto_sniper') {
    this.client = new MongoClient(this.mongoUrl);
    await this.client.connect();
    this.db = this.client.db(dbName);
    this.tokensCollection = this.db.collection<Token>('tokens');
    
    // Create indexes
    await this.tokensCollection.createIndex({ mintAddress: 1 }, { unique: true });
    await this.tokensCollection.createIndex({ status: 1 });
    await this.tokensCollection.createIndex({ mintTime: 1 });
    await this.tokensCollection.createIndex({ 'tradeData.entryTime': 1 });
    
    console.log(`✅ Connected to MongoDB: ${dbName}`);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('Disconnected from MongoDB');
    }
  }

  getTokensCollection(): Collection<Token> {
    if (!this.tokensCollection) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.tokensCollection;
  }

  // Helper methods for common operations
  async saveToken(token: Partial<Token>) {
    const collection = this.getTokensCollection();
    return await collection.insertOne({
      ...token,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Token);
  }

  async updateToken(mintAddress: string, update: Partial<Token>) {
    const collection = this.getTokensCollection();
    return await collection.updateOne(
      { mintAddress },
      { 
        $set: { 
          ...update, 
          updatedAt: new Date() 
        } 
      }
    );
  }

  async getTokensByStatus(status: TokenStatus) {
    const collection = this.getTokensCollection();
    return await collection.find({ status }).toArray();
  }

  async getToken(mintAddress: string) {
    const collection = this.getTokensCollection();
    return await collection.findOne({ mintAddress });
  }
}

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
};

export const log = (message: string, data?: any) => {
  const timestamp = formatTime(new Date());
  if (data) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
};

// MongoDB database connection and models
import { MongoClient, Db, Collection } from 'mongodb';
import { Token, Position } from './types';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'solana_auto_trader';

export class Database {
  private static client: MongoClient;
  private static db: Db;
  private static connected = false;

  static async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.client = new MongoClient(MONGODB_URI);
      await this.client.connect();
      this.db = this.client.db(DB_NAME);
      this.connected = true;
      console.log('✓ Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  static getTokensCollection(): Collection<Token> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return this.db.collection<Token>('tokens');
  }

  static getPositionsCollection(): Collection<Position> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return this.db.collection<Position>('positions');
  }

  static async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.connected = false;
      console.log('Disconnected from MongoDB');
    }
  }

  // Helper methods for tokens
  static async saveToken(token: Token): Promise<void> {
    const collection = this.getTokensCollection();
    await collection.updateOne(
      { address: token.address },
      { $set: token },
      { upsert: true }
    );
  }

  static async getToken(address: string): Promise<Token | null> {
    const collection = this.getTokensCollection();
    return await collection.findOne({ address });
  }

  static async getUnvalidatedTokens(): Promise<Token[]> {
    const collection = this.getTokensCollection();
    return await collection.find({ validated: false }).toArray();
  }

  static async getValidatedTokens(): Promise<Token[]> {
    const collection = this.getTokensCollection();
    return await collection.find({ 
      validated: true, 
      meetsCriteria: true 
    }).toArray();
  }

  // Helper methods for positions
  static async savePosition(position: Position): Promise<void> {
    const collection = this.getPositionsCollection();
    await collection.updateOne(
      { tokenAddress: position.tokenAddress, status: 'active' },
      { $set: position },
      { upsert: true }
    );
  }

  static async getActivePositions(): Promise<Position[]> {
    const collection = this.getPositionsCollection();
    return await collection.find({ status: 'active' }).toArray();
  }

  static async closePosition(tokenAddress: string, exitPrice: number): Promise<void> {
    const collection = this.getPositionsCollection();
    await collection.updateOne(
      { tokenAddress, status: 'active' },
      { 
        $set: { 
          status: 'closed', 
          exitPrice, 
          exitTime: new Date() 
        } 
      }
    );
  }
}

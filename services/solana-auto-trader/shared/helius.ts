// Helius API client for fetching token metadata and holder information
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || '';

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
}

export interface TokenHolder {
  owner: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

export class HeliusClient {
  private static connection: Connection;

  static getConnection(): Connection {
    if (!this.connection) {
      this.connection = new Connection(HELIUS_RPC_URL, 'confirmed');
    }
    return this.connection;
  }

  static async getTokenMetadata(mintAddress: string): Promise<TokenMetadata | null> {
    try {
      const response = await axios.post(
        `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`,
        {
          mintAccounts: [mintAddress]
        }
      );

      if (response.data && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      console.error(`Error fetching metadata for ${mintAddress}:`, error);
      return null;
    }
  }

  static async getTopHolders(mintAddress: string, limit: number = 10): Promise<TokenHolder[]> {
    try {
      const connection = this.getConnection();
      const mintPubkey = new PublicKey(mintAddress);

      // Get token accounts by mint
      const accounts = await connection.getTokenLargestAccounts(mintPubkey);
      
      const holders: TokenHolder[] = accounts.value.map(account => ({
        owner: account.address.toBase58(),
        amount: account.amount,
        decimals: account.decimals,
        uiAmount: account.uiAmount || 0
      }));

      return holders.slice(0, limit);
    } catch (error) {
      console.error(`Error fetching top holders for ${mintAddress}:`, error);
      return [];
    }
  }

  static async checkLiquidityDistribution(mintAddress: string): Promise<{
    topHolderPercent: number;
    passes: boolean;
  }> {
    try {
      const holders = await this.getTopHolders(mintAddress, 10);
      
      if (holders.length === 0) {
        return { topHolderPercent: 100, passes: false };
      }

      // Calculate total supply from all holders
      const totalSupply = holders.reduce((sum, holder) => sum + holder.uiAmount, 0);
      
      // Get largest holder percentage
      const largestHolder = Math.max(...holders.map(h => h.uiAmount));
      const topHolderPercent = (largestHolder / totalSupply) * 100;

      return {
        topHolderPercent,
        passes: topHolderPercent < 30
      };
    } catch (error) {
      console.error(`Error checking liquidity distribution for ${mintAddress}:`, error);
      return { topHolderPercent: 100, passes: false };
    }
  }
}

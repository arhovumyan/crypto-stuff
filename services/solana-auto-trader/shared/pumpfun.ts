// Pump.fun API client for fetching newly created tokens
import axios from 'axios';

const PUMP_API = 'https://frontend-api.pump.fun';

export interface PumpToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  metadata_uri: string;
  twitter: string;
  telegram: string;
  bonding_curve: string;
  associated_bonding_curve: string;
  creator: string;
  created_timestamp: number;
  raydium_pool: string;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  total_supply: number;
  website: string;
  show_name: boolean;
  king_of_the_hill_timestamp: number;
  market_cap: number;
  reply_count: number;
  last_reply: number;
  nsfw: boolean;
  market_id: string;
  inverted: boolean;
  is_currently_live: boolean;
  username: string;
  profile_image: string;
  usd_market_cap: number;
}

export class PumpFunClient {
  static async getLatestTokens(limit: number = 50): Promise<PumpToken[]> {
    try {
      // Get recently created tokens from pump.fun
      const response = await axios.get(`${PUMP_API}/coins/latest`, {
        params: {
          limit,
          offset: 0,
          includeNsfw: false
        },
        timeout: 10000
      });

      if (!response.data) {
        return [];
      }

      return response.data;
    } catch (error: any) {
      console.error('Error fetching from Pump.fun:', error.message);
      return [];
    }
  }

  static async getTokenInfo(mintAddress: string): Promise<PumpToken | null> {
    try {
      const response = await axios.get(`${PUMP_API}/coins/${mintAddress}`, {
        timeout: 10000
      });

      return response.data || null;
    } catch (error) {
      console.error(`Error fetching token ${mintAddress} from Pump.fun:`, error);
      return null;
    }
  }
}

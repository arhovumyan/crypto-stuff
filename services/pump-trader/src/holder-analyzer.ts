/**
 * Holder Concentration Analyzer
 * Uses Helius to fetch token holders and calculate concentration
 */

import axios from 'axios';
import { config } from './config';
import { Logger } from './logger';

export interface HolderInfo {
  address: string;
  amount: string;
  decimals: number;
  owner: string;
}

export interface ConcentrationAnalysis {
  totalSupply: number;
  topHolderAddress: string;
  topHolderAmount: number;
  topHolderPercent: number;
  passesCheck: boolean;
  holderCount: number;
}

export class HolderAnalyzer {
  /**
   * Analyze holder concentration for a token
   * Returns null if data cannot be fetched
   */
  async analyzeConcentration(mint: string): Promise<ConcentrationAnalysis | null> {
    try {
      // Get token supply first
      const supply = await this.getTokenSupply(mint);
      if (!supply) {
        Logger.debug(`Could not fetch token supply for ${mint}`);
        return null;
      }

      // Get largest token accounts
      const holders = await this.getLargestHolders(mint);
      if (!holders || holders.length === 0) {
        Logger.debug(`No holder data available for ${mint}`);
        return null;
      }

      // Find the largest non-program holder
      // Exclude known program accounts (Raydium, Pump.fun, etc.)
      const EXCLUDED_PROGRAMS = new Set([
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium Authority
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
        '11111111111111111111111111111111', // System Program
        config.pumpfunProgramId, // Pump.fun
      ]);

      let topHolder: HolderInfo | null = null;
      let filteredHolderCount = 0;

      for (const holder of holders) {
        if (!EXCLUDED_PROGRAMS.has(holder.owner)) {
          filteredHolderCount++;
          if (!topHolder) {
            topHolder = holder;
          }
        }
      }

      if (!topHolder) {
        Logger.debug(`All holders are program accounts for ${mint}`);
        return null;
      }

      const topHolderAmount = parseFloat(topHolder.amount) / Math.pow(10, topHolder.decimals);
      const topHolderPercent = (topHolderAmount / supply) * 100;

      const passesCheck = topHolderPercent <= config.maxHolderConcentrationPercent;

      return {
        totalSupply: supply,
        topHolderAddress: topHolder.owner,
        topHolderAmount,
        topHolderPercent,
        passesCheck,
        holderCount: filteredHolderCount,
      };

    } catch (error: any) {
      Logger.debug(`Error analyzing holder concentration for ${mint}`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get token supply using Helius RPC
   */
  private async getTokenSupply(mint: string): Promise<number | null> {
    try {
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenSupply',
          params: [mint],
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data.result && response.data.result.value) {
        const supply = parseFloat(response.data.result.value.amount);
        const decimals = response.data.result.value.decimals;
        return supply / Math.pow(10, decimals);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get largest token holders using Helius RPC
   */
  private async getLargestHolders(mint: string, limit: number = 20): Promise<HolderInfo[]> {
    try {
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenLargestAccounts',
          params: [mint],
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.data.result || !response.data.result.value) {
        return [];
      }

      const accounts = response.data.result.value;

      // Get owner information for each account
      const holders: HolderInfo[] = [];
      
      for (const account of accounts.slice(0, limit)) {
        try {
          const accountInfo = await this.getAccountOwner(account.address);
          if (accountInfo) {
            holders.push({
              address: account.address,
              amount: account.amount,
              decimals: account.decimals,
              owner: accountInfo.owner,
            });
          }
        } catch (error) {
          // Skip this account if we can't get owner info
          continue;
        }
      }

      return holders;

    } catch (error) {
      return [];
    }
  }

  /**
   * Get the owner of a token account
   */
  private async getAccountOwner(accountAddress: string): Promise<{ owner: string } | null> {
    try {
      const response = await axios.post(
        config.heliusRpcUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            accountAddress,
            {
              encoding: 'jsonParsed',
            },
          ],
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data.result && response.data.result.value) {
        const parsed = response.data.result.value.data?.parsed;
        if (parsed && parsed.info && parsed.info.owner) {
          return { owner: parsed.info.owner };
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}

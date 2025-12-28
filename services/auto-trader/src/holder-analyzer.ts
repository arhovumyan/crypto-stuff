/**
 * Holder Concentration Analyzer
 * Checks if any single wallet holds more than 30% of liquidity
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config';
import { Logger } from './logger';

export interface HolderAnalysis {
  topHolderPercent: number;
  topHolderAddress: string;
  passesCheck: boolean;
  totalSupply: number;
}

export class HolderAnalyzer {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
  }

  /**
   * Analyze token holder concentration
   * Returns true if no single holder has more than maxPercent of supply
   */
  async analyzeConcentration(tokenMint: string, maxPercent: number = config.maxHolderConcentrationPercent): Promise<HolderAnalysis | null> {
    try {
      const mintPubkey = new PublicKey(tokenMint);

      // Get token supply
      const supply = await this.connection.getTokenSupply(mintPubkey);
      const totalSupply = supply.value.uiAmount || 0;

      if (totalSupply === 0) {
        return null;
      }

      // Get largest token accounts
      const largestAccounts = await this.connection.getTokenLargestAccounts(mintPubkey);

      if (largestAccounts.value.length === 0) {
        return null;
      }

      // Find the largest holder
      const topHolder = largestAccounts.value[0];
      const topHolderAmount = topHolder.uiAmount || 0;
      const topHolderPercent = (topHolderAmount / totalSupply) * 100;

      const analysis: HolderAnalysis = {
        topHolderPercent,
        topHolderAddress: topHolder.address.toString(),
        passesCheck: topHolderPercent <= maxPercent,
        totalSupply,
      };

      return analysis;

    } catch (error: any) {
      Logger.debug(`Error analyzing holder concentration for ${tokenMint}: ${error.message}`);
      return null;
    }
  }

  /**
   * Quick check if holder concentration passes
   */
  async passesConcentrationCheck(tokenMint: string): Promise<boolean> {
    const analysis = await this.analyzeConcentration(tokenMint);
    if (!analysis) return false;
    return analysis.passesCheck;
  }
}

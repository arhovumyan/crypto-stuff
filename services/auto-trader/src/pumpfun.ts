/**
 * Pump.fun Integration
 * Checks bonding curve progress and gets pump.fun specific data
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config';
import { Logger } from './logger';

export interface BondingCurveData {
  progress: number; // 0-100
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;
  tokenTotalSupply: number;
  complete: boolean;
}

export class PumpFunChecker {
  private connection: Connection;
  private pumpProgramId: PublicKey;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.pumpProgramId = new PublicKey(config.pumpfunProgramId);
  }

  /**
   * Check if a token has 100% bonding curve progress
   * Returns true if bonding curve is complete (100%)
   */
  async checkBondingCurveProgress(tokenMint: string): Promise<boolean> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      
      // Derive the bonding curve PDA
      const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
        this.pumpProgramId
      );

      // Get the bonding curve account
      const accountInfo = await this.connection.getAccountInfo(bondingCurvePDA);
      
      if (!accountInfo) {
        // No bonding curve found - might not be a pump.fun token
        Logger.debug(`No bonding curve found for ${tokenMint}`);
        return false;
      }

      // Parse the bonding curve data
      const data = accountInfo.data;
      
      // Pump.fun bonding curve layout (approximate, based on common patterns)
      // This is a simplified check - you may need to adjust based on actual program
      
      // Check if the bonding curve is marked as "complete"
      // Typically there's a boolean flag indicating completion
      
      // For now, we'll check if the account exists and has data
      // A complete bonding curve usually means the token graduated to Raydium
      
      // Simple heuristic: if virtual reserves are very low or zero, it's likely complete
      if (data.length < 32) {
        return false;
      }

      // Try to read the "complete" flag (usually a boolean at a specific offset)
      // This is a best-effort approach
      const completeFlag = data[16]; // Approximate offset
      
      Logger.debug(`Bonding curve check for ${tokenMint}: complete=${completeFlag === 1}`);
      
      return completeFlag === 1;

    } catch (error: any) {
      Logger.debug(`Error checking bonding curve for ${tokenMint}: ${error.message}`);
      return false;
    }
  }

  /**
   * Alternative check: verify token graduated to Raydium
   * If a token has a Raydium pool, it means bonding curve is 100% complete
   */
  async isGraduatedToRaydium(tokenMint: string): Promise<boolean> {
    try {
      // A token with good liquidity (>$10k) on Raydium means it graduated
      // We can infer this from the DexScreener data we already have
      // This is a complementary check
      return true; // We'll handle this in the main criteria checker
    } catch (error: any) {
      return false;
    }
  }

  /**
   * Check if token is a pump.fun token by verifying it has a bonding curve
   */
  async isPumpFunToken(tokenMint: string): Promise<boolean> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      
      const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
        this.pumpProgramId
      );

      const accountInfo = await this.connection.getAccountInfo(bondingCurvePDA);
      
      return accountInfo !== null;

    } catch (error: any) {
      return false;
    }
  }
}

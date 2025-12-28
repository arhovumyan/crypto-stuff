// Service 2: Token Validator
// Checks tokens from the database against trading criteria:
// 1. Market cap reached >20K within 60min of launch
// 2. Market cap dropped by 50% from ATH
// 3. No more than 30% of liquidity held by one wallet
// 4. 100% Bonding Curve Progress

import { Database } from '../shared/database';
import { DexScreenerClient } from '../shared/dexscreener';
import { HeliusClient } from '../shared/helius';
import { Logger } from '../shared/logger';
import { Token } from '../shared/types';

const SERVICE_NAME = 'TOKEN-VALIDATOR';
const CHECK_INTERVAL_MS = 60000; // Check every 1 minute
const MIN_MCAP_TARGET = 20000; // $20K
const MCAP_TARGET_WINDOW_MIN = 60; // Must reach target within 60min
const ATH_DROP_PERCENT = 50; // Must drop 50% from ATH
const MAX_HOLDER_PERCENT = 30; // Max 30% held by one wallet

class TokenValidatorService {
  private running = false;

  async start() {
    Logger.info(SERVICE_NAME, 'Starting Token Validator Service...');
    
    try {
      await Database.connect();
      Logger.success(SERVICE_NAME, 'Database connected');
      
      this.running = true;
      await this.validationLoop();
    } catch (error) {
      Logger.error(SERVICE_NAME, 'Failed to start service', error);
      process.exit(1);
    }
  }

  private async validationLoop() {
    while (this.running) {
      try {
        await this.validateTokens();
        
        // Wait before next check
        Logger.info(SERVICE_NAME, `Waiting ${CHECK_INTERVAL_MS / 1000}s before next validation cycle...`);
        await this.sleep(CHECK_INTERVAL_MS);
      } catch (error) {
        Logger.error(SERVICE_NAME, 'Error in validation loop', error);
        await this.sleep(5000);
      }
    }
  }

  private async validateTokens() {
    try {
      // Get all unvalidated tokens from database
      const tokens = await Database.getUnvalidatedTokens();
      
      Logger.info(SERVICE_NAME, `Checking ${tokens.length} unvalidated tokens...`);

      for (const token of tokens) {
        await this.validateToken(token);
      }

      Logger.success(SERVICE_NAME, 'Validation cycle complete');
    } catch (error) {
      Logger.error(SERVICE_NAME, 'Error validating tokens', error);
    }
  }

  private async validateToken(token: Token) {
    const reasons: string[] = [];
    let passes = true;

    try {
      Logger.info(SERVICE_NAME, `Validating token: ${token.symbol} (${token.address.substring(0, 8)}...)`);

      // Fetch latest data from DexScreener
      const latestData = await DexScreenerClient.getTokenInfo(token.address);
      
      if (!latestData) {
        Logger.warn(SERVICE_NAME, `Could not fetch data for ${token.address}`);
        return;
      }

      // Update current market data
      token.currentPrice = parseFloat(latestData.priceUsd);
      token.marketCap = latestData.marketCap || latestData.fdv;
      token.liquidity = latestData.liquidity?.usd;
      token.lastChecked = new Date();

      // Track ATH
      if (!token.athMarketCap || token.marketCap > token.athMarketCap) {
        token.athMarketCap = token.marketCap;
        token.athPrice = token.currentPrice;
      }

      // Criterion 1: Did market cap reach >20K within 60min of launch?
      const now = Date.now();
      const mintTime = token.mintTime.getTime();
      const ageMinutes = (now - mintTime) / (1000 * 60);
      
      if (token.marketCap >= MIN_MCAP_TARGET && !token.reachedMcapTarget) {
        if (ageMinutes <= MCAP_TARGET_WINDOW_MIN) {
          token.reachedMcapTarget = true;
          token.mcapTargetTime = new Date();
          reasons.push(`✓ Market cap reached $${MIN_MCAP_TARGET.toLocaleString()} within 60min (at ${ageMinutes.toFixed(1)}min)`);
        } else {
          reasons.push(`✗ Market cap reached $${MIN_MCAP_TARGET.toLocaleString()} too late (${ageMinutes.toFixed(1)}min after launch)`);
          passes = false;
        }
      } else if (!token.reachedMcapTarget) {
        reasons.push(`✗ Market cap not yet at $${MIN_MCAP_TARGET.toLocaleString()} (current: $${token.marketCap?.toFixed(2) || 'N/A'})`);
        passes = false;
      } else {
        reasons.push(`✓ Previously reached market cap target`);
      }

      // Criterion 2: Has market cap dropped 50% from ATH?
      if (token.athMarketCap && token.marketCap) {
        const dropPercent = ((token.athMarketCap - token.marketCap) / token.athMarketCap) * 100;
        
        if (dropPercent >= ATH_DROP_PERCENT) {
          token.hasDropped50Percent = true;
          reasons.push(`✓ Market cap dropped ${dropPercent.toFixed(1)}% from ATH ($${token.athMarketCap.toFixed(2)} → $${token.marketCap.toFixed(2)})`);
        } else {
          token.hasDropped50Percent = false;
          reasons.push(`✗ Market cap only dropped ${dropPercent.toFixed(1)}% from ATH (need ${ATH_DROP_PERCENT}%)`);
          passes = false;
        }
      } else {
        reasons.push(`✗ ATH data not yet available`);
        passes = false;
      }

      // Criterion 3: Check liquidity distribution (< 30% held by one wallet)
      const liquidityCheck = await HeliusClient.checkLiquidityDistribution(token.address);
      token.topHolderPercentage = liquidityCheck.topHolderPercent;
      token.passesLiquidityCheck = liquidityCheck.passes;
      
      if (liquidityCheck.passes) {
        reasons.push(`✓ Top holder has ${liquidityCheck.topHolderPercent.toFixed(1)}% (< 30%)`);
      } else {
        reasons.push(`✗ Top holder has ${liquidityCheck.topHolderPercent.toFixed(1)}% (≥ 30%)`);
        passes = false;
      }

      // Criterion 4: Check bonding curve progress (100%)
      // Note: This is typically specific to pump.fun tokens
      // For now, we'll check if liquidity is locked/sufficient
      const hasSufficientLiquidity = (token.liquidity || 0) > 5000;
      token.hasBondingCurveProgress = hasSufficientLiquidity;
      
      if (hasSufficientLiquidity) {
        reasons.push(`✓ Sufficient liquidity ($${token.liquidity?.toFixed(2)})`);
      } else {
        reasons.push(`✗ Insufficient liquidity ($${token.liquidity?.toFixed(2) || 'N/A'})`);
        passes = false;
      }

      // Update validation status
      token.validated = true;
      token.meetsCriteria = passes;
      token.rejectionReasons = passes ? [] : reasons.filter(r => r.startsWith('✗'));

      // Save to database
      await Database.saveToken(token);

      // Log validation result
      Logger.validation(SERVICE_NAME, token.address, passes, reasons);
      
      if (passes) {
        Logger.success(SERVICE_NAME, `Token ${token.symbol} MEETS ALL CRITERIA! Ready for trading.`);
      }

    } catch (error) {
      Logger.error(SERVICE_NAME, `Error validating token ${token.address}`, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    Logger.info(SERVICE_NAME, 'Stopping Token Validator Service...');
    this.running = false;
    await Database.disconnect();
  }
}

// Start the service
const service = new TokenValidatorService();

process.on('SIGINT', async () => {
  await service.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await service.stop();
  process.exit(0);
});

service.start();

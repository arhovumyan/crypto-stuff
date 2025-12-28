/**
 * Criteria Checker
 * Evaluates tokens against all 5 criteria
 */

import { config } from './config';
import { Logger } from './logger';
import { DexScreenerAPI, TokenData } from './dexscreener';
import { PumpFunChecker } from './pumpfun';
import { HolderAnalyzer } from './holder-analyzer';

export interface CriteriaResult {
  passed: boolean;
  reason: string;
  token?: TokenData;
  allCriteriaDetails?: {
    ageCheck: boolean;
    marketCapCheck: boolean;
    drawdownCheck: boolean;
    holderCheck: boolean;
    bondingCurveCheck: boolean;
  };
}

export interface TokenHistory {
  mint: string;
  athMarketCap: number;
  athTimestamp: Date;
  firstSeenMarketCap: number;
  firstSeenTimestamp: Date;
  reachedMinMarketCap: boolean;
  reachedMinMarketCapAt?: Date;
}

export class CriteriaChecker {
  private dexScreener: DexScreenerAPI;
  private pumpFun: PumpFunChecker;
  private holderAnalyzer: HolderAnalyzer;
  private tokenHistory: Map<string, TokenHistory> = new Map();

  constructor() {
    this.dexScreener = new DexScreenerAPI();
    this.pumpFun = new PumpFunChecker();
    this.holderAnalyzer = new HolderAnalyzer();
  }

  /**
   * Check all criteria for a token
   */
  async checkAllCriteria(mint: string): Promise<CriteriaResult> {
    // Fetch token data
    const token = await this.dexScreener.getTokenData(mint);
    
    if (!token) {
      return {
        passed: false,
        reason: 'No data available from DexScreener',
      };
    }

    Logger.coinDetected(token.name, token.symbol, mint, token.ageHours);

    // Initialize token history if not exists
    if (!this.tokenHistory.has(mint)) {
      this.tokenHistory.set(mint, {
        mint,
        athMarketCap: token.marketCapUsd,
        athTimestamp: new Date(),
        firstSeenMarketCap: token.marketCapUsd,
        firstSeenTimestamp: token.pairCreatedAt,
        reachedMinMarketCap: token.marketCapUsd >= config.minMarketCapUsd,
        reachedMinMarketCapAt: token.marketCapUsd >= config.minMarketCapUsd ? new Date() : undefined,
      });
    }

    const history = this.tokenHistory.get(mint)!;

    // Update ATH
    if (token.marketCapUsd > history.athMarketCap) {
      history.athMarketCap = token.marketCapUsd;
      history.athTimestamp = new Date();
    }

    // Update min market cap reached
    if (!history.reachedMinMarketCap && token.marketCapUsd >= config.minMarketCapUsd) {
      history.reachedMinMarketCap = true;
      history.reachedMinMarketCapAt = new Date();
    }

    // CRITERION 1: Age check (0-24 hours)
    if (token.ageHours > config.maxCoinAgeHours) {
      Logger.criteriaCheck(mint, 'Age Check', false, `${token.ageHours.toFixed(2)}h > ${config.maxCoinAgeHours}h`);
      Logger.tokenRejected(mint, 'Token too old');
      return {
        passed: false,
        reason: `Token too old (${token.ageHours.toFixed(2)} hours)`,
        token,
      };
    }
    Logger.criteriaCheck(mint, 'Age Check', true, `${token.ageHours.toFixed(2)}h ≤ ${config.maxCoinAgeHours}h`);

    // CRITERION 2: Market cap reached 20K within 60 minutes of launch
    const minutesSinceLaunch = (Date.now() - token.pairCreatedAt.getTime()) / (1000 * 60);
    
    if (!history.reachedMinMarketCap) {
      if (minutesSinceLaunch > config.marketCapWindowMinutes) {
        Logger.criteriaCheck(mint, 'Market Cap Timing', false, 
          `Never reached $${config.minMarketCapUsd.toLocaleString()} within ${config.marketCapWindowMinutes} min`);
        Logger.tokenRejected(mint, 'Did not reach minimum market cap in time');
        return {
          passed: false,
          reason: `Never reached $${config.minMarketCapUsd.toLocaleString()} within ${config.marketCapWindowMinutes} minutes`,
          token,
        };
      } else {
        Logger.criteriaCheck(mint, 'Market Cap Timing', false, 
          `Waiting... Current: $${token.marketCapUsd.toLocaleString()}, Target: $${config.minMarketCapUsd.toLocaleString()}`);
        return {
          passed: false,
          reason: 'Waiting for market cap to reach minimum',
          token,
        };
      }
    }

    // Check that it reached within the window
    if (history.reachedMinMarketCapAt) {
      const minutesToReachMcap = (history.reachedMinMarketCapAt.getTime() - token.pairCreatedAt.getTime()) / (1000 * 60);
      if (minutesToReachMcap > config.marketCapWindowMinutes) {
        Logger.criteriaCheck(mint, 'Market Cap Timing', false, 
          `Reached $${config.minMarketCapUsd.toLocaleString()} after ${minutesToReachMcap.toFixed(1)} min (max ${config.marketCapWindowMinutes} min)`);
        Logger.tokenRejected(mint, 'Market cap timing failed');
        return {
          passed: false,
          reason: 'Market cap timing failed',
          token,
        };
      }
      Logger.criteriaCheck(mint, 'Market Cap Timing', true, 
        `Reached $${config.minMarketCapUsd.toLocaleString()} in ${minutesToReachMcap.toFixed(1)} min`);
    } else {
      Logger.criteriaCheck(mint, 'Market Cap Timing', true, 
        `Currently at $${token.marketCapUsd.toLocaleString()}`);
    }

    // CRITERION 3: Market cap dropped by 50% from ATH
    const drawdownPercent = ((history.athMarketCap - token.marketCapUsd) / history.athMarketCap) * 100;
    
    if (drawdownPercent < config.requiredDrawdownPercent) {
      Logger.criteriaCheck(mint, 'Drawdown Check', false, 
        `${drawdownPercent.toFixed(2)}% < ${config.requiredDrawdownPercent}% (ATH: $${history.athMarketCap.toLocaleString()}, Current: $${token.marketCapUsd.toLocaleString()})`);
      Logger.tokenRejected(mint, 'Insufficient drawdown from ATH');
      return {
        passed: false,
        reason: `Insufficient drawdown (${drawdownPercent.toFixed(2)}%)`,
        token,
      };
    }
    Logger.criteriaCheck(mint, 'Drawdown Check', true, 
      `${drawdownPercent.toFixed(2)}% ≥ ${config.requiredDrawdownPercent}% (ATH: $${history.athMarketCap.toLocaleString()}, Current: $${token.marketCapUsd.toLocaleString()})`);

    // CRITERION 4: Holder concentration check
    const holderAnalysis = await this.holderAnalyzer.analyzeConcentration(mint);
    
    if (!holderAnalysis) {
      Logger.criteriaCheck(mint, 'Holder Concentration', false, 'Could not analyze');
      Logger.tokenRejected(mint, 'Could not analyze holder concentration');
      return {
        passed: false,
        reason: 'Could not analyze holder concentration',
        token,
      };
    }

    if (!holderAnalysis.passesCheck) {
      Logger.criteriaCheck(mint, 'Holder Concentration', false, 
        `Top holder: ${holderAnalysis.topHolderPercent.toFixed(2)}% > ${config.maxHolderConcentrationPercent}%`);
      Logger.tokenRejected(mint, 'Holder concentration too high');
      return {
        passed: false,
        reason: `Holder concentration too high (${holderAnalysis.topHolderPercent.toFixed(2)}%)`,
        token,
      };
    }
    Logger.criteriaCheck(mint, 'Holder Concentration', true, 
      `Top holder: ${holderAnalysis.topHolderPercent.toFixed(2)}% ≤ ${config.maxHolderConcentrationPercent}%`);

    // CRITERION 5: Bonding curve progress 100%
    const bondingCurveComplete = await this.pumpFun.checkBondingCurveProgress(mint);
    
    // Alternative: if liquidity is high enough (>$50k), assume graduated
    const likelyGraduated = token.liquidityUsd >= 50000;
    const passedBondingCurve = bondingCurveComplete || likelyGraduated;

    if (!passedBondingCurve) {
      Logger.criteriaCheck(mint, 'Bonding Curve Progress', false, 
        `Not at 100% (Liquidity: $${token.liquidityUsd.toLocaleString()})`);
      Logger.tokenRejected(mint, 'Bonding curve not complete');
      return {
        passed: false,
        reason: 'Bonding curve not at 100%',
        token,
      };
    }
    Logger.criteriaCheck(mint, 'Bonding Curve Progress', true, 
      likelyGraduated ? `Graduated to Raydium (Liquidity: $${token.liquidityUsd.toLocaleString()})` : '100% complete');

    // ALL CRITERIA PASSED!
    Logger.tokenPassed(mint);

    return {
      passed: true,
      reason: 'All criteria passed',
      token,
      allCriteriaDetails: {
        ageCheck: true,
        marketCapCheck: true,
        drawdownCheck: true,
        holderCheck: true,
        bondingCurveCheck: true,
      },
    };
  }

  /**
   * Get token history for a specific token
   */
  getTokenHistory(mint: string): TokenHistory | undefined {
    return this.tokenHistory.get(mint);
  }

  /**
   * Clear old token histories (for memory management)
   */
  clearOldHistories(): void {
    const now = Date.now();
    const maxAge = config.maxCoinAgeHours * 60 * 60 * 1000; // Convert to ms

    for (const [mint, history] of this.tokenHistory.entries()) {
      if (now - history.firstSeenTimestamp.getTime() > maxAge) {
        this.tokenHistory.delete(mint);
      }
    }
  }
}

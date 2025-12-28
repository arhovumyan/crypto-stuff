// ============================================================================
// SERVICE 2: TOKEN EVALUATION
// ============================================================================
// Periodically checks tokens against criteria and updates their status

import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { Database, TokenStatus, Token, log } from './database.js';

dotenv.config({ path: '../../.env' });

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
  boosts?: {
    active: number;
  };
  volume?: {
    h24: number;
  };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

class TokenEvaluationService {
  private connection: Connection;
  private db: Database;
  private isRunning = false;
  private checkIntervalMs = 60_000; // 1 minute

  constructor() {
    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('HELIUS_RPC_URL or SOLANA_RPC_URL not found in .env');
    }
    
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.db = new Database();
    
    log('🔍 Token Evaluation Service initialized');
  }

  async start() {
    await this.db.connect();
    this.isRunning = true;
    
    log('🔄 Starting periodic token evaluation...');
    log(`⏱️  Checking tokens every ${this.checkIntervalMs / 1000} seconds`);
    
    // Run immediately
    await this.evaluateTokens();
    
    // Then run periodically
    const intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.evaluateTokens();
      }
    }, this.checkIntervalMs);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      log('🛑 Shutting down Token Evaluation Service...');
      this.isRunning = false;
      clearInterval(intervalId);
      await this.db.disconnect();
      process.exit(0);
    });
  }

  private async evaluateTokens() {
    try {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('🔍 Starting token evaluation cycle...');
      
      // Get all tokens that need checking (check ALL statuses except POSITION_CLOSED)
      // This includes REJECTED tokens so they can re-qualify if conditions change
      const tokensToCheck = await this.db.getTokensCollection().find({
        status: { 
          $nin: [TokenStatus.POSITION_CLOSED] 
        }
      }).toArray();
      
      if (tokensToCheck.length === 0) {
        log('📭 No tokens to evaluate');
        return;
      }
      
      log(`📊 Evaluating ${tokensToCheck.length} tokens...`);
      
      for (const token of tokensToCheck) {
        await this.evaluateToken(token);
        
        // Add small delay to avoid rate limiting
        await this.sleep(1000);
      }
      
      log('✅ Evaluation cycle complete');
      
    } catch (error: any) {
      log(`❌ Error in evaluation cycle: ${error.message}`);
    }
  }

  private async evaluateToken(token: Token) {
    try {
      log(`\n🔎 Evaluating token: ${token.mintAddress}`);
      
      // Increment check count
      const checkCount = (token.checkCount || 0) + 1;
      
      // Update status to CHECKING if UNPROCESSED
      if (token.status === TokenStatus.UNPROCESSED) {
        await this.db.updateToken(token.mintAddress, { 
          status: TokenStatus.CHECKING,
          checkCount,
        });
      } else {
        await this.db.updateToken(token.mintAddress, { 
          checkCount,
        });
      }
      
      log(`   📊 Check #${checkCount}`);
      
      // Get token data from DexScreener
      const pairData = await this.getPairData(token.mintAddress);
      
      if (!pairData) {
        const timeSinceMint = Date.now() - token.mintTime.getTime();
        const fifteenMinutes = 1 * 60 * 1000;
        
        if (timeSinceMint > fifteenMinutes) {
          log(`   ❌ No DEX pair found for ${token.mintAddress.substring(0, 20)}...`);
          log(`   └─ Token hasn't been listed within 1 minutes - removing fake/spam token from database`);
          await this.db.getTokensCollection().deleteOne({ mintAddress: token.mintAddress });
          return;
        } else {
          const minutesSinceMint = Math.floor(timeSinceMint / 60000);
          log(`   ⏳ No DEX pair yet for ${token.mintAddress.substring(0, 20)}... (${minutesSinceMint}m old)`);
          return; // Will check again next cycle
        }
      }
      
      const currentPrice = parseFloat(pairData.priceUsd) || 0;
      const marketCap = pairData.marketCap || pairData.fdv || 0;
      const liquidity = pairData.liquidity?.usd || 0;
      
      // Check for recent activity - if no transaction in last 5 minutes, delete
      const lastTxTime = pairData.pairCreatedAt ? new Date(pairData.pairCreatedAt).getTime() : Date.now();
      const timeSinceLastActivity = Date.now() - lastTxTime;
      const fiveMinutes = 5 * 60 * 1000;
      
      if (timeSinceLastActivity > fiveMinutes && token.priceHistory.length > 0) {
        // Check if price hasn't changed - indicates no activity
        const lastPrice = token.priceHistory[token.priceHistory.length - 1]?.price || 0;
        if (currentPrice === lastPrice && token.priceHistory.length >= 3) {
          log(`   ❌ No activity detected in last 5 minutes - removing dead token`);
          await this.db.getTokensCollection().deleteOne({ mintAddress: token.mintAddress });
          return;
        }
      }
      
      log(`   💰 Current Price: $${currentPrice.toFixed(10)}`);
      log(`   📊 Market Cap: $${marketCap.toLocaleString()}`);
      log(`   💧 Liquidity: $${liquidity.toLocaleString()}`);
      
      // Update price history
      const pricePoint = {
        price: currentPrice,
        timestamp: new Date(),
        marketCap: marketCap,
      };
      
      const updatedPriceHistory = [...(token.priceHistory || []), pricePoint];
      
      // Initialize ATH with current price if this is first check, otherwise update if higher
      const previousATH = token.ath;
      const newATH = previousATH === null ? currentPrice : Math.max(previousATH, currentPrice);
      const athUpdated = previousATH === null || newATH > previousATH;
      
      // Always update ATH timestamp when ATH changes (including first time)
      const newAthTimestamp = athUpdated ? new Date() : token.athTimestamp;
      
      // Calculate drop from ATH
      const dropFromATH = newATH > 0 ? ((newATH - currentPrice) / newATH) * 100 : 0;
      
      log(`   📈 ATH: $${newATH.toFixed(10)} ${athUpdated ? '(NEW!)' : ''}`);
      if (dropFromATH > 0) {
        log(`   📉 Drop from ATH: ${dropFromATH.toFixed(2)}%`);
      }
      
      await this.db.updateToken(token.mintAddress, {
        currentPrice,
        priceHistory: updatedPriceHistory,
        ath: newATH,
        athTimestamp: newAthTimestamp,
        lastCheckedAt: new Date(),
      });
      
      // Check all criteria
      const criteria = await this.checkCriteria(token, pairData, marketCap, newATH, currentPrice);
      
      // If token was deleted due to repeated liquidity failures, exit early
      if (criteria.shouldDelete) {
        return;
      }
      
      await this.db.updateToken(token.mintAddress, {
        criteria: criteria.checks,
      });
      
      // Determine if token qualifies
      const allCriteriaMet = Object.values(criteria.checks).every(v => v === true);
      
      if (allCriteriaMet) {
        log(`   ✅ ALL CRITERIA MET!`);
        log(`   └─ Moving to QUALIFIED status`);
        
        await this.db.updateToken(token.mintAddress, {
          status: TokenStatus.QUALIFIED,
        });
      } else {
        // Check if any criteria definitely failed (not null)
        const someCriteriaFailed = Object.values(criteria.checks).some(v => v === false);
        
        if (someCriteriaFailed) {
          log(`   ❌ Token REJECTED: ${criteria.reason}`);
          
          await this.db.updateToken(token.mintAddress, {
            status: TokenStatus.REJECTED,
            rejectionReason: criteria.reason,
          });
        } else {
          log(`   ⏳ Still checking... (some criteria not yet determined)`);
        }
      }
      
    } catch (error: any) {
      log(`❌ Error evaluating token ${token.mintAddress}: ${error.message}`);
    }
  }

  private async checkCriteria(
    token: Token, 
    pairData: DexScreenerPair, 
    marketCap: number,
    ath: number,
    currentPrice: number
  ): Promise<{ checks: Token['criteria'], reason: string, shouldDelete?: boolean }> {
    
    const criteria = {
      marketCapAbove20KWithin60Min: null as boolean | null,
      droppedBy50PercentFromATH: null as boolean | null,
      maxLiquidityHolderUnder30Percent: null as boolean | null,
      bondingCurveProgress100Percent: null as boolean | null,
    };
    
    let reason = '';
    
    // 1. Check if market cap went above 20K within 60 minutes of launch
    const timeSinceMint = Date.now() - token.mintTime.getTime();
    const sixtyMinutes = 60 * 60 * 1000;
    
    if (timeSinceMint <= sixtyMinutes) {
      if (marketCap >= 20_000) {
        criteria.marketCapAbove20KWithin60Min = true;
        log(`   ✅ Market cap above $20K within 60 min: $${marketCap.toLocaleString()}`);
      } else {
        // Still within window, keep checking
        criteria.marketCapAbove20KWithin60Min = null;
        log(`   ⏳ Market cap: $${marketCap.toLocaleString()} (waiting for $20K within 60 min)`);
      }
    } else {
      // Window closed
      if (token.criteria.marketCapAbove20KWithin60Min === true || marketCap >= 20_000) {
        criteria.marketCapAbove20KWithin60Min = true;
        log(`   ✅ Market cap reached $20K within 60 min window`);
      } else {
        criteria.marketCapAbove20KWithin60Min = false;
        reason = 'Market cap did not reach $20K within 60 minutes of launch';
        log(`   ❌ ${reason}`);
      }
    }
    
    // 2. Check if price dropped by 50% from ATH
    if (ath > 0 && currentPrice > 0) {
      const dropPercent = ((ath - currentPrice) / ath) * 100;
      
      log(`   💹 ATH: $${ath.toFixed(10)}, Current: $${currentPrice.toFixed(10)}, Drop: ${dropPercent.toFixed(2)}%`);
      
      if (dropPercent >= 50) {
        criteria.droppedBy50PercentFromATH = true;
        log(`   ✅ Dropped ${dropPercent.toFixed(2)}% from ATH (need 50%)`);
      } else {
        // Still need to wait for 50% drop
        criteria.droppedBy50PercentFromATH = null;
        log(`   ⏳ Drop: ${dropPercent.toFixed(2)}% (waiting for 50%)`);
      }
    } else {
      criteria.droppedBy50PercentFromATH = null;
      log(`   ⏳ Waiting for price data to establish ATH`);
    }
    
    // 3. Check liquidity distribution (top holder < 30%)
    const liquidityDistribution = await this.checkLiquidityDistribution(token.mintAddress, pairData);
    criteria.maxLiquidityHolderUnder30Percent = liquidityDistribution.passes;
    
    if (liquidityDistribution.passes) {
      log(`   ✅ Top holder: ${liquidityDistribution.topHolderPercent.toFixed(2)}% < 30%`);
      // Reset fail count on success
      await this.db.updateToken(token.mintAddress, { liquidityFailCount: 0 });
    } else if (liquidityDistribution.passes === false) {
      reason = reason || `Top holder owns ${liquidityDistribution.topHolderPercent.toFixed(2)}% (exceeds 30% limit)`;
      log(`   ❌ ${reason || 'Top holder exceeds 30%'}`);
      
      // Increment liquidity fail count
      const liquidityFailCount = (token.liquidityFailCount || 0) + 1;
      await this.db.updateToken(token.mintAddress, { liquidityFailCount });
      
      // If failed liquidity check 2 times, delete the token
      if (liquidityFailCount >= 2) {
        log(`   🗑️  Failed liquidity check ${liquidityFailCount} times - removing token from database`);
        await this.db.getTokensCollection().deleteOne({ mintAddress: token.mintAddress });
        return { checks: criteria, reason, shouldDelete: true };
      }
    } else {
      log(`   ⏳ Unable to verify liquidity distribution`);
    }
    
    // 4. Check bonding curve progress (100%)
    const bondingCurve = await this.checkBondingCurve(token.mintAddress, pairData);
    criteria.bondingCurveProgress100Percent = bondingCurve.passes;
    
    if (bondingCurve.passes) {
      log(`   ✅ Bonding curve: 100% complete`);
    } else if (bondingCurve.passes === false) {
      reason = reason || `Bonding curve only ${bondingCurve.progress.toFixed(2)}% complete`;
      log(`   ❌ ${reason || 'Bonding curve not 100%'}`);
    } else {
      log(`   ⏳ Unable to verify bonding curve status`);
    }
    
    return { checks: criteria, reason };
  }

  private async checkLiquidityDistribution(
    mintAddress: string, 
    pairData: DexScreenerPair
  ): Promise<{ passes: boolean | null, topHolderPercent: number }> {
    try {
      // Get LP token address from pair data
      const lpMintAddress = pairData.pairAddress;
      
      if (!lpMintAddress) {
        return { passes: null, topHolderPercent: 0 };
      }
      
      // Get top token holders using Helius API
      const apiKey = process.env.HELIUS_API_KEY;
      if (!apiKey) {
        return { passes: null, topHolderPercent: 0 };
      }
      
      // Fetch token accounts for the LP mint
      const response = await axios.post(
        `https://api.helius.xyz/v0/token-metadata?api-key=${apiKey}`,
        {
          mintAccounts: [lpMintAddress],
          includeOffChain: false,
          disableCache: true,
        },
        {
          timeout: 5000,
        }
      );
      
      // Get largest holders from the base token (not LP)
      const holdersResponse = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        {
          jsonrpc: '2.0',
          id: 'liquidity-check',
          method: 'getTokenLargestAccounts',
          params: [mintAddress],
        },
        {
          timeout: 5000,
        }
      );
      
      if (holdersResponse.data?.result?.value) {
        const accounts = holdersResponse.data.result.value;
        
        // Calculate total supply
        const totalSupply = accounts.reduce((sum: number, acc: any) => 
          sum + parseFloat(acc.amount || 0), 0);
        
        if (totalSupply > 0 && accounts.length > 0) {
          // Find largest holder percentage
          const largestBalance = parseFloat(accounts[0].amount || 0);
          const largestHolderPct = (largestBalance / totalSupply) * 100;
          
          log(`   📊 Largest holder: ${largestHolderPct.toFixed(2)}% of supply`);
          
          if (largestHolderPct <= 30) {
            return { passes: true, topHolderPercent: largestHolderPct };
          } else {
            return { passes: false, topHolderPercent: largestHolderPct };
          }
        }
      }
      
      // Fallback: Use liquidity concentration as proxy
      const totalLiquidity = pairData.liquidity?.usd || 0;
      if (totalLiquidity > 0) {
        // If we can't get exact data, assume it passes if liquidity is reasonable
        log(`   💧 Using liquidity as proxy: $${totalLiquidity.toLocaleString()}`);
        return { passes: true, topHolderPercent: 0 };
      }
      
      return { passes: null, topHolderPercent: 0 };
      
    } catch (error: any) {
      log(`   ⚠️  Liquidity check error: ${error.message}`);
      return { passes: null, topHolderPercent: 0 };
    }
  }

  private async checkBondingCurve(
    mintAddress: string,
    pairData: DexScreenerPair
  ): Promise<{ passes: boolean | null, progress: number }> {
    try {
      // Check if this is a pump.fun token with bonding curve
      // Bonding curve is typically complete when token graduates to Raydium
      
      if (pairData.dexId.toLowerCase().includes('raydium')) {
        // If on Raydium, bonding curve is complete
        return { passes: true, progress: 100 };
      } else if (pairData.dexId.toLowerCase().includes('pump')) {
        // If still on pump.fun, need to check progress
        // This would require querying pump.fun's program
        return { passes: false, progress: 50 }; // Placeholder
      }
      
      // Default: assume it's on a regular DEX (no bonding curve concept)
      return { passes: true, progress: 100 };
      
    } catch (error) {
      return { passes: null, progress: 0 };
    }
  }

  private async getPairData(mintAddress: string): Promise<DexScreenerPair | null> {
    try {
      const response = await axios.get<DexScreenerResponse>(
        `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
        {
          timeout: 10000,
        }
      );
      
      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        // Return the pair with highest liquidity
        const pairs = response.data.pairs.filter(p => p.chainId === 'solana');
        if (pairs.length === 0) return null;
        
        pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        return pairs[0];
      }
      
      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null; // Token not found
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// MAIN
// ============================================================================

const service = new TokenEvaluationService();
service.start().catch((error) => {
  log(`❌ Fatal error: ${error.message}`);
  process.exit(1);
});

import { logger } from './logger';
import { config } from './config';
import { MarketData } from './types';
import { VolumeAnalyzer } from './volumeAnalyzer';
import { MarketDataService } from './marketDataService';

interface DefenseEvent {
  timestamp: number;
  type: 'sell' | 'volume_spike' | 'price_break' | 'defense_stop';
  wallet?: string;
  amountSol?: number;
  priceChange?: number;
  details: string;
}

interface DefenseAnalysis {
  token: string;
  defenseBroken: boolean;
  reason?: string;
  events: DefenseEvent[];
  recommendation: 'hold' | 'exit_now' | 'monitor_closely';
}

/**
 * DefenseMonitor tracks when the original absorption thesis breaks
 * 
 * We entered because infra wallets defended a level. If they stop defending
 * or start distributing, we should exit immediately - even if TP not hit.
 * 
 * Exit signals:
 * 1. Infra selling clusters (3+ sells in 5 minutes)
 * 2. Defended level breaks (price falls >5% through support)
 * 3. Volume spike + price stall (distribution pattern)
 * 4. Defense stops (no infra activity for 10+ minutes)
 */
export class DefenseMonitor {
  private volumeAnalyzer: VolumeAnalyzer;
  private marketDataService: MarketDataService;
  
  // Track defense events for each token
  private events: Map<string, DefenseEvent[]> = new Map();
  
  // Track defended price levels
  private defendedLevels: Map<string, number> = new Map();
  
  // Track last infra activity time
  private lastInfraActivity: Map<string, number> = new Map();

  constructor(volumeAnalyzer: VolumeAnalyzer) {
    this.volumeAnalyzer = volumeAnalyzer;
    this.marketDataService = new MarketDataService();
  }

  /**
   * Start monitoring defense for a token at a specific price level
   */
  startMonitoring(token: string, defendedPrice: number): void {
    this.events.set(token, []);
    this.defendedLevels.set(token, defendedPrice);
    this.lastInfraActivity.set(token, Date.now() / 1000);
    
    logger.info(
      `[DefenseMonitor] 🛡️  Started monitoring ${token.slice(0, 8)}... ` +
      `defended level: $${defendedPrice.toFixed(6)}`
    );
  }

  /**
   * Record infra wallet activity (keeps defense alive)
   */
  recordInfraActivity(token: string, type: 'buy' | 'sell', wallet: string, amountSol: number): void {
    const now = Date.now() / 1000;
    this.lastInfraActivity.set(token, now);
    
    const events = this.events.get(token) || [];
    
    if (type === 'sell') {
      events.push({
        timestamp: now,
        type: 'sell',
        wallet,
        amountSol,
        details: `Infra sell: ${wallet.slice(0, 8)}... ${amountSol.toFixed(2)} SOL`,
      });
      
      logger.warn(
        `[DefenseMonitor] ⚠️  ${token.slice(0, 8)}... infra SELL detected: ` +
        `${wallet.slice(0, 8)}... ${amountSol.toFixed(2)} SOL`
      );
    }
    
    // Keep only recent events (last 30 minutes)
    const filtered = events.filter(e => now - e.timestamp < 1800);
    this.events.set(token, filtered);
  }

  /**
   * Check if defense has broken (thesis invalidated)
   */
  async checkDefense(token: string): Promise<DefenseAnalysis> {
    const events = this.events.get(token) || [];
    const defendedLevel = this.defendedLevels.get(token);
    const lastActivity = this.lastInfraActivity.get(token);
    
    if (!defendedLevel || !lastActivity) {
      return {
        token,
        defenseBroken: false,
        events: [],
        recommendation: 'hold',
      };
    }

    const now = Date.now() / 1000;
    const breakReasons: string[] = [];

    // Check 1: Infra selling clusters (3+ sells in 5 minutes)
    const recentSells = events.filter(e => 
      e.type === 'sell' && (now - e.timestamp) < 300
    );
    
    if (recentSells.length >= 3) {
      const totalSold = recentSells.reduce((sum, e) => sum + (e.amountSol || 0), 0);
      breakReasons.push(`Infra selling cluster: ${recentSells.length} sells (${totalSold.toFixed(2)} SOL) in 5 min`);
      
      events.push({
        timestamp: now,
        type: 'sell',
        details: `Selling cluster detected: ${recentSells.length} sells`,
      });
    }

    // Check 2: Defended level broken (price falls >5% through support)
    try {
      const marketData = await this.marketDataService.fetchMarketData(token);
      
      if (marketData) {
        const priceChange = ((marketData.priceUsd - defendedLevel) / defendedLevel) * 100;
        
        if (priceChange <= -5) {
          breakReasons.push(`Defended level broken: ${priceChange.toFixed(1)}% below support`);
          
          events.push({
            timestamp: now,
            type: 'price_break',
            priceChange,
            details: `Price broke through defended level: ${priceChange.toFixed(1)}%`,
          });
        }
        
        // Check 3: Volume spike + price stall (distribution pattern)
        const volumeData = this.volumeAnalyzer.analyzeRecentVolume(token, 300);
        const totalVolume = volumeData.buyVolume + volumeData.sellVolume;
        
        // If volume is high but price isn't moving up = distribution
        if (totalVolume > 2.0 && Math.abs(priceChange) < 2) {
          breakReasons.push(`Distribution pattern: high volume (${totalVolume.toFixed(1)} SOL) + price stall`);
          
          events.push({
            timestamp: now,
            type: 'volume_spike',
            details: `Distribution detected: ${totalVolume.toFixed(1)} SOL volume, price flat`,
          });
        }
      }
    } catch (err) {
      logger.error(`[DefenseMonitor] Error checking price for ${token}:`, err);
    }

    // Check 4: Defense stops (no infra activity for 10+ minutes)
    const inactiveTime = now - lastActivity;
    if (inactiveTime > 600) {
      breakReasons.push(`Defense abandoned: ${(inactiveTime / 60).toFixed(0)} min without infra activity`);
      
      events.push({
        timestamp: now,
        type: 'defense_stop',
        details: `No infra activity for ${(inactiveTime / 60).toFixed(0)} minutes`,
      });
    }

    // Determine recommendation
    let recommendation: 'hold' | 'exit_now' | 'monitor_closely' = 'hold';
    
    if (breakReasons.length >= 2) {
      recommendation = 'exit_now'; // Multiple signals = immediate exit
    } else if (breakReasons.length === 1) {
      recommendation = 'monitor_closely'; // One signal = watch carefully
    }

    const defenseBroken = breakReasons.length > 0;

    if (defenseBroken) {
      logger.warn(
        `[DefenseMonitor] 🚨 ${token.slice(0, 8)}... DEFENSE BROKEN | ` +
        `Recommendation: ${recommendation.toUpperCase()}`
      );
      breakReasons.forEach(r => logger.warn(`  • ${r}`));
    }

    return {
      token,
      defenseBroken,
      reason: breakReasons.length > 0 ? breakReasons.join('; ') : undefined,
      events,
      recommendation,
    };
  }

  /**
   * Stop monitoring a token
   */
  stopMonitoring(token: string): void {
    this.events.delete(token);
    this.defendedLevels.delete(token);
    this.lastInfraActivity.delete(token);
    
    logger.info(`[DefenseMonitor] Stopped monitoring ${token.slice(0, 8)}...`);
  }

  /**
   * Get defense status summary
   */
  getStatus(token: string): {
    monitoring: boolean;
    defendedLevel?: number;
    lastActivity?: number;
    eventCount: number;
  } {
    const events = this.events.get(token) || [];
    const defendedLevel = this.defendedLevels.get(token);
    const lastActivity = this.lastInfraActivity.get(token);
    
    return {
      monitoring: defendedLevel !== undefined,
      defendedLevel,
      lastActivity,
      eventCount: events.length,
    };
  }
}

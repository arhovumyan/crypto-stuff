import { config } from './config';
import logger from './logger';
import {
  WalletBehavior,
  AbsorptionCandidate,
  StabilizationResult,
  AbsorptionEvidence,
  InfraWallet,
} from './types';

/**
 * WalletScorer - Longitudinal wallet tracking and scoring
 * The core intelligence of the discovery system
 */
export class WalletScorer {
  private wallets: Map<string, WalletBehavior>;
  private lastDecayUpdate: number;
  
  constructor() {
    this.wallets = new Map();
    this.lastDecayUpdate = Date.now();
    
    // Apply confidence decay every hour
    setInterval(() => this.applyConfidenceDecay(), 3600 * 1000);
  }
  
  /**
   * Process absorption candidate and update wallet behavior
   */
  processAbsorption(
    candidate: AbsorptionCandidate,
    stabilization: StabilizationResult
  ): void {
    const wallet = this.getOrCreateWallet(candidate.wallet);
    const now = Date.now();
    
    // Create evidence
    const evidence: AbsorptionEvidence = {
      eventId: candidate.eventId,
      tokenMint: candidate.tokenMint,
      timestamp: now,
      slot: candidate.firstBuySlot,
      absorptionPercent: candidate.absorptionPercent,
      stabilized: stabilization.stabilized,
      priceImpact: candidate.avgPriceImpact,
      responseLatency: candidate.responseLatencySlots,
      outcome: stabilization.stabilized ? 'success' : 'failed',
    };
    
    // Update wallet metrics
    wallet.lastSeen = now;
    wallet.totalAbsorptions++;
    
    if (stabilization.stabilized) {
      wallet.successfulAbsorptions++;
    } else {
      wallet.failedAbsorptions++;
    }
    
    wallet.uniqueTokens.add(candidate.tokenMint);
    wallet.evidenceLog.push(evidence);
    
    // Keep only last 50 evidence entries
    if (wallet.evidenceLog.length > 50) {
      wallet.evidenceLog.shift();
    }
    
    // Recalculate metrics
    this.recalculateMetrics(wallet);
    
    // Update confidence score
    this.updateConfidenceScore(wallet);
    
    // Classify wallet
    this.classifyWallet(wallet);
    
    this.wallets.set(candidate.wallet, wallet);
    
    // Log significant updates
    if (wallet.confidenceScore >= config.scoring.minConfidenceThreshold) {
      logger.info(
        `[WalletScorer] Wallet ${candidate.wallet.slice(0, 8)}... updated: ` +
        `${wallet.totalAbsorptions} absorptions, ` +
        `${wallet.stabilizationSuccessRate.toFixed(0)}% success rate, ` +
        `confidence: ${wallet.confidenceScore.toFixed(0)}, ` +
        `classification: ${wallet.classification}`
      );
    }
  }
  
  /**
   * Get or create wallet behavior tracker
   */
  private getOrCreateWallet(walletAddress: string): WalletBehavior {
    const existing = this.wallets.get(walletAddress);
    if (existing) {
      return existing;
    }
    
    const now = Date.now();
    const newWallet: WalletBehavior = {
      wallet: walletAddress,
      firstSeen: now,
      lastSeen: now,
      totalAbsorptions: 0,
      successfulAbsorptions: 0,
      failedAbsorptions: 0,
      uniqueTokens: new Set(),
      stabilizationSuccessRate: 0,
      avgAbsorptionPercent: 0,
      avgResponseLatency: 0,
      sizeConsistency: 0,
      exitBehavior: 'unknown',
      activityPattern: 'opportunistic',
      confidenceScore: 0,
      classification: 'candidate',
      status: 'active',
      evidenceLog: [],
      lastConfidenceUpdate: now,
    };
    
    return newWallet;
  }
  
  /**
   * Recalculate wallet metrics from evidence
   */
  private recalculateMetrics(wallet: WalletBehavior): void {
    if (wallet.evidenceLog.length === 0) {
      return;
    }
    
    // Stabilization success rate
    const successfulEvents = wallet.evidenceLog.filter(e => e.outcome === 'success').length;
    wallet.stabilizationSuccessRate = (successfulEvents / wallet.evidenceLog.length) * 100;
    
    // Average absorption percent
    wallet.avgAbsorptionPercent = 
      wallet.evidenceLog.reduce((sum, e) => sum + e.absorptionPercent, 0) / 
      wallet.evidenceLog.length;
    
    // Average response latency
    wallet.avgResponseLatency = 
      wallet.evidenceLog.reduce((sum, e) => sum + e.responseLatency, 0) / 
      wallet.evidenceLog.length;
    
    // Size consistency (lower std dev = more consistent)
    const absorptions = wallet.evidenceLog.map(e => e.absorptionPercent);
    const mean = wallet.avgAbsorptionPercent;
    const variance = absorptions.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / absorptions.length;
    const stdDev = Math.sqrt(variance);
    wallet.sizeConsistency = Math.max(0, 100 - stdDev * 2); // Higher score = more consistent
    
    // Activity pattern
    wallet.activityPattern = this.determineActivityPattern(wallet);
  }
  
  /**
   * Determine activity pattern
   */
  private determineActivityPattern(wallet: WalletBehavior): 'consistent' | 'cyclical' | 'opportunistic' {
    if (wallet.totalAbsorptions < 5) {
      return 'opportunistic';
    }
    
    // Check time distribution of events
    const timestamps = wallet.evidenceLog.map(e => e.timestamp);
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    
    if (intervals.length === 0) {
      return 'opportunistic';
    }
    
    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
    const maxInterval = Math.max(...intervals);
    
    // If most intervals are similar, it's consistent
    if (maxInterval < avgInterval * 2) {
      return 'consistent';
    }
    
    // If there are long gaps, it's cyclical
    if (maxInterval > avgInterval * 5) {
      return 'cyclical';
    }
    
    return 'opportunistic';
  }
  
  /**
   * Update confidence score
   */
  private updateConfidenceScore(wallet: WalletBehavior): void {
    let score = 0;
    
    // Factor 1: Number of events (max 30 points)
    const eventPoints = Math.min(30, (wallet.totalAbsorptions / 10) * 30);
    score += eventPoints;
    
    // Factor 2: Stabilization success rate (max 25 points)
    score += (wallet.stabilizationSuccessRate / 100) * 25;
    
    // Factor 3: Unique tokens (max 15 points)
    const tokenPoints = Math.min(15, wallet.uniqueTokens.size * 5);
    score += tokenPoints;
    
    // Factor 4: Size consistency (max 10 points)
    score += (wallet.sizeConsistency / 100) * 10;
    
    // Factor 5: Activity pattern (max 10 points)
    if (wallet.activityPattern === 'consistent') {
      score += 10;
    } else if (wallet.activityPattern === 'cyclical') {
      score += 6;
    } else {
      score += 2;
    }
    
    // Factor 6: Response timeliness (max 10 points)
    const timelinessScore = Math.max(0, 10 - (wallet.avgResponseLatency / 10));
    score += timelinessScore;
    
    // Penalty for failures
    const failureRate = wallet.failedAbsorptions / Math.max(1, wallet.totalAbsorptions);
    score -= failureRate * 20;
    
    wallet.confidenceScore = Math.max(0, Math.min(100, score));
    wallet.lastConfidenceUpdate = Date.now();
  }
  
  /**
   * Classify wallet based on behavior
   */
  private classifyWallet(wallet: WalletBehavior): void {
    // Must meet minimum requirements
    if (wallet.totalAbsorptions < config.scoring.minAbsorptionEvents) {
      wallet.classification = 'candidate';
      return;
    }
    
    if (wallet.uniqueTokens.size < config.scoring.minUniqueTokens) {
      wallet.classification = 'candidate';
      return;
    }
    
    if (wallet.stabilizationSuccessRate < config.scoring.minStabilizationRate * 100) {
      wallet.classification = 'noise';
      return;
    }
    
    if (wallet.confidenceScore < config.scoring.minConfidenceThreshold) {
      wallet.classification = 'candidate';
      return;
    }
    
    // Classify based on characteristics
    if (wallet.stabilizationSuccessRate >= 80 && wallet.sizeConsistency >= 70) {
      wallet.classification = 'defensive-infra';
    } else if (wallet.stabilizationSuccessRate >= 70 && wallet.avgAbsorptionPercent >= 40) {
      wallet.classification = 'aggressive-infra';
    } else if (wallet.activityPattern === 'cyclical') {
      wallet.classification = 'cyclical';
    } else if (wallet.confidenceScore >= 60) {
      wallet.classification = 'opportunistic';
    } else {
      wallet.classification = 'noise';
    }
  }
  
  /**
   * Apply confidence decay
   */
  private applyConfidenceDecay(): void {
    const now = Date.now();
    const daysSinceLastDecay = (now - this.lastDecayUpdate) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastDecay < 1) {
      return; // Only decay once per day
    }
    
    let decayed = 0;
    let pruned = 0;
    
    for (const [address, wallet] of this.wallets.entries()) {
      const daysSinceLastSeen = (now - wallet.lastSeen) / (1000 * 60 * 60 * 24);
      
      // Apply decay based on inactivity
      if (daysSinceLastSeen > config.scoring.confidenceDecayDays) {
        const decayAmount = 
          (daysSinceLastSeen / config.scoring.confidenceDecayDays) * 10;
        wallet.confidenceScore = Math.max(0, wallet.confidenceScore - decayAmount);
        wallet.status = 'decaying';
        decayed++;
      }
      
      // Prune wallets below threshold
      if (wallet.confidenceScore < config.scoring.minConfidenceThreshold) {
        if (wallet.classification !== 'defensive-infra' && wallet.classification !== 'aggressive-infra') {
          this.wallets.delete(address);
          pruned++;
        } else {
          wallet.status = 'deprecated';
        }
      }
      
      this.wallets.set(address, wallet);
    }
    
    this.lastDecayUpdate = now;
    
    if (decayed > 0 || pruned > 0) {
      logger.info(
        `[WalletScorer] Confidence decay: ${decayed} wallets decayed, ${pruned} pruned`
      );
    }
  }
  
  /**
   * Get confirmed infra wallets
   */
  getInfraWallets(): InfraWallet[] {
    const infraWallets: InfraWallet[] = [];
    
    for (const wallet of this.wallets.values()) {
      if (
        (wallet.classification === 'defensive-infra' || 
         wallet.classification === 'aggressive-infra' ||
         wallet.classification === 'cyclical') &&
        wallet.confidenceScore >= config.scoring.minConfidenceThreshold
      ) {
        infraWallets.push({
          wallet: wallet.wallet,
          classification: wallet.classification,
          confidenceScore: wallet.confidenceScore,
          status: wallet.status,
          totalAbsorptions: wallet.totalAbsorptions,
          successfulAbsorptions: wallet.successfulAbsorptions,
          stabilizationRate: wallet.stabilizationSuccessRate,
          uniqueTokens: wallet.uniqueTokens.size,
          avgAbsorptionPercent: wallet.avgAbsorptionPercent,
          avgResponseLatency: wallet.avgResponseLatency,
          firstSeen: wallet.firstSeen,
          lastSeen: wallet.lastSeen,
          lastUpdate: wallet.lastConfidenceUpdate,
          recentEvents: wallet.evidenceLog.slice(-10).map(e => e.eventId),
          evidenceCount: wallet.evidenceLog.length,
        });
      }
    }
    
    // Sort by confidence score
    infraWallets.sort((a, b) => b.confidenceScore - a.confidenceScore);
    
    return infraWallets;
  }
  
  /**
   * Get all tracked wallets
   */
  getAllWallets(): WalletBehavior[] {
    return Array.from(this.wallets.values());
  }
  
  /**
   * Get wallet details
   */
  getWallet(address: string): WalletBehavior | null {
    return this.wallets.get(address) || null;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const all = Array.from(this.wallets.values());
    
    return {
      totalTracked: all.length,
      defensiveInfra: all.filter(w => w.classification === 'defensive-infra').length,
      aggressiveInfra: all.filter(w => w.classification === 'aggressive-infra').length,
      cyclical: all.filter(w => w.classification === 'cyclical').length,
      opportunistic: all.filter(w => w.classification === 'opportunistic').length,
      noise: all.filter(w => w.classification === 'noise').length,
      candidates: all.filter(w => w.classification === 'candidate').length,
      active: all.filter(w => w.status === 'active').length,
      decaying: all.filter(w => w.status === 'decaying').length,
      deprecated: all.filter(w => w.status === 'deprecated').length,
    };
  }
}

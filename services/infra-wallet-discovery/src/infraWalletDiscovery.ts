import { config } from './config';
import logger from './logger';
import { SwapMonitor } from './swapMonitor';
import { LargeSellDetector } from './largeSellDetector';
import { AbsorptionAnalyzer } from './absorptionAnalyzer';
import { StabilizationValidator } from './stabilizationValidator';
import { WalletScorer } from './walletScorer';
import { OutputManager } from './outputManager';
import { SystemStats } from './types';

/**
 * InfraWalletDiscovery - Main orchestrator
 * Coordinates all components to discover infrastructure wallets
 */
export class InfraWalletDiscovery {
  private swapMonitor: SwapMonitor;
  private sellDetector: LargeSellDetector;
  private absorptionAnalyzer: AbsorptionAnalyzer;
  private stabilizationValidator: StabilizationValidator;
  private walletScorer: WalletScorer;
  private outputManager: OutputManager;
  
  private isRunning: boolean;
  private stats: SystemStats;
  
  constructor() {
    logger.info('[InfraDiscovery] Initializing Infrastructure Wallet Discovery System...');
    
    this.swapMonitor = new SwapMonitor();
    this.sellDetector = new LargeSellDetector(this.swapMonitor);
    this.absorptionAnalyzer = new AbsorptionAnalyzer();
    this.stabilizationValidator = new StabilizationValidator();
    this.walletScorer = new WalletScorer();
    this.outputManager = new OutputManager();
    
    this.isRunning = false;
    this.stats = {
      monitoringStartTime: 0,
      totalSwapsProcessed: 0,
      totalLargeSellEvents: 0,
      totalCandidatesIdentified: 0,
      totalWalletsTracked: 0,
      confirmedInfraWallets: 0,
      defensiveInfraCount: 0,
      aggressiveInfraCount: 0,
      cyclicalCount: 0,
      opportunisticCount: 0,
      noiseCount: 0,
      avgProcessingTimeMs: 0,
      lastSaveTime: 0,
    };
  }
  
  /**
   * Start the discovery system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[InfraDiscovery] Already running');
      return;
    }
    
    this.isRunning = true;
    this.stats.monitoringStartTime = Date.now();
    
    logger.info('');
    logger.info('================================================================================');
    logger.info('[InfraDiscovery] 🔍 INFRASTRUCTURE WALLET DISCOVERY SYSTEM');
    logger.info('================================================================================');
    logger.info('');
    logger.info('📊 BEHAVIORAL ANALYSIS ENGINE');
    logger.info('');
    logger.info('This system identifies infrastructure / liquidity-absorbing wallets by:');
    logger.info('  1. Monitoring swaps across Raydium, PumpFun, PumpSwap');
    logger.info('  2. Detecting large sell events (1-3% of pool liquidity)');
    logger.info('  3. Analyzing wallets that absorb sell pressure');
    logger.info('  4. Validating price stabilization after absorption');
    logger.info('  5. Scoring wallets longitudinally (requires 3+ events)');
    logger.info('  6. Classifying wallets based on repeatable behavior');
    logger.info('');
    logger.info('⚠️  This is a DISCOVERY system, not a trading system.');
    logger.info('⚠️  High PnL alone is NOT a valid signal.');
    logger.info('⚠️  Wallets must demonstrate structural market impact.');
    logger.info('');
    logger.info('================================================================================');
    logger.info('');
    
    // Start swap monitoring
    await this.swapMonitor.start((swap) => this.handleSwap(swap));
    
    // Start periodic analysis of completed observations
    setInterval(() => this.analyzeCompletedEvents(), 30 * 1000); // Every 30 seconds
    
    // Start periodic output saving
    setInterval(() => this.saveOutput(), 60 * 1000); // Every minute
    
    // Log stats every 5 minutes
    setInterval(() => this.logStats(), 5 * 60 * 1000);
    
    logger.info('[InfraDiscovery] System started successfully');
  }
  
  /**
   * Stop the system
   */
  async stop(): Promise<void> {
    logger.info('[InfraDiscovery] Stopping system...');
    this.isRunning = false;
    
    await this.swapMonitor.stop();
    
    // Final save
    await this.saveOutput();
    
    logger.info('[InfraDiscovery] System stopped');
  }
  
  /**
   * Handle incoming swap
   */
  private handleSwap(swap: any): void {
    const startTime = Date.now();
    
    try {
      this.stats.totalSwapsProcessed++;
      
      // Track price for stabilization analysis
      this.stabilizationValidator.trackPrice(swap);
      
      // Check for large sell events
      this.sellDetector.processSwap(swap, (event) => {
        this.stats.totalLargeSellEvents++;
        logger.info(
          `[InfraDiscovery] 🔴 Large sell detected: Token ${event.tokenMint.slice(0, 8)}... ` +
          `${event.percentOfPool.toFixed(2)}% of pool`
        );
      });
      
      // Check if this swap is during an active sell event observation window
      const activeEvent = this.sellDetector.getActiveSellEvent(swap.tokenMint);
      if (activeEvent) {
        this.absorptionAnalyzer.processSwapDuringEvent(swap, activeEvent);
      }
      
      // Update processing time
      const processingTime = Date.now() - startTime;
      this.stats.avgProcessingTimeMs = 
        (this.stats.avgProcessingTimeMs * 0.95) + (processingTime * 0.05);
      
    } catch (error) {
      logger.error('[InfraDiscovery] Error handling swap:', error);
    }
  }
  
  /**
   * Analyze completed observation windows
   */
  private async analyzeCompletedEvents(): Promise<void> {
    try {
      const eventsToAnalyze = this.sellDetector.getEventsForAnalysis();
      
      for (const event of eventsToAnalyze) {
        // Analyze absorption candidates
        const candidates = this.absorptionAnalyzer.analyzeEvent(event);
        
        if (candidates.length === 0) {
          this.sellDetector.updateEventStatus(event.id, 'invalidated');
          continue;
        }
        
        this.stats.totalCandidatesIdentified += candidates.length;
        
        // Get swaps for stabilization analysis
        const eventSwaps = this.absorptionAnalyzer.getEventSwaps(event.id);
        
        // Validate stabilization
        const stabilization = await this.stabilizationValidator.validateStabilization(
          event,
          eventSwaps
        );
        
        // Update event status
        if (stabilization.stabilized) {
          this.sellDetector.updateEventStatus(event.id, 'validated');
        } else {
          this.sellDetector.updateEventStatus(event.id, 'invalidated');
        }
        
        // Process each candidate
        for (const candidate of candidates) {
          this.walletScorer.processAbsorption(candidate, stabilization);
        }
      }
      
      // Update stats
      const scorerStats = this.walletScorer.getStats();
      this.stats.totalWalletsTracked = scorerStats.totalTracked;
      this.stats.defensiveInfraCount = scorerStats.defensiveInfra;
      this.stats.aggressiveInfraCount = scorerStats.aggressiveInfra;
      this.stats.cyclicalCount = scorerStats.cyclical;
      this.stats.opportunisticCount = scorerStats.opportunistic;
      this.stats.noiseCount = scorerStats.noise;
      this.stats.confirmedInfraWallets = 
        scorerStats.defensiveInfra + scorerStats.aggressiveInfra + scorerStats.cyclical;
      
    } catch (error) {
      logger.error('[InfraDiscovery] Error analyzing completed events:', error);
    }
  }
  
  /**
   * Save output files
   */
  private async saveOutput(): Promise<void> {
    if (!this.outputManager.shouldSave()) {
      return;
    }
    
    try {
      const infraWallets = this.walletScorer.getInfraWallets();
      
      // Save JSON and CSV
      this.outputManager.saveJSON(infraWallets, this.stats);
      this.outputManager.saveCSV(infraWallets);
      
      // Generate reports for top wallets
      const topWallets = infraWallets.slice(0, 10);
      for (const infraWallet of topWallets) {
        const fullWallet = this.walletScorer.getWallet(infraWallet.wallet);
        if (fullWallet) {
          this.outputManager.generateWalletReport(fullWallet);
        }
      }
      
      this.outputManager.markSaved();
      this.stats.lastSaveTime = Date.now();
      
      logger.info(
        `[InfraDiscovery] 💾 Saved ${infraWallets.length} confirmed infra wallets`
      );
      
    } catch (error) {
      logger.error('[InfraDiscovery] Error saving output:', error);
    }
  }
  
  /**
   * Log system statistics
   */
  private logStats(): void {
    const sellStats = this.sellDetector.getStats();
    const absorptionStats = this.absorptionAnalyzer.getStats();
    const scorerStats = this.walletScorer.getStats();
    
    const uptime = (Date.now() - this.stats.monitoringStartTime) / 1000 / 60 / 60; // hours
    
    logger.info('');
    logger.info('================================================================================');
    logger.info('[InfraDiscovery] 📊 SYSTEM STATISTICS');
    logger.info('================================================================================');
    logger.info(`Uptime: ${uptime.toFixed(2)} hours`);
    logger.info('');
    logger.info('📈 Processing:');
    logger.info(`  Swaps Processed: ${this.stats.totalSwapsProcessed}`);
    logger.info(`  Large Sell Events: ${this.stats.totalLargeSellEvents}`);
    logger.info(`  Active Events: ${sellStats.activeEvents} (${sellStats.observingEvents} observing, ${sellStats.analyzingEvents} analyzing)`);
    logger.info(`  Avg Processing Time: ${this.stats.avgProcessingTimeMs.toFixed(2)}ms`);
    logger.info('');
    logger.info('🎯 Absorption Analysis:');
    logger.info(`  Events Analyzed: ${absorptionStats.eventsTracked}`);
    logger.info(`  Total Candidates: ${absorptionStats.totalCandidates}`);
    logger.info(`  Avg Candidates/Event: ${absorptionStats.avgCandidatesPerEvent.toFixed(1)}`);
    logger.info('');
    logger.info('🔍 Wallet Discovery:');
    logger.info(`  Total Wallets Tracked: ${scorerStats.totalTracked}`);
    logger.info(`  Defensive Infra: ${scorerStats.defensiveInfra}`);
    logger.info(`  Aggressive Infra: ${scorerStats.aggressiveInfra}`);
    logger.info(`  Cyclical: ${scorerStats.cyclical}`);
    logger.info(`  Opportunistic: ${scorerStats.opportunistic}`);
    logger.info(`  Candidates: ${scorerStats.candidates}`);
    logger.info(`  Noise: ${scorerStats.noise}`);
    logger.info('');
    logger.info(`✅ Confirmed Infrastructure Wallets: ${this.stats.confirmedInfraWallets}`);
    logger.info('================================================================================');
    logger.info('');
  }
  
  /**
   * Get current statistics
   */
  getStats(): SystemStats {
    return { ...this.stats };
  }
}

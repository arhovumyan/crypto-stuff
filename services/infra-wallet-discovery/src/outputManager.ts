import fs from 'fs';
import path from 'path';
import { config } from './config';
import logger from './logger';
import { InfraWallet, WalletBehavior, SystemStats } from './types';

/**
 * OutputManager - Handles file output and reporting
 */
export class OutputManager {
  private lastSave: number;
  
  constructor() {
    this.lastSave = 0;
    this.ensureDirectories();
  }
  
  /**
   * Ensure output directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      path.dirname(config.output.jsonPath),
      path.dirname(config.output.csvPath),
      config.output.reportsPath,
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * Save infra wallets to JSON
   */
  saveJSON(wallets: InfraWallet[], stats: SystemStats): void {
    try {
      const output = {
        generatedAt: new Date().toISOString(),
        systemStats: stats,
        infraWallets: wallets,
      };
      
      fs.writeFileSync(
        config.output.jsonPath,
        JSON.stringify(output, null, 2),
        'utf-8'
      );
      
      logger.info(`[OutputManager] Saved ${wallets.length} infra wallets to ${config.output.jsonPath}`);
    } catch (error) {
      logger.error('[OutputManager] Error saving JSON:', error);
    }
  }
  
  /**
   * Save infra wallets to CSV
   */
  saveCSV(wallets: InfraWallet[]): void {
    try {
      const headers = [
        'wallet',
        'classification',
        'confidence',
        'status',
        'total_absorptions',
        'successful_absorptions',
        'stabilization_rate',
        'unique_tokens',
        'avg_absorption_pct',
        'avg_response_latency',
        'first_seen',
        'last_seen',
      ].join(',');
      
      const rows = wallets.map(w => [
        w.wallet,
        w.classification,
        w.confidenceScore.toFixed(2),
        w.status,
        w.totalAbsorptions,
        w.successfulAbsorptions,
        w.stabilizationRate.toFixed(2),
        w.uniqueTokens,
        w.avgAbsorptionPercent.toFixed(2),
        w.avgResponseLatency.toFixed(0),
        new Date(w.firstSeen).toISOString(),
        new Date(w.lastSeen).toISOString(),
      ].join(','));
      
      const csv = [headers, ...rows].join('\n');
      
      fs.writeFileSync(config.output.csvPath, csv, 'utf-8');
      
      logger.info(`[OutputManager] Saved ${wallets.length} wallets to CSV`);
    } catch (error) {
      logger.error('[OutputManager] Error saving CSV:', error);
    }
  }
  
  /**
   * Generate wallet behavior report
   */
  generateWalletReport(wallet: WalletBehavior): void {
    try {
      const reportPath = path.join(
        config.output.reportsPath,
        `${wallet.wallet}_report.md`
      );
      
      const report = `# Wallet Behavior Report

**Wallet:** \`${wallet.wallet}\`
**Classification:** ${wallet.classification}
**Confidence Score:** ${wallet.confidenceScore.toFixed(2)}%
**Status:** ${wallet.status}

## Summary
- **Total Absorptions:** ${wallet.totalAbsorptions}
- **Successful Absorptions:** ${wallet.successfulAbsorptions}
- **Stabilization Success Rate:** ${wallet.stabilizationSuccessRate.toFixed(2)}%
- **Unique Tokens Defended:** ${wallet.uniqueTokens.size}
- **Average Absorption:** ${wallet.avgAbsorptionPercent.toFixed(2)}%
- **Average Response Latency:** ${wallet.avgResponseLatency.toFixed(0)} slots
- **Size Consistency:** ${wallet.sizeConsistency.toFixed(0)}%
- **Activity Pattern:** ${wallet.activityPattern}
- **Exit Behavior:** ${wallet.exitBehavior}

## Timeline
- **First Seen:** ${new Date(wallet.firstSeen).toISOString()}
- **Last Seen:** ${new Date(wallet.lastSeen).toISOString()}
- **Last Confidence Update:** ${new Date(wallet.lastConfidenceUpdate).toISOString()}

## Evidence Log (Recent Events)

${wallet.evidenceLog.slice(-10).reverse().map((e, i) => `
### Event ${i + 1}
- **Event ID:** \`${e.eventId}\`
- **Token:** \`${e.tokenMint}\`
- **Timestamp:** ${new Date(e.timestamp).toISOString()}
- **Absorption:** ${e.absorptionPercent.toFixed(2)}%
- **Stabilized:** ${e.stabilized ? '✅ Yes' : '❌ No'}
- **Response Latency:** ${e.responseLatency} slots
- **Outcome:** ${e.outcome}
`).join('\n')}

## Interpretation

${this.interpretBehavior(wallet)}

---
*Generated at ${new Date().toISOString()}*
`;
      
      fs.writeFileSync(reportPath, report, 'utf-8');
    } catch (error) {
      logger.error('[OutputManager] Error generating wallet report:', error);
    }
  }
  
  /**
   * Interpret wallet behavior
   */
  private interpretBehavior(wallet: WalletBehavior): string {
    const parts = [];
    
    if (wallet.classification === 'defensive-infra') {
      parts.push('This wallet exhibits **defensive infrastructure behavior** - it consistently absorbs sell pressure with high stabilization success rates and consistent position sizing.');
    } else if (wallet.classification === 'aggressive-infra') {
      parts.push('This wallet shows **aggressive infrastructure behavior** - it takes larger positions during dumps and actively defends price levels.');
    } else if (wallet.classification === 'cyclical') {
      parts.push('This wallet displays **cyclical behavior** - it appears during market stress events but not continuously.');
    } else if (wallet.classification === 'opportunistic') {
      parts.push('This wallet appears to be **opportunistic** - it buys dumps but doesn\'t show consistent infra characteristics.');
    } else if (wallet.classification === 'noise') {
      parts.push('This wallet is classified as **noise** - its absorptions don\'t correlate with stabilization.');
    } else {
      parts.push('This wallet is still a **candidate** - more data needed to confirm classification.');
    }
    
    if (wallet.stabilizationSuccessRate >= 80) {
      parts.push('\n\n✅ **High stabilization success rate** indicates this wallet\'s actions genuinely affect market structure.');
    }
    
    if (wallet.sizeConsistency >= 70) {
      parts.push('\n\n✅ **High size consistency** suggests systematic, non-random behavior.');
    }
    
    if (wallet.uniqueTokens.size >= 5) {
      parts.push(`\n\n✅ **Active across ${wallet.uniqueTokens.size} tokens** demonstrates broad infrastructure role.`);
    }
    
    if (wallet.avgResponseLatency < 50) {
      parts.push('\n\n✅ **Fast response times** indicate dedicated monitoring and quick execution.');
    }
    
    if (wallet.status === 'decaying') {
      parts.push('\n\n⚠️ **Confidence is decaying** due to recent inactivity.');
    }
    
    return parts.join('');
  }
  
  /**
   * Check if it's time to save
   */
  shouldSave(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastSave) / 1000 / 60; // minutes
    return elapsed >= config.output.saveIntervalMin;
  }
  
  /**
   * Mark save complete
   */
  markSaved(): void {
    this.lastSave = Date.now();
  }
}

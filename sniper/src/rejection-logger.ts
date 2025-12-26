/**
 * Rejection Logger - Writes human-readable logs of rejected tokens
 * Creates timestamped folders for each run
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RejectionLog {
  tokenMint: string;
  poolAddress?: string;
  gate?: string; // Optional - only for gate rejections
  reason: string;
  liquidity?: number;
  age?: number; // in seconds
  timestamp: number;
  detectionLayer?: string;
  rejectionType?: 'gate_rejection' | 'execution_failed' | 'other'; // Type of rejection
}

export class RejectionLogger {
  private logDir: string;
  private logFilePath: string;
  private sessionStartTime: Date;
  private rejectionCount = 0;

  constructor(baseDir: string = 'logs') {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Create timestamped session folder: logs/YYYY-MM-DD_HH-MM-SS/
    this.sessionStartTime = new Date();
    const timestamp = this.sessionStartTime
      .toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .substring(0, 19); // YYYY-MM-DD_HH-MM-SS

    this.logDir = path.join(baseDir, timestamp);
    fs.mkdirSync(this.logDir, { recursive: true });

    // Create rejection log file
    this.logFilePath = path.join(this.logDir, 'rejected-tokens.txt');

    // Write header
    this.writeHeader();
  }

  private writeHeader(): void {
    const header = [
      '╔═══════════════════════════════════════════════════════════════╗',
      '║          REJECTED TOKENS LOG                                  ║',
      '╚═══════════════════════════════════════════════════════════════╝',
      '',
      `Session Started: ${this.sessionStartTime.toLocaleString()}`,
      `Log Directory: ${this.logDir}`,
      '',
      '═'.repeat(63),
      ''
    ].join('\n');

    fs.appendFileSync(this.logFilePath, header);
  }

  /**
   * Log a rejected token
   */
  logRejection(rejection: RejectionLog): void {
    this.rejectionCount++;
    
    const lines: string[] = [];
    
    // Token identifier (shortened)
    const mintShort = rejection.tokenMint.slice(0, 8) + '...' + rejection.tokenMint.slice(-8);
    lines.push(`[${this.rejectionCount}] ${mintShort}`);
    
    // Rejection reason (gate or other)
    if (rejection.gate) {
      lines.push(`  ❌ Gate ${rejection.gate}: ${rejection.reason}`);
    } else {
      const typeLabel = rejection.rejectionType === 'execution_failed' ? '🚫 Execution Failed' : '❌ Rejected';
      lines.push(`  ${typeLabel}: ${rejection.reason}`);
    }
    
    // Additional context
    if (rejection.liquidity !== undefined) {
      lines.push(`  💧 Liquidity: ${rejection.liquidity.toFixed(2)} SOL`);
    }
    
    if (rejection.age !== undefined) {
      lines.push(`  ⏱️  Age: ${rejection.age.toFixed(1)}s`);
    }
    
    if (rejection.poolAddress) {
      const poolShort = rejection.poolAddress.slice(0, 8) + '...' + rejection.poolAddress.slice(-8);
      lines.push(`  🏊 Pool: ${poolShort}`);
    }
    
    if (rejection.detectionLayer) {
      lines.push(`  📡 Layer: ${rejection.detectionLayer}`);
    }
    
    const timeStr = new Date(rejection.timestamp).toLocaleTimeString();
    lines.push(`  🕐 ${timeStr}`);
    
    lines.push(''); // Empty line for readability
    
    fs.appendFileSync(this.logFilePath, lines.join('\n'));
  }

  /**
   * Write summary footer at the end of session
   */
  writeSummary(totalDetected: number, totalRejected: number, gateBreakdown: Map<string, number>): void {
    const summary = [
      '',
      '═'.repeat(63),
      '',
      'SESSION SUMMARY',
      '',
      `Total Detected: ${totalDetected}`,
      `Total Rejected: ${totalRejected}`,
      `Rejection Rate: ${totalDetected > 0 ? ((totalRejected / totalDetected) * 100).toFixed(1) : 0}%`,
      '',
      'Rejections by Gate:'
    ];

    // Sort gates by rejection count (descending)
    const sortedGates = Array.from(gateBreakdown.entries())
      .sort((a, b) => b[1] - a[1]);

    for (const [gate, count] of sortedGates) {
      const percentage = totalRejected > 0 ? ((count / totalRejected) * 100).toFixed(1) : '0.0';
      summary.push(`  Gate ${gate}: ${count} (${percentage}%)`);
    }

    summary.push('');
    summary.push(`Session Ended: ${new Date().toLocaleString()}`);
    summary.push(`Duration: ${((Date.now() - this.sessionStartTime.getTime()) / 1000 / 60).toFixed(1)} minutes`);
    summary.push('');

    fs.appendFileSync(this.logFilePath, summary.join('\n'));
  }

  /**
   * Get the log directory path
   */
  getLogDir(): string {
    return this.logDir;
  }
}


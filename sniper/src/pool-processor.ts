/**
 * Pool Processor - State Machine for Pool Validation
 * 
 * Fixes:
 * 1. Deduplication across 4 detection layers
 * 2. Single-flight processing (one validation per pool)
 * 3. Structured logging with full context
 * 4. SETTLING phase for liquidity to stabilize
 */

import { createLogger } from '@copytrader/shared';

const log = createLogger('pool-processor');

// Detection layers
export type DetectionLayer = 'ACCOUNT_CHANGE' | 'WEBSOCKET_LOGS' | 'HELIUS_PENDING' | 'DEXSCREENER';

// Processing phases
export type ProcessingPhase = 
  | 'DETECTED'      // Initial detection
  | 'SETTLING'      // Waiting for liquidity to stabilize
  | 'VALIDATING'    // Running through gates
  | 'EXECUTING'     // Executing trade
  | 'MONITORING'    // Position opened, monitoring
  | 'CLOSED'        // Position closed or rejected
  | 'FAILED';       // Processing failed

// Error classifications
export type ErrorCode = 
  | 'RPC_RATE_LIMIT'
  | 'RPC_TIMEOUT'
  | 'TX_DECODE_FAIL'
  | 'MISSING_ACCOUNTS'
  | 'LIQUIDITY_UNKNOWN'
  | 'GATE_REJECT'
  | 'JUPITER_FAIL'
  | 'JITO_SEND_FAIL'
  | 'SIM_FAIL'
  | 'EXECUTION_FAIL'
  | 'UNKNOWN';

// Pool candidate state
export interface PoolCandidate {
  // Identifiers
  poolAddress: string;
  tokenMint: string;
  signature: string;
  slot: number;
  
  // Detection info
  detectionLayer: DetectionLayer;
  detectionTime: number;
  
  // State
  phase: ProcessingPhase;
  phaseStartTime: number;
  
  // Liquidity tracking
  liquiditySOL: number;
  liquidityStatus: 'OK' | 'UNKNOWN' | 'FAIL';
  liquidityRetries: number;
  
  // Validation results
  gateResults: Map<string, { passed: boolean; reason?: string }>;
  
  // Final outcome
  outcome?: 'TRADED' | 'REJECTED' | 'FAILED';
  outcomeReason?: string;
  
  // Execution info
  entrySignature?: string;
  entryPrice?: number;
}

// Structured error for logging
export interface ProcessingError {
  code: ErrorCode;
  message: string;
  poolAddress: string;
  tokenMint?: string;
  signature?: string;
  slot?: number;
  detectionLayer?: DetectionLayer;
  phase: ProcessingPhase;
  stack?: string;
  timestamp: number;
}

export class PoolProcessor {
  // Deduplication caches (with TTL)
  private seenPools: Map<string, number> = new Map(); // poolAddress -> timestamp
  private seenSignatures: Map<string, number> = new Map(); // signature -> timestamp
  private inflightLocks: Map<string, boolean> = new Map(); // poolAddress -> isProcessing
  
  // Active candidates
  private candidates: Map<string, PoolCandidate> = new Map();
  
  // Configuration
  private poolTTL = 300000; // 5 minutes
  private signatureTTL = 60000; // 1 minute
  // Note: settlingTimeMs and maxSettlingRetries are handled by LiquidityService
  
  // Stats
  private stats = {
    detected: 0,
    duplicatesBlocked: 0,
    settled: 0,
    validated: 0,
    rejected: 0,
    traded: 0,
    failed: 0
  };

  constructor() {
    // Clean up old entries periodically
    setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Check if a pool should be processed (deduplication)
   * Returns false if already seen or in-flight
   */
  shouldProcess(
    poolAddress: string,
    signature: string,
    detectionLayer: DetectionLayer
  ): boolean {
    const now = Date.now();
    
    // Check if pool already seen
    const poolSeenAt = this.seenPools.get(poolAddress);
    if (poolSeenAt && now - poolSeenAt < this.poolTTL) {
      this.stats.duplicatesBlocked++;
      log.debug(`⏭️  Pool already seen, skipping`, {
        poolAddress: poolAddress.slice(0, 12) + '...',
        layer: detectionLayer,
        seenAgo: `${((now - poolSeenAt) / 1000).toFixed(1)}s`
      });
      return false;
    }

    // Check if signature already seen
    const sigSeenAt = this.seenSignatures.get(signature);
    if (sigSeenAt && now - sigSeenAt < this.signatureTTL) {
      this.stats.duplicatesBlocked++;
      return false;
    }

    // Check if already in-flight
    if (this.inflightLocks.get(poolAddress)) {
      this.stats.duplicatesBlocked++;
      log.debug(`🔒 Pool already in-flight, skipping`, {
        poolAddress: poolAddress.slice(0, 12) + '...',
        layer: detectionLayer
      });
      return false;
    }

    return true;
  }

  /**
   * Register a new pool candidate and acquire lock
   */
  registerCandidate(
    poolAddress: string,
    tokenMint: string,
    signature: string,
    slot: number,
    detectionLayer: DetectionLayer
  ): PoolCandidate | null {
    // Double-check and acquire lock atomically
    if (!this.shouldProcess(poolAddress, signature, detectionLayer)) {
      return null;
    }

    const now = Date.now();
    
    // Mark as seen
    this.seenPools.set(poolAddress, now);
    this.seenSignatures.set(signature, now);
    this.inflightLocks.set(poolAddress, true);
    
    // Create candidate
    const candidate: PoolCandidate = {
      poolAddress,
      tokenMint,
      signature,
      slot,
      detectionLayer,
      detectionTime: now,
      phase: 'DETECTED',
      phaseStartTime: now,
      liquiditySOL: 0,
      liquidityStatus: 'UNKNOWN',
      liquidityRetries: 0,
      gateResults: new Map()
    };

    this.candidates.set(poolAddress, candidate);
    this.stats.detected++;

    // Log detection with full context
    this.logPhaseTransition(candidate, 'DETECTED');

    return candidate;
  }

  /**
   * Transition candidate to SETTLING phase
   */
  startSettling(candidate: PoolCandidate): void {
    candidate.phase = 'SETTLING';
    candidate.phaseStartTime = Date.now();
    this.logPhaseTransition(candidate, 'SETTLING');
  }

  /**
   * Update liquidity reading during settling
   */
  updateLiquidity(
    candidate: PoolCandidate,
    liquiditySOL: number,
    status: 'OK' | 'UNKNOWN' | 'FAIL'
  ): void {
    candidate.liquiditySOL = liquiditySOL;
    candidate.liquidityStatus = status;
    candidate.liquidityRetries++;

    if (status === 'OK' && liquiditySOL > 0) {
      this.stats.settled++;
      log.info(`💧 Liquidity settled: ${liquiditySOL.toFixed(2)} SOL`, {
        poolAddress: candidate.poolAddress.slice(0, 12) + '...',
        tokenMint: candidate.tokenMint.slice(0, 12) + '...',
        retries: candidate.liquidityRetries
      });
    }
  }

  /**
   * Transition to VALIDATING phase
   */
  startValidation(candidate: PoolCandidate): void {
    candidate.phase = 'VALIDATING';
    candidate.phaseStartTime = Date.now();
    this.logPhaseTransition(candidate, 'VALIDATING');
  }

  /**
   * Record gate result
   */
  recordGateResult(
    candidate: PoolCandidate,
    gate: string,
    passed: boolean,
    reason?: string
  ): void {
    candidate.gateResults.set(gate, { passed, reason });
    
    if (!passed) {
      log.info(`❌ Gate ${gate} FAILED: ${reason}`, {
        poolAddress: candidate.poolAddress.slice(0, 12) + '...',
        tokenMint: candidate.tokenMint.slice(0, 12) + '...',
        gate
      });
    } else {
      log.info(`✅ Gate ${gate} PASSED`, {
        poolAddress: candidate.poolAddress.slice(0, 12) + '...',
        tokenMint: candidate.tokenMint.slice(0, 12) + '...'
      });
    }
  }

  /**
   * Mark candidate as rejected
   */
  reject(candidate: PoolCandidate, gate: string, reason: string): void {
    candidate.phase = 'CLOSED';
    candidate.outcome = 'REJECTED';
    candidate.outcomeReason = `Gate ${gate}: ${reason}`;
    this.stats.rejected++;
    
    // Release lock
    this.inflightLocks.delete(candidate.poolAddress);
    
    log.info(`🚫 REJECTED at Gate ${gate}`, {
      poolAddress: candidate.poolAddress.slice(0, 12) + '...',
      tokenMint: candidate.tokenMint.slice(0, 12) + '...',
      reason,
      processingTime: `${(Date.now() - candidate.detectionTime) / 1000}s`
    });
  }

  /**
   * Transition to EXECUTING phase
   */
  startExecution(candidate: PoolCandidate): void {
    candidate.phase = 'EXECUTING';
    candidate.phaseStartTime = Date.now();
    this.logPhaseTransition(candidate, 'EXECUTING');
  }

  /**
   * Mark candidate as traded
   */
  markTraded(candidate: PoolCandidate, entrySignature: string, entryPrice: number): void {
    candidate.phase = 'MONITORING';
    candidate.outcome = 'TRADED';
    candidate.entrySignature = entrySignature;
    candidate.entryPrice = entryPrice;
    this.stats.traded++;
    this.stats.validated++;
    
    log.info(`✅ TRADE EXECUTED`, {
      poolAddress: candidate.poolAddress.slice(0, 12) + '...',
      tokenMint: candidate.tokenMint.slice(0, 12) + '...',
      entrySignature,
      entryPrice,
      processingTime: `${(Date.now() - candidate.detectionTime) / 1000}s`
    });
  }

  /**
   * Mark candidate as failed with structured error
   */
  markFailed(candidate: PoolCandidate, error: ProcessingError): void {
    candidate.phase = 'FAILED';
    candidate.outcome = 'FAILED';
    candidate.outcomeReason = error.message;
    this.stats.failed++;
    
    // Release lock
    this.inflightLocks.delete(candidate.poolAddress);
    
    // Log structured error
    this.logError(error);
  }

  /**
   * Create a structured processing error
   */
  createError(
    code: ErrorCode,
    message: string,
    candidate: PoolCandidate,
    originalError?: Error
  ): ProcessingError {
    return {
      code,
      message,
      poolAddress: candidate.poolAddress,
      tokenMint: candidate.tokenMint,
      signature: candidate.signature,
      slot: candidate.slot,
      detectionLayer: candidate.detectionLayer,
      phase: candidate.phase,
      stack: originalError?.stack,
      timestamp: Date.now()
    };
  }

  /**
   * Release lock without changing state (for external handling)
   */
  releaseLock(poolAddress: string): void {
    this.inflightLocks.delete(poolAddress);
  }

  /**
   * Get a candidate by pool address
   */
  getCandidate(poolAddress: string): PoolCandidate | undefined {
    return this.candidates.get(poolAddress);
  }

  /**
   * Get processing stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Log phase transition with full context
   */
  private logPhaseTransition(candidate: PoolCandidate, newPhase: ProcessingPhase): void {
    const age = (Date.now() - candidate.detectionTime) / 1000;
    
    log.info(`📍 Phase: ${newPhase}`, {
      poolAddress: candidate.poolAddress.slice(0, 12) + '...',
      tokenMint: candidate.tokenMint?.slice(0, 12) + '...',
      signature: candidate.signature?.slice(0, 12) + '...',
      slot: candidate.slot,
      layer: candidate.detectionLayer,
      age: `${age.toFixed(1)}s`,
      liquiditySOL: candidate.liquiditySOL,
      liquidityStatus: candidate.liquidityStatus
    });
  }

  /**
   * Log structured error with full context
   */
  private logError(error: ProcessingError): void {
    log.error(`❌ Processing Error [${error.code}]`, {
      code: error.code,
      message: error.message,
      poolAddress: error.poolAddress?.slice(0, 12) + '...',
      tokenMint: error.tokenMint?.slice(0, 12) + '...',
      signature: error.signature?.slice(0, 12) + '...',
      slot: error.slot,
      layer: error.detectionLayer,
      phase: error.phase
    });
    
    if (error.stack) {
      log.debug(`Stack trace: ${error.stack}`);
    }
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    
    // Clean seen pools
    for (const [pool, timestamp] of this.seenPools) {
      if (now - timestamp > this.poolTTL) {
        this.seenPools.delete(pool);
      }
    }

    // Clean seen signatures
    for (const [sig, timestamp] of this.seenSignatures) {
      if (now - timestamp > this.signatureTTL) {
        this.seenSignatures.delete(sig);
      }
    }

    // Clean old candidates (keep last hour)
    for (const [pool, candidate] of this.candidates) {
      if (now - candidate.detectionTime > 3600000) {
        this.candidates.delete(pool);
        this.inflightLocks.delete(pool);
      }
    }
  }

  /**
   * Get summary for logging
   */
  getSummary(): string {
    return [
      `Detected: ${this.stats.detected}`,
      `Duplicates Blocked: ${this.stats.duplicatesBlocked}`,
      `Settled: ${this.stats.settled}`,
      `Validated: ${this.stats.validated}`,
      `Rejected: ${this.stats.rejected}`,
      `Traded: ${this.stats.traded}`,
      `Failed: ${this.stats.failed}`
    ].join(' | ');
  }
}

// Singleton instance
let instance: PoolProcessor | null = null;

export function getPoolProcessor(): PoolProcessor {
  if (!instance) {
    instance = new PoolProcessor();
  }
  return instance;
}


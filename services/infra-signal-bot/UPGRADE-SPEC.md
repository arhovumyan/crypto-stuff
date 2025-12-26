# Infra Signal Bot - Critical Upgrade Specification

## Executive Summary

The current bot has the right architecture but will produce false signals, bad entries, and losses due to:
1. Stale liquidity data from DexScreener
2. Single-event infra wallet classification (will mark random whales as infra)
3. Weak stabilization enforcement
4. No distribution detection (misses infra exits)
5. Underspecified execution (MEV risk, slippage)
6. Missing token safety checks

**This document specifies the required fixes.**

---

## What We Got Right (Keep These)

✅ Three-tier infra discovery (manual + automatic + database)  
✅ Absorption as core primitive  
✅ Behavior classification + confidence scores  
✅ Paper trading mode  
✅ Environment-driven configuration  
✅ Modular architecture  

---

## Critical Gaps & Fixes

### Gap A: Liquidity Computed from DexScreener (STALE)

**Problem:** DexScreener liquidity can lag 10-30 seconds, be wrong, or reflect different pools. This causes:
- Misclassified sell sizes
- False "large sell" triggers
- Wrong absorption ratios

**Fix Required:**

```typescript
interface PoolStateSnapshot {
  poolAddress: string;
  slot: number;
  blockTime: number;
  
  // On-chain reserves (NOT from API)
  reserveSOL: number;
  reserveToken: number;
  
  // Derived
  liquidityUSD?: number;  // Can use API for USD conversion
  priceSOL: number;       // Computed from reserves
}
```

**Implementation:**
1. Parse swap instruction to get pool address
2. Fetch pool account data at/near the slot
3. Read reserve balances from pool state
4. Compute sell % from actual reserves
5. DexScreener only for metadata (token name, USD price)

**Priority:** CRITICAL - Blocks accurate sell detection

---

### Gap B: Single-Event Infra Classification (WHALE MISIDENTIFICATION)

**Problem:** Current logic marks any wallet that absorbs 50% of one sell as "infra". A random whale buying a dip will be misclassified.

**Fix Required:**

```typescript
interface InfraDiscoveryRules {
  // Minimum events before promoting to "infra"
  minAbsorptionEvents: 3;
  minDistinctTokens: 2;
  minDistinctTimeWindows: 2; // Different hours/days
  
  // Metrics thresholds
  maxMedianResponseSlots: 20;  // Not seconds - slots
  minConsistencyScore: 0.7;    // Trade size variance
}

interface AbsorberCandidate {
  address: string;
  absorptionEvents: AbsorptionEvent[];
  distinctTokens: Set<string>;
  distinctHours: Set<number>;
  medianResponseSlots: number;
  consistencyScore: number;
  status: 'candidate' | 'confirmed_infra';
}
```

**Classification Logic:**
```
IF absorptionEvents.length >= 3 
   AND distinctTokens.size >= 2
   AND distinctHours.size >= 2
   AND medianResponseSlots <= 20
   AND consistencyScore >= 0.7
THEN promote to "infra"
ELSE keep as "candidate"
```

**Priority:** CRITICAL - Blocks false signal generation

---

### Gap C: Weak Stabilization Logic (ENTERS INTO DUMPS)

**Problem:** Current stabilization checker is too permissive. It should prevent entries during ongoing dumps.

**Fix Required:**

```typescript
interface StabilizationRules {
  // Price action requirements
  minHigherLows: 2;
  higherLowThresholdPct: 2;     // Must be 2%+ higher than previous low
  maxDrawdownFromDefense: 3;     // Can't break defended level by >3%
  
  // Volume requirements
  volumeContractionRatio: 0.6;   // Volume must drop to 60% of dump candle
  
  // Time requirements
  minStabilizationSlots: 60;     // ~30 seconds minimum
  maxStabilizationSlots: 600;    // ~5 minutes maximum
  
  // No new large sells during confirmation
  allowNewSellsAbovePct: 0.5;    // Only sells <0.5% of pool allowed
}

interface StabilizationConfirmed {
  isConfirmed: boolean;
  defendedLevel: number;
  lowestLow: number;
  higherLows: number[];
  volumeContracted: boolean;
  noNewLargeSells: boolean;
  stabilizationSlots: number;
  reasons: string[];
}
```

**Stabilization Tests (ALL must pass):**
1. **Higher Low Test**: Price tests the low at least twice, each time forming a higher low (>2% higher)
2. **Defended Level Hold**: Price doesn't break below defended level by >3%
3. **Volume Contraction**: Volume drops to <60% of the dump candle volume
4. **No New Dumps**: No sells >0.5% of pool during confirmation window
5. **Time Constraint**: Stabilization takes 30s-5min (not instant, not forever)

**Priority:** CRITICAL - Main entry filter

---

### Gap D: No Distribution Detection (EXITS TOO LATE)

**Problem:** Bot doesn't detect when infra starts selling or stops defending. This is where retail becomes exit liquidity.

**Fix Required:**

```typescript
interface DistributionDetector {
  // Monitor infra wallet behavior AFTER entry
  monitorWallets: string[];  // The wallets that absorbed
  
  // Distribution signals
  infraSellBurst: {
    threshold: number;        // If infra wallet sells >30% of position
    windowSlots: number;      // Within X slots
  };
  
  defenseStops: {
    newSellsNotAbsorbed: number;  // 2+ large sells with no infra response
    minSellSizeToTrack: number;   // Only track sells >0.5% pool
  };
  
  priceStallWithVolume: {
    priceChangeThreshold: 1;    // Price moves <1%
    volumeSpikeMultiple: 2;     // But volume 2x average
    windowSlots: 60;            // Over 30 seconds
  };
}

interface DistributionEvent {
  type: 'infra_selling' | 'defense_stopped' | 'price_stall_spike';
  infraWallet?: string;
  severity: 'warning' | 'critical';
  details: any;
  shouldExit: boolean;
}
```

**Exit Triggers:**
1. **Infra Selling**: Same wallet that absorbed now selling >30% in burst
2. **Defense Stops**: 2+ new large sells with no infra absorption
3. **Price Stall + Volume Spike**: Price can't make higher highs despite volume
4. **Break Defended Level**: Price closes >3% below defended level for >2 minutes

**Priority:** CRITICAL - Main profit protection

---

### Gap E: Execution Policy Underspecified (MEV, SLIPPAGE, FAILS)

**Problem:** Current execution just calls Jupiter without careful controls.

**Fix Required:**

```typescript
interface ExecutionPolicy {
  // Quote freshness
  maxQuoteAgeMs: 2000;          // Reject quotes >2 seconds old
  requoteOnStalePrice: true;
  
  // Slippage by liquidity tier
  slippageBps: {
    highLiquidity: 50,    // >$100k liquidity: 0.5%
    mediumLiquidity: 100, // $10k-$100k: 1%
    lowLiquidity: 200,    // <$10k: 2%
  };
  
  // Priority fee policy
  priorityFee: {
    mode: 'dynamic' | 'fixed';
    dynamicPercentile: 75;      // Use 75th percentile recent fees
    fixedMicroLamports: 10000;
    maxMicroLamports: 100000;   // Cap at 0.1 SOL equivalent
  };
  
  // Compute budget
  computeUnits: 200000;
  computeUnitPriceMicroLamports: 1000;
  
  // Retry policy
  maxRetries: 2;
  retryDelayMs: 500;
  exponentialBackoff: true;
  
  // Route constraints
  maxRoutingHops: 2;            // Direct or 1 intermediate
  allowedDexes: ['raydium', 'orca', 'whirlpool'];
  
  // Impact guard
  maxPriceImpactPct: 2;         // Don't enter if we'd move price >2%
}

interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  
  // Diagnostics
  quoteFreshness: number;       // ms since quote
  actualSlippage: number;       // vs expected
  priorityFeePaid: number;
  computeUsed: number;
  routeTaken: string[];
  priceImpact: number;
}
```

**Priority:** HIGH - Reduces losses and fails

---

### Gap F: No Token Safety Checks (HONEYPOTS, RUGS)

**Problem:** On pump.fun and new tokens, there are scam risks.

**Fix Required:**

```typescript
interface TokenSafetyGates {
  // Authority risks
  checkFreezeAuthority: boolean;
  checkMintAuthority: boolean;
  allowUnknownAuthorities: boolean;
  
  // Pool age & liquidity
  minPoolAgeSlots: 1000;        // ~8 minutes old minimum
  minLiquidityUSD: 5000;        // $5k minimum
  maxLiquidityAge: 300;         // Don't trust >5min old data
  
  // Holder distribution (if available)
  maxTopHolderPct: 30;          // Top holder can't have >30%
  minHolders: 50;               // At least 50 holders
  
  // LP risks
  checkLPLocked: boolean;
  minLPLockDays: 7;
  
  // Transfer restrictions
  maxTransferTaxBps: 500;       // Max 5% tax
  checkBlacklist: boolean;
}

interface TokenSafetyResult {
  passed: boolean;
  score: number;        // 0-100
  warnings: string[];
  blockers: string[];   // Critical issues
}
```

**Minimum Viable Safety (start with this):**
1. Pool age >8 minutes (prevents brand new scams)
2. Liquidity >$5k (prevents tiny rug pulls)
3. No freeze authority (prevents honeypots)
4. Top holder <30% (prevents dump risk)

**Priority:** HIGH - Filters worst scams

---

## Revised Implementation Spec

### Module 1: On-Chain Pool State Reader

```typescript
class PoolStateReader {
  async getPoolStateAtSlot(
    poolAddress: string,
    slot: number
  ): Promise<PoolStateSnapshot> {
    // 1. Fetch pool account data at slot
    // 2. Parse reserves from account data
    // 3. Compute price from reserves
    // 4. Return deterministic snapshot
  }
  
  async getRecentPoolState(
    poolAddress: string
  ): Promise<PoolStateSnapshot> {
    // Use latest confirmed slot
  }
}
```

**Deliverable:** Replace DexScreener liquidity with on-chain state

---

### Module 2: Strict Large Sell Detector

```typescript
interface LargeSellCriteria {
  minSellPct: number;           // 1%
  maxSellPct: number;           // 3%
  minAbsoluteSOL: number;       // 0.5 SOL
  minAbsoluteUSD: number;       // $200
}

class StrictSellDetector {
  async detectLargeSell(
    trade: NormalizedTrade,
    poolState: PoolStateSnapshot
  ): Promise<LargeSellEvent | null> {
    // Compute sell % from actual reserves
    const sellPct = trade.amountIn / poolState.reserveToken;
    
    // Check both % and absolute thresholds
    if (sellPct < criteria.minSellPct) return null;
    if (sellPct > criteria.maxSellPct) return null;
    if (trade.amountSOL < criteria.minAbsoluteSOL) return null;
    
    return {
      ...trade,
      sellPct,
      poolState,
      detectedAt: Date.now(),
    };
  }
}
```

**Deliverable:** Deterministic sell detection

---

### Module 3: Multi-Event Infra Classifier

```typescript
class StrictInfraClassifier {
  private candidates: Map<string, AbsorberCandidate>;
  
  recordAbsorption(
    wallet: string,
    event: AbsorptionEvent
  ): void {
    // Add to candidate tracking
    // Update metrics
    // Check if promotion criteria met
  }
  
  shouldPromoteToInfra(
    candidate: AbsorberCandidate
  ): boolean {
    return (
      candidate.absorptionEvents.length >= 3 &&
      candidate.distinctTokens.size >= 2 &&
      candidate.distinctHours.size >= 2 &&
      candidate.medianResponseSlots <= 20 &&
      candidate.consistencyScore >= 0.7
    );
  }
  
  getInfraWallets(): Map<string, ConfirmedInfraWallet> {
    // Only return confirmed, not candidates
  }
}
```

**Deliverable:** No more single-event infra classification

---

### Module 4: Strict Stabilization Gate

```typescript
class StrictStabilizationGate {
  async checkStabilization(
    sellEvent: LargeSellEvent,
    absorptionEvent: AbsorptionEvent,
    priceHistory: PriceCandle[]
  ): Promise<StabilizationConfirmed> {
    // Test 1: Higher lows
    const higherLows = this.detectHigherLows(priceHistory);
    if (higherLows.length < 2) return { isConfirmed: false };
    
    // Test 2: Defended level holds
    const defendedLevel = absorptionEvent.priceAtAbsorption;
    const breaksDefense = priceHistory.some(
      c => c.low < defendedLevel * 0.97
    );
    if (breaksDefense) return { isConfirmed: false };
    
    // Test 3: Volume contracted
    const volumeContracted = this.checkVolumeContraction(priceHistory);
    if (!volumeContracted) return { isConfirmed: false };
    
    // Test 4: No new large sells
    const newSells = await this.getNewSellsDuring(stabilizationWindow);
    if (newSells.length > 0) return { isConfirmed: false };
    
    // All tests passed
    return {
      isConfirmed: true,
      defendedLevel,
      higherLows: higherLows.map(c => c.low),
      volumeContracted: true,
      noNewLargeSells: true,
      reasons: ['All stabilization tests passed'],
    };
  }
}
```

**Deliverable:** No entries into ongoing dumps

---

### Module 5: Distribution Detector

```typescript
class DistributionDetector {
  private monitoredPositions: Map<string, MonitoredPosition>;
  
  async detectDistribution(
    position: OpenPosition,
    recentTrades: NormalizedTrade[]
  ): Promise<DistributionEvent | null> {
    // Check 1: Infra selling
    const infraSell = this.detectInfraSelling(
      position.infraWallet,
      recentTrades
    );
    if (infraSell) return infraSell;
    
    // Check 2: Defense stopped
    const defenseStopped = this.detectDefenseStopped(
      position.tokenMint,
      recentTrades
    );
    if (defenseStopped) return defenseStopped;
    
    // Check 3: Price stall + volume spike
    const priceStall = this.detectPriceStallWithVolume(
      position.tokenMint,
      recentCandles
    );
    if (priceStall) return priceStall;
    
    return null;
  }
  
  private detectInfraSelling(
    infraWallet: string,
    trades: NormalizedTrade[]
  ): DistributionEvent | null {
    // Find sells from infra wallet
    const infraSells = trades.filter(
      t => t.type === 'sell' && t.traderWallet === infraWallet
    );
    
    // Check if burst selling (>30% in short window)
    const totalSold = infraSells.reduce((sum, t) => sum + t.amountSOL, 0);
    if (totalSold > position.entryAmountSOL * 0.3) {
      return {
        type: 'infra_selling',
        infraWallet,
        severity: 'critical',
        shouldExit: true,
      };
    }
    
    return null;
  }
}
```

**Deliverable:** Early exit on infra distribution

---

### Module 6: Execution Engine with Controls

```typescript
class ControlledExecutionEngine {
  async executeBuy(
    tokenMint: string,
    amountSOL: number,
    policy: ExecutionPolicy
  ): Promise<ExecutionResult> {
    // 1. Get quote
    const quote = await this.getQuote(tokenMint, amountSOL);
    
    // 2. Check quote freshness
    if (Date.now() - quote.timestamp > policy.maxQuoteAgeMs) {
      return { success: false, error: 'Quote too stale' };
    }
    
    // 3. Check price impact
    if (quote.priceImpact > policy.maxPriceImpactPct) {
      return { success: false, error: 'Price impact too high' };
    }
    
    // 4. Set priority fee dynamically
    const priorityFee = await this.computePriorityFee(policy);
    
    // 5. Build and sign transaction
    const tx = await this.buildTransaction(quote, priorityFee);
    
    // 6. Send with retry logic
    return await this.sendWithRetry(tx, policy);
  }
}
```

**Deliverable:** Production-grade execution

---

### Module 7: Token Safety Checker

```typescript
class TokenSafetyChecker {
  async checkSafety(
    tokenMint: string,
    poolAddress: string
  ): Promise<TokenSafetyResult> {
    const warnings: string[] = [];
    const blockers: string[] = [];
    let score = 100;
    
    // Check 1: Pool age
    const poolAge = await this.getPoolAge(poolAddress);
    if (poolAge < 1000) {  // <8 minutes
      blockers.push('Pool too new');
      score -= 50;
    }
    
    // Check 2: Liquidity
    const liquidity = await this.getLiquidity(poolAddress);
    if (liquidity < 5000) {
      blockers.push('Liquidity too low');
      score -= 30;
    }
    
    // Check 3: Freeze authority
    const hasFreezeAuth = await this.checkFreezeAuthority(tokenMint);
    if (hasFreezeAuth) {
      blockers.push('Has freeze authority');
      score -= 40;
    }
    
    // Check 4: Top holder concentration
    const topHolderPct = await this.getTopHolderPercent(tokenMint);
    if (topHolderPct > 30) {
      warnings.push(`Top holder has ${topHolderPct}%`);
      score -= 20;
    }
    
    return {
      passed: blockers.length === 0 && score >= 50,
      score,
      warnings,
      blockers,
    };
  }
}
```

**Deliverable:** Filters worst scams

---

## Updated Signal Scoring

```typescript
interface SignalScore {
  total: number;  // 0-100
  
  components: {
    absorptionStrength: number;    // 0-30
    stabilizationQuality: number;  // 0-30
    walletConfidence: number;      // 0-20
    marketConditions: number;      // 0-10
    tokenSafety: number;           // 0-10
  };
  
  auditLog: {
    timestamp: number;
    inputs: any;
    reasoning: string[];
  };
}

function computeSignalScore(
  absorption: AbsorptionEvent,
  stabilization: StabilizationConfirmed,
  infraWallet: ConfirmedInfraWallet,
  tokenSafety: TokenSafetyResult
): SignalScore {
  // Component 1: Absorption (capped at 30)
  let absorptionScore = 0;
  const ratio = absorption.buybackAmount / absorption.sellAmount;
  absorptionScore += Math.min(ratio * 30, 20);
  if (absorption.responseSlots < 10) absorptionScore += 10;
  absorptionScore = Math.min(absorptionScore, 30);
  
  // Component 2: Stabilization (capped at 30)
  let stabilizationScore = 0;
  stabilizationScore += stabilization.higherLows.length * 10;
  if (stabilization.volumeContracted) stabilizationScore += 10;
  if (stabilization.noNewLargeSells) stabilizationScore += 10;
  stabilizationScore = Math.min(stabilizationScore, 30);
  
  // Component 3: Wallet confidence (capped at 20)
  let walletScore = 0;
  if (infraWallet.behaviorType === 'defensive') walletScore += 15;
  else if (infraWallet.behaviorType === 'aggressive') walletScore += 10;
  if (infraWallet.absorptionCount >= 10) walletScore += 5;
  walletScore = Math.min(walletScore, 20);
  
  // Component 4: Market conditions (capped at 10)
  let marketScore = 10; // Placeholder
  
  // Component 5: Token safety (capped at 10)
  let safetyScore = tokenSafety.score / 10;
  
  const total = 
    absorptionScore +
    stabilizationScore +
    walletScore +
    marketScore +
    safetyScore;
  
  return {
    total: Math.min(total, 100),
    components: {
      absorptionStrength: absorptionScore,
      stabilizationQuality: stabilizationScore,
      walletConfidence: walletScore,
      marketConditions: marketScore,
      tokenSafety: safetyScore,
    },
    auditLog: {
      timestamp: Date.now(),
      inputs: { absorption, stabilization, infraWallet, tokenSafety },
      reasoning: [
        `Absorption: ${absorptionScore}/30`,
        `Stabilization: ${stabilizationScore}/30`,
        `Wallet: ${walletScore}/20`,
        `Market: ${marketScore}/10`,
        `Safety: ${safetyScore}/10`,
      ],
    },
  };
}
```

---

## Testing Plan (Non-Negotiable)

### Phase 1: Replay Simulation (Before Any Live Trading)

```bash
# Record real swaps for 3-7 days
npm run record-swaps --days 7

# Replay through detector
npm run replay-test --input swaps.json

# Generate report
- Signal hit rate
- False positive rate (wallets marked as infra incorrectly)
- Average MAE/MFE after entry
- Drawdown analysis
- Distribution detection accuracy
```

### Phase 2: Paper Trading with Live Feeds (2-4 weeks)

```bash
# Run in paper mode with all fixes
PAPER_TRADING_MODE=true npm run dev

# Daily reports required:
- Signals generated
- Entries executed (simulated)
- Exits triggered
- Would-be P&L
- Slippage estimates
- Failed executions
```

### Phase 3: Live Trading Micro-Size (4+ weeks)

```bash
# Strict limits
MAX_CONCURRENT_POSITIONS=1
BUY_AMOUNT_SOL=0.01  # 0.01 SOL only
MAX_DAILY_LOSS_SOL=0.05
TAKE_PROFIT_PCT=10   # Tighter TP initially
STOP_LOSS_PCT=5      # Tighter SL initially

# Daily reporting mandatory
```

---

## Safer Default Parameters (Use These Now)

```bash
# Sell detection
MIN_SELL_LIQUIDITY_PCT=1.5     # Stricter
MAX_SELL_LIQUIDITY_PCT=2.5
MIN_ABSOLUTE_SELL_SOL=0.5
MIN_ABSOLUTE_SELL_USD=200

# Absorption
ABSORPTION_WINDOW_SLOTS=20     # ~10 seconds (not 30)
MIN_ABSORPTION_RATIO=0.6       # Higher threshold
MIN_ABSORPTION_EVENTS=3        # NEW: Require 3 events
MIN_DISTINCT_TOKENS=2          # NEW: On 2+ tokens

# Stabilization
MIN_HIGHER_LOWS=2
HIGHER_LOW_THRESHOLD_PCT=2
MAX_DRAWDOWN_FROM_DEFENSE=3
VOLUME_CONTRACTION_RATIO=0.6
MIN_STABILIZATION_SLOTS=60     # ~30 seconds minimum
MAX_STABILIZATION_SLOTS=600    # ~5 minutes maximum

# Entry
MIN_SIGNAL_STRENGTH=70         # Higher threshold
MAX_CONCURRENT_POSITIONS=1     # Start with 1
BUY_AMOUNT_SOL=0.05            # Small size

# Exit
TAKE_PROFIT_PCT=12             # Reasonable
STOP_LOSS_PCT=6                # Tight
TIME_STOP_MINUTES=15           # Exit if no progress
ENABLE_DISTRIBUTION_EXIT=true  # NEW: Exit on infra distribution

# Safety
MIN_POOL_AGE_SLOTS=1000        # ~8 minutes
MIN_LIQUIDITY_USD=5000
CHECK_FREEZE_AUTHORITY=true
MAX_TOP_HOLDER_PCT=30
```

---

## Critical Refinements (Edge Multipliers)

### Refinement 1: No-Trade Regime Detector

**Problem:** Even with valid infra wallets, some market conditions are hostile:
- Choppy conditions (constant back-and-forth)
- Infra saturation (too many bots copying same wallets)
- Copy-bot congestion (retail front-running infra)
- Rapid wallet rotation (infra changing strategies)

**Solution:** Add global gate that disables entries when market is hostile

```typescript
interface NoTradeRegimeDetector {
  // Activity collapse signals
  absorptionFrequencyDropPct: number;    // -50% from baseline
  minAbsorptionsPerHour: number;         // At least 2/hour baseline
  
  // Wallet rotation signals
  newInfraWalletsPerDay: number;         // >10 new wallets = saturation
  walletTurnoverRate: number;            // >30% churn in 24h = rotation
  
  // Market chop signals
  avgHoldTimeMinutes: number;            // <5 min avg = chop
  winRateCollapse: boolean;              // Win rate drops >20pts
  
  // Copy-bot detection
  frontRunDetectionRate: number;         // Our entries getting front-run >40%
  slippageSpikePct: number;              // Slippage >2x normal
}

interface RegimeState {
  isTradeableRegime: boolean;
  reason: string;
  metrics: {
    absorptionFrequency: number;
    walletChurnRate: number;
    avgHoldTime: number;
    currentWinRate: number;
    frontRunRate: number;
  };
  lastGoodRegime: Date;
  daysSinceGoodRegime: number;
}

class NoTradeRegimeDetector {
  private baselineMetrics: BaselineMetrics;
  private rollingWindow: RollingMetrics;
  
  checkRegime(): RegimeState {
    // Signal 1: Absorption frequency collapsed
    const currentFrequency = this.rollingWindow.absorptionsPerHour;
    const baselineFrequency = this.baselineMetrics.absorptionsPerHour;
    if (currentFrequency < baselineFrequency * 0.5) {
      return {
        isTradeableRegime: false,
        reason: 'Infra activity collapsed',
        metrics: this.getCurrentMetrics(),
      };
    }
    
    // Signal 2: Too many new wallets (saturation)
    const newWalletsToday = this.rollingWindow.newInfraWallets24h;
    if (newWalletsToday > 10) {
      return {
        isTradeableRegime: false,
        reason: 'Infra wallet saturation - too crowded',
        metrics: this.getCurrentMetrics(),
      };
    }
    
    // Signal 3: Rapid churn (wallets rotating fast)
    const churnRate = this.rollingWindow.walletTurnover24h;
    if (churnRate > 0.3) {
      return {
        isTradeableRegime: false,
        reason: 'High wallet churn - strategies changing',
        metrics: this.getCurrentMetrics(),
      };
    }
    
    // Signal 4: Average hold time collapsed (chop)
    const avgHold = this.rollingWindow.avgHoldTimeMinutes;
    if (avgHold < 5) {
      return {
        isTradeableRegime: false,
        reason: 'Hold times too short - choppy market',
        metrics: this.getCurrentMetrics(),
      };
    }
    
    // Signal 5: Copy-bot congestion (front-running)
    const frontRunRate = this.rollingWindow.frontRunDetectionRate;
    if (frontRunRate > 0.4) {
      return {
        isTradeableRegime: false,
        reason: 'High front-run rate - copy-bot congestion',
        metrics: this.getCurrentMetrics(),
      };
    }
    
    // All clear
    return {
      isTradeableRegime: true,
      reason: 'Normal regime',
      metrics: this.getCurrentMetrics(),
    };
  }
  
  establishBaseline(historicalData: TradeHistory[]): void {
    // Compute baseline from first 7 days of operation
    this.baselineMetrics = {
      absorptionsPerHour: this.computeAvgAbsorptionsPerHour(historicalData),
      avgHoldTime: this.computeAvgHoldTime(historicalData),
      typicalWinRate: this.computeWinRate(historicalData),
    };
  }
}
```

**When to disable trading:**
- Absorption frequency drops >50% from baseline
- More than 10 new infra wallets discovered in 24h (saturation)
- Wallet churn >30% in 24h (rotation)
- Average hold time <5 minutes (chop)
- Front-run rate >40% (copy-bot congestion)

**Priority:** HIGH - Prevents death by overtrading

---

### Refinement 2: Confidence Decay System

**Problem:** Infra wallets don't stay good forever:
- Strategies change
- Wallets shut off / stop defending
- Other bots copy them (edge decay)
- Win rates collapse but confidence stays high

**Solution:** Time-decay confidence + recency weighting

```typescript
interface ConfidenceDecayPolicy {
  // Time decay
  halfLifeDays: number;              // Confidence halves every N days
  minConfidenceBeforeRemoval: number; // Remove if drops below 20
  
  // Activity requirements
  minActivityDays: number;           // Must be active in last 7 days
  inactivityPenaltyPerDay: number;   // -5 confidence per day inactive
  
  // Performance decay
  recentWindowDays: number;          // Weight last 7 days heavily
  recentWeight: number;              // 70% weight on recent, 30% on historical
  winRateDecayThreshold: number;     // If recent win rate <30%, decay fast
  
  // Copy-bot detection
  volumeSpikeMultiple: number;       // If volume on this wallet's tokens spikes 3x
  frontRunningDetected: boolean;     // Others front-running this wallet's moves
}

interface InfraWalletWithDecay extends InfraWallet {
  // Decay tracking
  confidenceHistory: Array<{
    date: Date;
    confidence: number;
    reason: string;
  }>;
  
  lastActivityDate: Date;
  daysSinceActivity: number;
  
  // Performance tracking
  recentWinRate: number;      // Last 7 days
  historicalWinRate: number;  // All time
  winRateDecayRate: number;   // How fast it's declining
  
  // Edge decay signals
  copyBotActivity: number;    // 0-1 score of copy-bot congestion
  volumeAnomaly: number;      // Unusual volume on their tokens
  
  // Status
  status: 'active' | 'decaying' | 'inactive' | 'deprecated';
}

class ConfidenceDecaySystem {
  private policy: ConfidenceDecayPolicy;
  
  updateWalletConfidence(
    wallet: InfraWalletWithDecay,
    recentActivity: ActivityWindow
  ): InfraWalletWithDecay {
    let newConfidence = wallet.confidenceScore;
    const reasons: string[] = [];
    
    // 1. Time decay (exponential)
    const daysSinceLastUpdate = this.getDaysSince(wallet.lastUpdated);
    const decayFactor = Math.pow(0.5, daysSinceLastUpdate / this.policy.halfLifeDays);
    newConfidence *= decayFactor;
    reasons.push(`Time decay: ${decayFactor.toFixed(2)}x over ${daysSinceLastUpdate} days`);
    
    // 2. Inactivity penalty
    const daysSinceActivity = this.getDaysSince(wallet.lastActivityDate);
    if (daysSinceActivity > this.policy.minActivityDays) {
      const penalty = daysSinceActivity * this.policy.inactivityPenaltyPerDay;
      newConfidence -= penalty;
      reasons.push(`Inactivity penalty: -${penalty} for ${daysSinceActivity} days`);
      
      if (daysSinceActivity > 30) {
        wallet.status = 'inactive';
      }
    }
    
    // 3. Win rate collapse
    const recentWinRate = this.computeRecentWinRate(wallet, 7);
    if (recentWinRate < this.policy.winRateDecayThreshold) {
      const penalty = (this.policy.winRateDecayThreshold - recentWinRate) * 100;
      newConfidence -= penalty;
      reasons.push(`Win rate collapse: ${recentWinRate.toFixed(1)}% (threshold: ${this.policy.winRateDecayThreshold}%)`);
      wallet.status = 'decaying';
    }
    
    // 4. Copy-bot detection
    const copyBotScore = this.detectCopyBotActivity(wallet);
    if (copyBotScore > 0.5) {
      const penalty = copyBotScore * 20;
      newConfidence -= penalty;
      reasons.push(`Copy-bot activity detected: ${(copyBotScore * 100).toFixed(0)}%`);
    }
    
    // 5. Recency weighting (boost if recent performance is good)
    if (recentWinRate > wallet.historicalWinRate) {
      const boost = (recentWinRate - wallet.historicalWinRate) * 50;
      newConfidence += boost;
      reasons.push(`Recent outperformance: +${boost.toFixed(1)}`);
    }
    
    // Floor and ceiling
    newConfidence = Math.max(0, Math.min(100, newConfidence));
    
    // Deprecate if too low
    if (newConfidence < this.policy.minConfidenceBeforeRemoval) {
      wallet.status = 'deprecated';
      reasons.push('Confidence below minimum - wallet deprecated');
    }
    
    // Update wallet
    wallet.confidenceScore = newConfidence;
    wallet.confidenceHistory.push({
      date: new Date(),
      confidence: newConfidence,
      reason: reasons.join('; '),
    });
    
    return wallet;
  }
  
  detectCopyBotActivity(wallet: InfraWallet): number {
    // Signal 1: Volume spike on tokens they trade
    const volumeSpike = this.getVolumeAnomaly(wallet.recentTokens);
    
    // Signal 2: Front-running detection
    const frontRunRate = this.getFrontRunRate(wallet.address);
    
    // Signal 3: Strategy similarity (other wallets copying patterns)
    const similarityScore = this.getStrategySimilarityScore(wallet);
    
    // Combine signals
    return Math.max(volumeSpike, frontRunRate, similarityScore);
  }
  
  cleanupDeprecatedWallets(): void {
    // Remove wallets with status 'deprecated' from active list
    // Keep in historical database for analysis
    const deprecated = this.wallets.filter(w => w.status === 'deprecated');
    for (const wallet of deprecated) {
      this.archiveWallet(wallet);
      this.activeWallets.delete(wallet.address);
    }
  }
}
```

**Decay rules:**
- **Time decay**: Confidence halves every 14 days (tunable)
- **Inactivity penalty**: -5 confidence per day with no activity after 7 days
- **Win rate collapse**: If recent win rate <30%, accelerate decay
- **Copy-bot detection**: If volume spikes 3x on their tokens, likely copied
- **Deprecation**: Remove wallets if confidence drops below 20

**Priority:** HIGH - Prevents trading on stale/compromised wallets

---

## Priority Order for Implementation

### Week 1 (Critical Blockers)
1. ✅ Add PoolStateReader (on-chain reserves)
2. ✅ Fix sell detection to use reserves
3. ✅ Implement multi-event infra classification
4. ✅ Strengthen stabilization gate

### Week 2 (Critical)
5. ✅ Add DistributionDetector
6. ✅ Implement exit-on-distribution
7. ✅ Add token safety checks
8. ✅ Update signal scoring

### Week 3 (High - Edge Multipliers)
9. ✅ Improve execution engine (priority fees, retries)
10. ✅ Add execution diagnostics
11. ✅ **Implement No-Trade Regime Detector** (NEW)
12. ✅ **Implement Confidence Decay System** (NEW)
13. ✅ Implement replay testing framework

### Week 4+ (Testing)
14. ✅ Run 7-day replay simulation
15. ✅ Paper trade for 2-4 weeks with regime detector
16. ✅ Track confidence decay in paper trading
17. ✅ Micro-size live testing

---

## Final Operational Layer (Production Hardening)

These four additions transform the bot from "technically correct" to "production-grade with longevity."

---

### Addition 1: Capital Stress Governor (Prevents Silent Ruin)

**Problem:** Even good systems hit periods of:
- Correlated losses (multiple positions fail simultaneously)
- Regime shifts (market conditions change)
- Infra edge decay across all tokens at once

Without capital governance, drawdowns compound invisibly.

**Solution:** Global risk governor that reduces exposure under stress

```typescript
interface CapitalStressRules {
  // Drawdown limits
  maxDailyDrawdownPct: number;      // 5% daily
  maxWeeklyDrawdownPct: number;     // 10% weekly
  maxMonthlyDrawdownPct: number;    // 15% monthly
  
  // Losing streak detection
  consecutiveLossesBeforeReduce: number;  // 3 in a row
  
  // Signal quality degradation
  minAvgSignalQuality: number;      // 60/100 average
  signalQualityWindowHours: number; // Over 24 hours
  
  // Response actions
  positionSizeReductionPct: number; // Reduce to 50% size
  freezeDurationHours: number;      // Or freeze for 12 hours
  signalThresholdIncrease: number;  // Or require +10 signal strength
}

interface StressState {
  level: 'normal' | 'caution' | 'stress' | 'frozen';
  positionSizeMultiplier: number;   // 1.0 = normal, 0.5 = reduced, 0 = frozen
  minSignalThreshold: number;       // Adjusted threshold
  
  triggers: {
    consecutiveLosses: number;
    dailyDrawdown: number;
    weeklyDrawdown: number;
    avgSignalQuality: number;
  };
  
  lastStateChange: Date;
  reasonsForState: string[];
}

class CapitalStressGovernor {
  private state: StressState;
  private tradeHistory: TradeResult[];
  
  evaluateStressLevel(): StressState {
    const reasons: string[] = [];
    let level: StressState['level'] = 'normal';
    let sizeMultiplier = 1.0;
    let signalThreshold = this.baseConfig.minSignalStrength;
    
    // Check 1: Consecutive losses
    const recentLosses = this.getConsecutiveLosses();
    if (recentLosses >= 3) {
      level = 'stress';
      sizeMultiplier = 0.5;
      signalThreshold += 10;
      reasons.push(`${recentLosses} consecutive losses`);
    } else if (recentLosses >= 2) {
      level = 'caution';
      sizeMultiplier = 0.75;
      reasons.push(`${recentLosses} losses in a row`);
    }
    
    // Check 2: Daily drawdown
    const dailyDD = this.getDailyDrawdown();
    if (dailyDD > this.rules.maxDailyDrawdownPct) {
      level = 'frozen';
      sizeMultiplier = 0;
      reasons.push(`Daily DD ${dailyDD.toFixed(1)}% > limit ${this.rules.maxDailyDrawdownPct}%`);
    }
    
    // Check 3: Weekly drawdown
    const weeklyDD = this.getWeeklyDrawdown();
    if (weeklyDD > this.rules.maxWeeklyDrawdownPct) {
      level = 'stress';
      sizeMultiplier = Math.min(sizeMultiplier, 0.25);
      reasons.push(`Weekly DD ${weeklyDD.toFixed(1)}% > limit ${this.rules.maxWeeklyDrawdownPct}%`);
    }
    
    // Check 4: Signal quality degradation
    const avgQuality = this.getAvgSignalQuality(24); // Last 24 hours
    if (avgQuality < this.rules.minAvgSignalQuality) {
      level = level === 'normal' ? 'caution' : level;
      sizeMultiplier *= 0.75;
      signalThreshold += 5;
      reasons.push(`Signal quality ${avgQuality.toFixed(0)}/100 below ${this.rules.minAvgSignalQuality}`);
    }
    
    return {
      level,
      positionSizeMultiplier: sizeMultiplier,
      minSignalThreshold: signalThreshold,
      triggers: {
        consecutiveLosses: recentLosses,
        dailyDrawdown: dailyDD,
        weeklyDrawdown: weeklyDD,
        avgSignalQuality: avgQuality,
      },
      lastStateChange: new Date(),
      reasonsForState: reasons,
    };
  }
  
  shouldAllowTrade(signal: InfraSignal): boolean {
    const state = this.evaluateStressLevel();
    
    // Frozen = no trades
    if (state.level === 'frozen') {
      log.warn('❄️  FROZEN: No new trades allowed', {
        reasons: state.reasonsForState,
      });
      return false;
    }
    
    // Check if signal meets adjusted threshold
    if (signal.strength < state.minSignalThreshold) {
      log.info('⚠️  Signal below stress-adjusted threshold', {
        signal: signal.strength,
        required: state.minSignalThreshold,
        stressLevel: state.level,
      });
      return false;
    }
    
    return true;
  }
  
  getAdjustedPositionSize(baseSize: number): number {
    const state = this.evaluateStressLevel();
    return baseSize * state.positionSizeMultiplier;
  }
}
```

**Effect:** Bad weeks become small weeks, not blowups.

**Priority:** HIGH - Capital preservation

---

### Addition 2: Cross-Token Correlation Guard (Prevents Hidden Concentration)

**Problem:** Infra traders often operate across:
- Multiple Pump launches simultaneously
- Same narrative cluster
- Correlated token pairs

Your bot may think it has 3 independent positions, but they're all tied to the same infra wallet strategy.

**Solution:** Prevent stacked exposure to one infra strategy

```typescript
interface CorrelationGuard {
  // Correlation thresholds
  maxSharedInfraWalletsPct: number;   // 60% overlap = correlated
  maxSameLaunchWindowMinutes: number; // Launched within 30 min
  maxSameLiquiditySource: number;     // Same LP provider
  
  // Limits
  maxCorrelatedPositions: number;     // Max 2 correlated positions
}

interface PositionCorrelation {
  position1: OpenPosition;
  position2: OpenPosition;
  correlationScore: number;  // 0-1
  
  factors: {
    sharedInfraWallets: number;      // % overlap
    launchTimeDelta: number;         // Minutes apart
    sameLiquiditySource: boolean;
    sameNarrative: boolean;          // "AI tokens", "meme coins", etc.
  };
}

class CrossTokenCorrelationGuard {
  checkCorrelation(
    newPosition: ProposedPosition,
    existingPositions: OpenPosition[]
  ): { allowed: boolean; reason?: string } {
    
    for (const existing of existingPositions) {
      const correlation = this.computeCorrelation(newPosition, existing);
      
      // Check infra wallet overlap
      const sharedWallets = this.getSharedInfraWallets(
        newPosition.infraWallet,
        existing.infraWallet
      );
      
      if (sharedWallets.overlapPct > 0.6) {
        // Check if we already have too many correlated positions
        const correlatedCount = this.countCorrelatedPositions(
          newPosition.infraWallet,
          existingPositions
        );
        
        if (correlatedCount >= 2) {
          return {
            allowed: false,
            reason: `Already have ${correlatedCount} positions using same infra strategy (${sharedWallets.overlapPct.toFixed(0)}% wallet overlap)`,
          };
        }
      }
      
      // Check launch timing correlation
      const launchDelta = Math.abs(
        newPosition.tokenLaunchTime - existing.tokenLaunchTime
      );
      if (launchDelta < 30 * 60 * 1000) { // 30 minutes
        return {
          allowed: false,
          reason: `Token launched within ${(launchDelta / 60000).toFixed(0)} min of existing position - likely correlated`,
        };
      }
    }
    
    return { allowed: true };
  }
  
  private computeCorrelation(
    pos1: ProposedPosition | OpenPosition,
    pos2: OpenPosition
  ): PositionCorrelation {
    // Compute overlap of infra wallets
    const wallet1Set = new Set(pos1.infraWallets || [pos1.infraWallet]);
    const wallet2Set = new Set(pos2.infraWallets || [pos2.infraWallet]);
    const intersection = new Set([...wallet1Set].filter(w => wallet2Set.has(w)));
    const union = new Set([...wallet1Set, ...wallet2Set]);
    const overlapPct = intersection.size / union.size;
    
    // Compute launch time correlation
    const launchDelta = Math.abs(
      pos1.tokenLaunchTime - pos2.tokenLaunchTime
    ) / 60000; // minutes
    
    // Compute overall correlation score
    let score = 0;
    score += overlapPct * 0.5;  // 50% weight on wallet overlap
    score += (launchDelta < 30 ? 0.3 : 0); // 30% if launched together
    score += (pos1.liquiditySource === pos2.liquiditySource ? 0.2 : 0);
    
    return {
      position1: pos1,
      position2: pos2,
      correlationScore: score,
      factors: {
        sharedInfraWallets: overlapPct,
        launchTimeDelta: launchDelta,
        sameLiquiditySource: pos1.liquiditySource === pos2.liquiditySource,
        sameNarrative: false, // Optional: implement narrative detection
      },
    };
  }
}
```

**Effect:** Prevents hidden concentration risk

**Priority:** MEDIUM-HIGH - Risk management

---

### Addition 3: Regime-Aware Position Sizing (Adaptive, Not Binary)

**Problem:** Current no-trade detector is binary (trade / don't trade). Better approach is adaptive sizing.

**Solution:** Smooth de-risking based on regime quality

```typescript
interface RegimeBasedSizing {
  regimeQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'hostile';
  sizeMultiplier: number;  // 0-1.5
  reasoning: string[];
}

class AdaptivePositionSizer {
  computeRegimeBasedSize(
    baseSize: number,
    regimeState: RegimeState,
    stressState: StressState
  ): number {
    
    let multiplier = 1.0;
    const reasons: string[] = [];
    
    // Factor 1: Regime quality
    if (regimeState.isTradeableRegime) {
      const metrics = regimeState.metrics;
      
      // Excellent regime (can even size up slightly)
      if (
        metrics.absorptionFrequency > 3 && // >3 per hour
        metrics.avgHoldTime > 15 &&         // >15 min holds
        metrics.currentWinRate > 0.6        // >60% win rate
      ) {
        multiplier = 1.2;
        reasons.push('Excellent regime: size up 20%');
      }
      // Good regime (normal size)
      else if (
        metrics.absorptionFrequency > 2 &&
        metrics.avgHoldTime > 10 &&
        metrics.currentWinRate > 0.5
      ) {
        multiplier = 1.0;
        reasons.push('Good regime: normal size');
      }
      // Fair regime (reduce size)
      else {
        multiplier = 0.5;
        reasons.push('Fair regime: half size');
      }
    } else {
      // Poor/hostile regime
      multiplier = 0.25;
      reasons.push(`Hostile regime (${regimeState.reason}): quarter size`);
    }
    
    // Factor 2: Capital stress (override if worse)
    if (stressState.positionSizeMultiplier < multiplier) {
      multiplier = stressState.positionSizeMultiplier;
      reasons.push(`Capital stress override: ${(multiplier * 100).toFixed(0)}%`);
    }
    
    // Factor 3: Time of day (optional)
    const hour = new Date().getUTCHours();
    if (hour >= 1 && hour <= 6) { // Low liquidity hours
      multiplier *= 0.75;
      reasons.push('Low liquidity hours: reduce 25%');
    }
    
    const finalSize = baseSize * multiplier;
    
    log.info('📊 Adaptive position sizing', {
      baseSize: baseSize.toFixed(3),
      multiplier: multiplier.toFixed(2),
      finalSize: finalSize.toFixed(3),
      reasons: reasons.join('; '),
    });
    
    return finalSize;
  }
}
```

**Sizing Table:**

| Regime | Multiplier | Notes |
|--------|------------|-------|
| Excellent | 1.2x | >3 absorptions/hr, >60% win rate |
| Good | 1.0x | Normal conditions |
| Fair | 0.5x | Mild chop |
| Poor | 0.25x | Saturation detected |
| Hostile | 0x | No trades |

**Effect:** Smooth de-risking instead of binary freeze

**Priority:** MEDIUM - Improves capital efficiency

---

### Addition 4: Post-Trade Attribution Engine (Learning System)

**Problem:** Without attribution, you can't answer:
- Which infra types are profitable?
- Which exits save money?
- Which filters actually matter?
- Why did this trade fail?

**Solution:** Log everything, analyze periodically

```typescript
interface TradeAttribution {
  // Trade identification
  tradeId: string;
  tokenMint: string;
  timestamp: Date;
  
  // Entry analysis
  entryReason: {
    signalType: SignalType;
    signalStrength: number;
    absorptionRatio: number;
    stabilizationQuality: number;
    infraWalletType: InfraBehaviorType;
    infraWalletConfidence: number;
    tokenSafetyScore: number;
  };
  
  // Context
  regimeAtEntry: {
    quality: string;
    absorptionFrequency: number;
    avgHoldTime: number;
    winRate: number;
  };
  
  stressAtEntry: {
    level: string;
    consecutiveLosses: number;
    dailyDrawdown: number;
  };
  
  // Position details
  entryPrice: number;
  positionSize: number;
  holdingTimeMinutes: number;
  
  // Exit analysis
  exitReason: 'take_profit' | 'stop_loss' | 'time_stop' | 'distribution' | 'defense_stopped' | 'regime_hostile';
  exitPrice: number;
  
  // Performance
  pnlSOL: number;
  pnlPct: number;
  maxAdverseExcursion: number;  // MAE - worst unrealized loss
  maxFavorableExcursion: number; // MFE - best unrealized profit
  
  // What saved/hurt us
  savedBy?: string;  // "distribution_exit", "time_stop", etc.
  hurtBy?: string;   // "late_entry", "poor_execution", etc.
}

class PostTradeAttributionEngine {
  private attributions: TradeAttribution[] = [];
  
  recordTrade(trade: CompletedTrade): void {
    const attribution: TradeAttribution = {
      tradeId: trade.id,
      tokenMint: trade.tokenMint,
      timestamp: trade.exitTime,
      
      entryReason: {
        signalType: trade.signal.type,
        signalStrength: trade.signal.strength,
        absorptionRatio: trade.absorptionEvent.ratio,
        stabilizationQuality: trade.stabilization.score,
        infraWalletType: trade.infraWallet.behaviorType,
        infraWalletConfidence: trade.infraWallet.confidenceScore,
        tokenSafetyScore: trade.tokenSafety.score,
      },
      
      regimeAtEntry: trade.regimeSnapshot,
      stressAtEntry: trade.stressSnapshot,
      
      entryPrice: trade.entryPrice,
      positionSize: trade.positionSize,
      holdingTimeMinutes: trade.holdingTimeMinutes,
      
      exitReason: trade.exitReason,
      exitPrice: trade.exitPrice,
      
      pnlSOL: trade.pnlSOL,
      pnlPct: trade.pnlPct,
      maxAdverseExcursion: trade.mae,
      maxFavorableExcursion: trade.mfe,
      
      savedBy: this.determineSavingFactor(trade),
      hurtBy: this.determineHarmFactor(trade),
    };
    
    this.attributions.push(attribution);
  }
  
  generatePeriodicReport(): AttributionReport {
    const last100 = this.attributions.slice(-100);
    
    return {
      // By infra type
      byInfraType: this.groupBy(last100, 'infraWalletType'),
      
      // By exit reason
      byExitReason: this.groupBy(last100, 'exitReason'),
      
      // By regime quality
      byRegime: this.groupBy(last100, t => t.regimeAtEntry.quality),
      
      // Filter effectiveness
      filterAnalysis: {
        stabilizationGate: this.analyzeFilterImpact('stabilization'),
        tokenSafety: this.analyzeFilterImpact('tokenSafety'),
        regimeDetector: this.analyzeFilterImpact('regime'),
      },
      
      // Exit effectiveness
      exitAnalysis: {
        distributionExits: this.analyzeExitType('distribution'),
        stopLosses: this.analyzeExitType('stop_loss'),
        takeProfit: this.analyzeExitType('take_profit'),
        timeStops: this.analyzeExitType('time_stop'),
      },
      
      // Key insights
      insights: this.generateInsights(last100),
    };
  }
  
  private analyzeFilterImpact(filterName: string): FilterImpact {
    // Compare trades that passed filter vs would-have-failed trades
    // Compute: avg PnL difference, win rate improvement, etc.
    
    return {
      filterName,
      tradesAffected: 0,
      avgPnlImprovement: 0,
      winRateImprovement: 0,
      worthKeeping: true,
    };
  }
  
  private generateInsights(trades: TradeAttribution[]): string[] {
    const insights: string[] = [];
    
    // Insight 1: Best infra type
    const byType = this.groupBy(trades, 'infraWalletType');
    const bestType = Object.entries(byType)
      .sort((a, b) => b[1].avgPnl - a[1].avgPnl)[0];
    insights.push(`Best performing infra type: ${bestType[0]} (${bestType[1].avgPnl.toFixed(1)}% avg)`);
    
    // Insight 2: Most valuable exit
    const distributionExits = trades.filter(t => t.savedBy === 'distribution_exit');
    if (distributionExits.length > 0) {
      const avgSaved = distributionExits.reduce((sum, t) => 
        sum + (t.mfe - t.pnlPct), 0
      ) / distributionExits.length;
      insights.push(`Distribution exits saved avg ${avgSaved.toFixed(1)}% per trade (${distributionExits.length} times)`);
    }
    
    // Insight 3: Regime impact
    const excellentRegime = trades.filter(t => t.regimeAtEntry.quality === 'excellent');
    const poorRegime = trades.filter(t => t.regimeAtEntry.quality === 'poor');
    if (excellentRegime.length > 10 && poorRegime.length > 10) {
      const delta = 
        (excellentRegime.reduce((s, t) => s + t.pnlPct, 0) / excellentRegime.length) -
        (poorRegime.reduce((s, t) => s + t.pnlPct, 0) / poorRegime.length);
      insights.push(`Excellent regime trades perform ${delta.toFixed(1)}% better than poor regime`);
    }
    
    return insights;
  }
}

// Usage in main bot
class InfraSignalBot {
  private attribution: PostTradeAttributionEngine;
  
  async onTradeComplete(trade: CompletedTrade): Promise<void> {
    // Record attribution
    this.attribution.recordTrade(trade);
    
    // Generate report every 25 trades
    if (this.tradeCount % 25 === 0) {
      const report = this.attribution.generatePeriodicReport();
      log.info('📊 ATTRIBUTION REPORT', report);
      
      // Save to file for analysis
      await this.saveAttributionReport(report);
    }
  }
}
```

**Questions attribution answers:**
- Which infra wallet types are profitable? (defensive vs aggressive)
- Which exits matter most? (distribution vs time stop vs TP)
- Which filters prevent losses? (stabilization vs token safety)
- Which regime filters work? (no-trade detector effectiveness)

**Effect:** System learns and improves over time

**Priority:** MEDIUM - Long-term edge preservation

---

## What NOT to Add (Critical)

**Do NOT add:**
- ❌ Predictive models / ML classifiers
- ❌ More indicators / oscillators
- ❌ Faster execution hacks
- ❌ Token whitelists
- ❌ Price prediction algos

**Why not?**
These add complexity before edge stabilizes. Right now, the system is valuable because it's:
- ✅ Rule-driven (debuggable)
- ✅ Interpretable (know why it trades)
- ✅ Falsifiable (can test assumptions)
- ✅ Transparent (no black boxes)

Keep it that way until you have 500+ trades proving the edge.

---

## Expected Performance (Realistic)

With all fixes + operational layer, the bot should:

✅ **Win Rate:** 40-55% (not 80%+)  
✅ **Average Win:** +8-15%  
✅ **Average Loss:** -4-6%  
✅ **Max Drawdown:** <20% of capital (with governor: <10%)  
✅ **Profit Factor:** 1.5-2.5  
✅ **Capital Preservation:** Strong (stress governor + correlation guard)  

**It will NOT:**
❌ Catch the exact bottom  
❌ Win every signal  
❌ Beat professional market makers  

**It CAN:**
✅ Enter after stabilization confirms  
✅ Exit before full distribution  
✅ Keep losses mechanically small  
✅ Reduce exposure under stress  
✅ Learn and improve over time  
✅ Be profitable over 100+ trades  

---

## Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Capital Stress Governor                       │
│              (Global risk management - freezes if needed)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   No-Trade Regime Detector                      │
│        (Disables trading in hostile conditions)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   On-Chain Pool State Reader                    │
│              (Deterministic liquidity from reserves)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Large Sell Detector                           │
│         (1-3% of pool, confirmed on-chain)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Multi-Event Infra Classifier                  │
│    (3+ absorptions, 2+ tokens, confidence decay)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Strict Stabilization Gate                     │
│        (5 tests: higher lows, volume, defended level)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Correlation Guard                             │
│         (Prevent stacked exposure to same strategy)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Adaptive Position Sizer                       │
│         (Size based on regime + stress + time)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Execution Engine                              │
│     (Fresh quotes, priority fees, impact guards)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Distribution Detector                         │
│    (Monitor infra exits, defense stops, price stalls)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Attribution Engine                            │
│           (Learn what works, improve over time)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary: Production-Grade Bot Specification

### Core Truth
**You are not trying to beat infrastructure traders — you are building a system that only trades when their behavior makes risk asymmetric.**

### What Makes This System Work

**Structural Correctness:**
1. ✅ On-chain pool state (deterministic)
2. ✅ Multi-event infra discovery (no whale misclassification)
3. ✅ Strict stabilization gate (no dump entries)
4. ✅ Distribution detection (exit before full rotation)
5. ✅ Execution controls (MEV, slippage, priority fees)
6. ✅ Token safety (filter worst scams)

**Edge Preservation:**
7. ✅ No-trade regime detection (don't trade hostile conditions)
8. ✅ Confidence decay (wallets don't stay good forever)

**Capital Management:**
9. ✅ Stress governor (bad weeks → small weeks)
10. ✅ Correlation guard (prevent hidden concentration)
11. ✅ Adaptive sizing (smooth de-risking)

**Learning System:**
12. ✅ Attribution engine (know what works)

### Timeline to Production

**Weeks 1-2:** Critical blockers (pool state, infra classification, stabilization, distribution)  
**Week 3:** Edge preservers (regime, decay) + capital management (stress, correlation, sizing)  
**Week 4:** Execution + safety + attribution  
**Weeks 5-10:** Testing (replay → paper → micro-size live)  

### Cost if Skipped

**Without critical fixes:** False signals, bad entries, losses  
**Without edge preservation:** Slow PnL bleed as edge decays  
**Without capital management:** Drawdown compounding, silent ruin  
**Without attribution:** Can't improve, system drifts  

### Final Verdict

This is **not**:
- Fast
- Flashy
- Bottom-catching
- High frequency

This **is**:
- Structurally sound
- Edge-preserving
- Capital-aware
- Production-realistic
- Self-improving

**This is how second-order crypto strategies survive.**


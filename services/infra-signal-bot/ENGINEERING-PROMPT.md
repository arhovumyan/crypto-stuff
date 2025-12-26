# Engineering Prompt: Infra-Wallet Confirmation Trading – Simulation / Sandbox System

## Objective

Build a full sandbox simulation system that replays real on-chain market behavior and simulates how our infra-wallet confirmation trading strategy would have performed **without risking real capital**.

**This system must not place real trades.**  
It must simulate execution, slippage, fills, and exits, and produce detailed, auditable reports.

---

## Core Requirements

### 1. Simulation-Only (Hard Constraint)

❌ **No real transactions**  
❌ **No wallet signing**  
❌ **No RPC submission**  
❌ **No Jupiter execution**

**All "trades" must be virtual.**

**Enforcement:**
- Code review must verify no `sendTransaction` calls
- No `Keypair` usage for signing
- No connection to Jupiter API for real swaps
- All execution must be simulated in-memory

---

### 2. Data Ingestion (Real Market Data)

#### Sources

**Historical on-chain data:**
- Swaps
- Liquidity changes
- Pool reserve states

**DEX programs:**
- PumpSwap: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- PumpFun: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- Raydium AMM: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`

#### Requirements

- **Ability to replay historical blocks or slots**
- **Deterministic order of events** (by slot, then by transaction index)
- **Configurable replay speed:**
  - `1×` (real-time)
  - `N×` (accelerated, e.g., 10×, 100×)
  - `max` (as fast as possible)

#### Data Format

```typescript
interface HistoricalSwapEvent {
  slot: number;
  signature: string;
  blockTime: number;
  programId: string;
  poolAddress: string;
  tokenMint: string;
  baseMint: string; // SOL or USDC
  trader: string;
  side: 'buy' | 'sell';
  amountIn: number;
  amountOut: number;
  amountInSOL: number;
  amountOutSOL: number;
  
  // Pool state at this slot (CRITICAL - from on-chain)
  poolState: {
    slot: number;
    reserveSOL: number;
    reserveToken: number;
    priceSOL: number; // Computed from reserves
    liquidityUSD?: number;
  };
}
```

**Storage:**
- JSONL format (one event per line)
- Database table for querying
- Indexed by slot, token, trader

---

### 3. Strategy Logic (Same as Live System)

**⚠️ CRITICAL: No shortcuts**

The simulator must run the **exact same logic** as the live system:

- ✅ Large sell detection (1–3% of pool liquidity)
- ✅ Infra wallet absorption detection
- ✅ Stabilization gate (all 5 conditions)
- ✅ No-trade regime detector
- ✅ Confidence decay
- ✅ Distribution detection
- ✅ Capital governor rules

**Implementation:**
- Reuse existing modules: `SellDetector`, `AbsorptionDetector`, `StabilizationChecker`, `EntryManager`, `PositionMonitor`
- Do NOT duplicate logic
- Inject historical events instead of WebSocket feed
- All timing windows must be slot-based (not wall-clock)

**Verification:**
- Same code paths as production
- Same configuration options
- Same signal scoring logic
- Same entry/exit conditions

---

### 4. Virtual Execution Engine

#### Simulated Execution Must Model:

**Entry price:**
- Based on pool reserves at entry slot
- Fetch from historical pool state snapshot
- Compute using constant-product formula if needed

**Slippage:**
- Proportional to:
  - Pool depth (reserve size)
  - Simulated order size
- Formula: `slippage = f(orderSize, poolDepth)`
- Configurable slippage model:
  - Constant bps (e.g., 50 bps)
  - Reserves-based (constant-product)
  - None (for idealized mode)

**Failed fills:**
- If price moves beyond slippage cap during latency window
- If pool state changes significantly
- If route fails (configurable probability)

**Partial fills:**
- Optional but preferred
- Configurable partial fill ratio (e.g., 50%)
- Configurable partial fill probability

**Latency model:**
- Configurable delay between signal → execution
- Default: 2 slots (~3 seconds)
- Model as: `executionSlot = signalSlot + latencySlots`

#### Execution Modes

**1. Idealized Mode:**
- Zero latency
- Perfect fills (no slippage)
- No failures
- Use for: Strategy validation, signal quality testing

**2. Realistic Mode:**
- Latency: 2 slots
- Slippage: Reserves-based or constant bps
- Failure probability: 5% quote stale, 2% route fail
- Use for: Production-like simulation

**3. Stress Mode:**
- High latency: 5+ slots
- High slippage: 100+ bps
- High failure rate: 10%+ failures
- Use for: Worst-case scenario testing

#### Implementation

```typescript
interface ExecutionConfig {
  mode: 'idealized' | 'realistic' | 'stress';
  latencySlots: number;
  slippageModel: 'constant' | 'reserves' | 'none';
  slippageBps: number;
  quoteStaleProbability: number;
  routeFailProbability: number;
  partialFillProbability: number;
  partialFillRatio: number;
  lpFeeBps: number;
  priorityFeeSOL: number;
}

interface FillResult {
  success: boolean;
  fillPrice: number; // SOL per token
  slippageBps: number;
  feesSOL: number;
  latencySlots: number;
  failureReason?: 'quote_stale' | 'route_fail' | 'slippage_exceeded' | 'partial_fill';
  partialFillRatio?: number;
  executedAmountSOL?: number; // May be less than requested if partial
}
```

---

### 5. Capital Simulation

#### Requirements

**Virtual portfolio:**
- Starting capital (configurable, e.g., 10 SOL)
- Max position size (configurable, e.g., 1 SOL per trade)
- Max concurrent positions (configurable, e.g., 3)
- Risk per trade enforced (1–2% of capital)

**Capital management:**
- Capital reduction during drawdowns (capital governor)
- No-trade cooldowns honored
- Position sizing adapts to regime quality
- Loss-streak throttling

**Tracking:**
- Current capital balance
- Unrealized PnL
- Realized PnL
- Drawdown from peak
- Daily/weekly PnL

#### Implementation

```typescript
interface VirtualPortfolio {
  startingCapitalSOL: number;
  currentCapitalSOL: number;
  peakCapitalSOL: number;
  realizedPnLSOL: number;
  unrealizedPnLSOL: number;
  maxDrawdownSOL: number;
  maxDrawdownPct: number;
  openPositions: VirtualPosition[];
  closedPositions: VirtualPosition[];
  dailyPnL: Map<string, number>; // date -> PnL
  weeklyPnL: Map<string, number>; // week -> PnL
}

interface VirtualPosition {
  positionId: string;
  tokenMint: string;
  entrySlot: number;
  entryPrice: number; // SOL per token
  entryAmountSOL: number;
  entryAmountTokens: number;
  exitSlot?: number;
  exitPrice?: number;
  exitReason?: string;
  pnlSOL?: number;
  pnlPct?: number;
  mae?: number;
  mfe?: number;
  holdingTimeSlots?: number;
}
```

---

### 6. What the Simulator Must Track (Per Trade)

For every simulated trade, log:

#### Trade Identification
- Token mint
- Pool address
- Trade ID (unique)

#### Entry Context
- Infra wallets involved (addresses)
- Absorption event details:
  - Sell event signature
  - Absorption amount
  - Absorption ratio
  - Response time (slots)
- Stabilization metrics:
  - Higher lows count
  - Volatility decay
  - Defended level
  - Stabilization score (0-30)
- Entry time (slot + timestamp)
- Entry price (SOL per token)
- Entry amount (SOL)
- Signal strength (0-100)
- Regime state at entry ('healthy' | 'mild_chop' | 'hostile')

#### Exit Context
- Exit time (slot + timestamp)
- Exit price (SOL per token)
- Exit reason:
  - `distribution_detected` (infra wallets selling)
  - `stop_loss` (price broke stop)
  - `take_profit` (price hit target)
  - `time_stop` (no progress after N minutes)
  - `defense_break` (defended level broken)
  - `manual` (simulation ended)
- Exit amount (SOL)

#### Performance Metrics
- PnL (absolute SOL)
- PnL (%)
- MAE (Maximum Adverse Excursion) - worst drawdown during hold
- MFE (Maximum Favorable Excursion) - best profit during hold
- MAE % (as percentage)
- MFE % (as percentage)
- Holding duration (slots + milliseconds)

#### Execution Metrics
- Entry slippage (bps)
- Exit slippage (bps)
- Entry fees (SOL)
- Exit fees (SOL)
- Total fees (SOL)
- Net PnL (after fees)

#### Data Structure

```typescript
interface SimulatedTrade {
  // Identification
  tradeId: string;
  tokenMint: string;
  poolAddress: string;
  
  // Entry
  entrySlot: number;
  entryTime: Date;
  entryPrice: number;
  entryAmountSOL: number;
  entryAmountTokens: number;
  entrySlippageBps: number;
  entryFeesSOL: number;
  
  // Context
  infraWallets: string[];
  absorptionEvent: {
    sellSignature: string;
    absorptionAmountSOL: number;
    absorptionRatio: number;
    responseTimeSlots: number;
  };
  stabilizationMetrics: {
    higherLowsCount: number;
    volatilityDecay: number;
    defendedLevel: number;
    stabilizationScore: number;
  };
  signalStrength: number;
  regimeState: string;
  
  // Exit
  exitSlot?: number;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  exitSlippageBps?: number;
  exitFeesSOL?: number;
  
  // Performance
  pnlSOL: number;
  pnlPct: number;
  netPnLSOL: number; // After fees
  mae: number;
  mfe: number;
  maePct: number;
  mfePct: number;
  holdingTimeSlots: number;
  holdingTimeMs: number;
  
  // Execution
  totalFeesSOL: number;
  fillSuccess: boolean;
  fillFailureReason?: string;
}
```

---

### 7. Wallet & Infra Analytics Output

The system must produce analytics on:

#### Infra Wallet Discovery
- Wallets discovered during simulation
- Discovery method (manual pre-seed, automatic absorption)
- Discovery time (slot + timestamp)

#### Wallet Confidence Over Time
- Confidence score at each absorption event
- Confidence decay events
- Confidence growth events
- Final confidence score

#### Absorption Frequency
- Total absorptions per wallet
- Absorptions per token
- Average time between absorptions
- Absorption frequency trends

#### Defense Success Rate
- Number of defenses attempted
- Number of successful defenses (price held)
- Number of failed defenses (price broke)
- Success rate percentage

#### Confidence Decay Events
- When confidence decreased
- Reason for decay (inactivity, poor performance, etc.)
- Decay amount

#### Wallet Deprecation/Removal
- Wallets that were blacklisted
- Reason for blacklisting
- Time of blacklisting

#### Output Format

```typescript
interface WalletAnalytics {
  address: string;
  behaviorType: 'defensive' | 'cyclical' | 'aggressive' | 'passive' | 'unknown';
  
  // Discovery
  discoveredAt: Date;
  discoveryMethod: 'manual' | 'automatic';
  
  // Activity
  totalAbsorptions: number;
  totalDefenses: number;
  successfulDefenses: number;
  defenseSuccessRate: number;
  averageResponseTimeSlots: number;
  
  // Confidence
  initialConfidence: number;
  finalConfidence: number;
  confidenceHistory: Array<{
    slot: number;
    confidence: number;
    reason: string;
  }>;
  confidenceDecayEvents: number;
  
  // Performance
  tradesInvolved: number;
  totalPnLContribution: number; // Sum of PnL from trades involving this wallet
  averagePnLPerTrade: number;
  winRate: number; // % of trades that were profitable
  
  // Status
  isBlacklisted: boolean;
  blacklistedAt?: Date;
  blacklistReason?: string;
}
```

---

### 8. Reporting & Visualization (Mandatory)

#### Generate Reports

**1. Per-Day Summary:**
- Date
- Trades taken
- Wins / losses
- Win rate
- Total PnL
- Net PnL (after fees)
- Max drawdown
- Time in market

**2. Per-Token Performance:**
- Token mint
- Number of trades
- Win rate
- Total PnL
- Average holding time
- Best trade
- Worst trade

**3. Per-Infra-Wallet Contribution:**
- Wallet address
- Trades involved
- Total PnL contribution
- Average PnL per trade
- Win rate
- Defense success rate

**4. Regime Performance Comparison:**
- Healthy regime: trades, win rate, PnL
- Mild chop: trades, win rate, PnL
- Hostile regime: trades, win rate, PnL
- No-trade periods: duration, prevented trades

**5. Equity Curve:**
- Capital over time
- Peak capital
- Drawdown periods
- Trade markers (entry/exit points)

**6. Drawdown Chart:**
- Drawdown % over time
- Max drawdown period
- Recovery periods

#### Required Metrics

- **Win rate:** `wins / total_trades`
- **Avg win / avg loss:** `average_winning_trade / average_losing_trade`
- **Expectancy:** `(win_rate * avg_win) - (loss_rate * avg_loss)`
- **Sharpe-like ratio:** `(total_return / std_dev_of_returns) * sqrt(252)` (approximate)
- **Max drawdown:** Maximum peak-to-trough decline
- **Time in market:** Total time holding positions
- **Signal hit rate:** `profitable_signals / total_signals`
- **False positive rate:** `losing_signals / total_signals`

#### Reports Must Be:

- **Exportable:** CSV, JSON formats
- **Reproducible:** Same inputs = same outputs
- **Deterministic:** No randomness in reporting
- **Human-readable:** Markdown/HTML reports
- **Machine-readable:** JSON/CSV for analysis

#### Report Structure

```typescript
interface SimulationReport {
  // Metadata
  runId: string;
  datasetPath: string;
  datasetHash: string;
  configHash: string;
  startTime: Date;
  endTime: Date;
  durationDays: number;
  
  // Summary
  summary: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnLSOL: number;
    netPnLSOL: number; // After fees
    totalFeesSOL: number;
    maxDrawdownSOL: number;
    maxDrawdownPct: number;
    avgHoldingTimeMs: number;
    expectancy: number;
    sharpeRatio: number;
  };
  
  // Detailed data
  trades: SimulatedTrade[];
  walletAnalytics: WalletAnalytics[];
  dailySummary: DailySummary[];
  tokenPerformance: TokenPerformance[];
  regimePerformance: RegimePerformance;
  
  // Charts data (for visualization)
  equityCurve: Array<{ time: Date; capital: number }>;
  drawdownCurve: Array<{ time: Date; drawdown: number }>;
}
```

---

### 9. Scenario Testing (Key Feature)

The sandbox must support:

#### Turning Modules ON/OFF

**Stabilization gate:**
- `--disable-stabilization` - Skip stabilization checks
- Use for: Testing signal quality without stabilization filter

**Regime filter:**
- `--disable-regime-filter` - Allow trading in hostile conditions
- Use for: Comparing performance with/without regime awareness

**Confidence decay:**
- `--disable-confidence-decay` - Keep confidence scores static
- Use for: Testing impact of confidence decay

**Distribution detection:**
- `--disable-distribution-detection` - Don't exit on distribution
- Use for: Testing impact of distribution exits

**Capital governor:**
- `--disable-capital-governor` - No position size reduction
- Use for: Testing impact of risk management

#### Parameter Sweeps

**Sell % thresholds:**
- `--min-sell-pct <value>` - Minimum sell size (default: 1%)
- `--max-sell-pct <value>` - Maximum sell size (default: 3%)
- Use for: Finding optimal sell detection thresholds

**Absorption % thresholds:**
- `--min-absorption-ratio <value>` - Minimum absorption (default: 0.5)
- Use for: Testing different absorption requirements

**Time windows:**
- `--absorption-window-slots <value>` - Absorption window (default: 20)
- `--stabilization-window-slots <value>` - Stabilization window (default: 200)
- Use for: Optimizing timing windows

**Signal strength:**
- `--min-signal-strength <value>` - Minimum signal to enter (default: 60)
- Use for: Testing different entry thresholds

#### Comparative Runs

**"With infra logic" vs "Without":**
- Run 1: Full strategy (infra detection, absorption, stabilization)
- Run 2: No infra logic (just large sell → entry)
- Compare: Performance difference

**"Strict" vs "Loose" filters:**
- Run 1: Strict (high thresholds, tight windows)
- Run 2: Loose (low thresholds, wide windows)
- Compare: Trade count, win rate, PnL

**"Idealized" vs "Realistic" execution:**
- Run 1: Idealized (no slippage, no latency)
- Run 2: Realistic (slippage, latency, failures)
- Compare: Execution impact on performance

#### Implementation

```typescript
interface ScenarioConfig {
  // Module toggles
  enableStabilization: boolean;
  enableRegimeFilter: boolean;
  enableConfidenceDecay: boolean;
  enableDistributionDetection: boolean;
  enableCapitalGovernor: boolean;
  
  // Parameter overrides
  minSellPct?: number;
  maxSellPct?: number;
  minAbsorptionRatio?: number;
  absorptionWindowSlots?: number;
  stabilizationWindowSlots?: number;
  minSignalStrength?: number;
  
  // Execution mode
  executionMode: 'idealized' | 'realistic' | 'stress';
}
```

---

### 10. Acceptance Criteria (Definition of Done)

The simulator is complete when:

#### Functional Requirements

✅ **A full historical period (≥7 days) can be replayed**
- Successfully processes 7+ days of swap events
- No crashes or data corruption
- All events processed in order

✅ **Results are deterministic**
- Same dataset + same config = identical outputs
- Run hash: `sha256(dataset_hash + config_hash)`
- No external API calls during replay
- Seeded RNG for any randomness

✅ **Reports clearly show:**
- When trades were taken (slot + timestamp)
- Why they were taken (entry reasons, signals)
- Why they exited (exit reasons)
- All performance metrics (PnL, MAE/MFE, etc.)

✅ **Strategy behavior can be inspected without charts**
- All data in CSV/JSON format
- Human-readable markdown reports
- Queryable database tables

✅ **The team can answer:**
- "What would have happened if we traded this strategy live?"
- "Which infra wallets added value?"
- "What was the max drawdown?"
- "How many false positive signals were there?"

#### Quality Requirements

✅ **Code quality:**
- No real transaction code paths
- All execution is simulated
- Comprehensive error handling
- Logging for debugging

✅ **Performance:**
- Can replay 7 days in < 1 hour (on reasonable hardware)
- Memory usage is reasonable
- No memory leaks

✅ **Documentation:**
- Clear setup instructions
- Example simulation runs
- Interpretation guide for results
- Known limitations documented

---

### 11. Deliverables

#### Code Deliverables

1. **Simulation Engine**
   - Core replay logic
   - Event injection system
   - Slot-based timing

2. **Configurable Replay Runner**
   - CLI interface
   - Configuration file support
   - Scenario testing support

3. **Strategy Logic Integration**
   - Reuse existing modules
   - Event injection adapters
   - No code duplication

4. **Virtual Execution Engine**
   - Fill simulation
   - Slippage models
   - Latency modeling
   - Failure modeling

5. **Reporting Module**
   - Report generation
   - CSV/JSON export
   - Markdown reports
   - Chart data generation

#### Documentation Deliverables

1. **Example Simulation Runs**
   - 3-7 day replay examples
   - Different scenario configurations
   - Sample reports

2. **Documentation Explaining:**
   - **Assumptions:**
     - Pool state snapshots are accurate
     - Historical data is complete
     - No missing events
   - **Limitations:**
     - Cannot simulate MEV (sandwich attacks)
     - Cannot simulate network congestion
     - Assumes fills are possible (may not be in reality)
   - **Interpretation of Results:**
     - How to read reports
     - What metrics matter
     - How to compare scenarios
     - When to trust results vs. be skeptical

#### Example Deliverables

1. **Sample Run Output:**
   ```
   Run ID: abc123...
   Dataset: swaps_2025-12-26.jsonl
   Duration: 7 days
   Config: realistic_execution.json
   
   Results:
   - Total Trades: 42
   - Win Rate: 57.1%
   - Total PnL: +2.34 SOL
   - Net PnL: +2.12 SOL (after fees)
   - Max Drawdown: -0.45 SOL (-4.5%)
   ```

2. **Sample Report Files:**
   - `run_summary.json`
   - `trades.csv`
   - `wallet_performance.csv`
   - `report.md`

---

## Guiding Principle (Must Be Followed)

> **If we cannot explain exactly why a simulated trade made or lost money, the simulator has failed.**

Every trade must have:
- Clear entry reason (which signals fired)
- Clear exit reason (why we exited)
- Traceable path from signal → entry → exit
- All context logged (infra wallets, regime, stabilization, etc.)

**No black boxes. No unexplained results.**

---

## Implementation Phases

### Phase 1: Data Ingestion + Basic Replay (Week 1)
- Build swap recorder
- Implement on-chain pool state reading
- Create replay engine (basic)
- Test with 1 day of data

### Phase 2: Strategy Integration (Week 2)
- Integrate existing strategy modules
- Implement slot-based timing
- Test signal generation
- Verify deterministic results

### Phase 3: Virtual Execution (Week 2-3)
- Build fill simulator
- Implement slippage models
- Add latency modeling
- Test execution modes

### Phase 4: Capital Simulation + Tracking (Week 3)
- Build virtual portfolio
- Implement capital management
- Add per-trade tracking
- Test capital governor

### Phase 5: Reporting + Analytics (Week 3-4)
- Build reporting module
- Generate all required reports
- Add wallet analytics
- Create visualization data

### Phase 6: Scenario Testing (Week 4)
- Implement module toggles
- Add parameter sweeps
- Build comparative run system
- Test all scenarios

### Phase 7: Validation + Documentation (Week 4-5)
- Run full 7-day replay
- Validate all metrics
- Write documentation
- Create example runs

---

## Success Metrics

After building the simulator, we must be able to answer:

1. **Strategy Performance:**
   - What's the win rate?
   - What's the expectancy?
   - What's the max drawdown?
   - Is the strategy profitable?

2. **Signal Quality:**
   - What's the signal hit rate?
   - What's the false positive rate?
   - Which signals are most reliable?

3. **Wallet Performance:**
   - Which infra wallets add value?
   - Which are false positives?
   - What's the confidence decay rate?

4. **Risk Metrics:**
   - What's the average MAE/MFE?
   - How long do we hold positions?
   - What's the capital efficiency?

5. **Regime Effectiveness:**
   - Does the regime filter prevent losses?
   - How many trades were prevented?
   - What's the impact of no-trade periods?

6. **Execution Impact:**
   - How much slippage do we pay?
   - How many fills fail?
   - What's the latency impact?

---

## Out of Scope (For Now)

- Real-time streaming during replay
- Web UI (CLI + reports is sufficient)
- ML models or predictive features
- Multi-threaded replay (single-threaded is fine)
- Live trading integration (simulation only)

---

## Questions to Answer Before Starting

1. **Data Source:**
   - Where will historical swap data come from?
   - How will we fetch pool state snapshots?
   - What's the data format?

2. **Performance:**
   - How fast does replay need to be?
   - What's acceptable memory usage?
   - How much disk space for datasets?

3. **Reporting:**
   - What format for reports? (Markdown, HTML, PDF?)
   - Do we need interactive charts? (Or static images?)
   - What's the priority order for metrics?

4. **Testing:**
   - What's the minimum viable dataset size?
   - How do we validate correctness?
   - What's the acceptance criteria for "working"?

---

**Last Updated:** December 26, 2025


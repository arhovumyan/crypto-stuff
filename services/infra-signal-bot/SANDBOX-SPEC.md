# Replay Sandbox + Reporting System Specification

## Executive Summary

**Goal:** Build a deterministic replay system that simulates trading with $0 using real on-chain swaps, producing detailed PnL + attribution reports.

**Why:** Before implementing the critical gaps (on-chain pool state, multi-event validation, strict stabilization, etc.), we need to validate that our rules make money in hostile conditions without overtrading. The current "live feed + paper mode" is not sufficient—we need historical replay to measure hit-rate, MAE/MFE, drawdown, and false-positive wallet discoveries.

**Status:** This is the next critical step after wallet discovery. We have 6 pre-seeded infra wallets and the bot is running. Now we need to prove the strategy works before going live.

**📋 Engineering Prompt:** See `ENGINEERING-PROMPT.md` for the complete, copy-paste ready engineering requirements document.

---

## Current State

### ✅ What We Have
- Real-time DEX streaming/parsing (Helius WebSocket)
- Sell/absorption detection (basic)
- Basic stabilization checking
- Scoring/entry gating
- Position monitor + paper trading
- Infra wallet persistence + pre-seeding
- 6 pre-seeded infra wallets loaded

### ❌ What's Missing (Documented in UPGRADE-SPEC.md)
- On-chain pool state reader (using DexScreener - stale)
- Multi-event infra validation (one absorption ≠ infra)
- Strict stabilization gate (current too loose)
- Real distribution detection + infra disappearance logic
- Execution policy / safety checks / regime filter / confidence decay / capital stress governor / attribution

### 🎯 What We Need Now
**Replay-driven paper trading** to validate strategy before implementing the missing pieces.

---

## System Architecture

```
┌─────────────────┐
│  Swap Recorder  │ → Records real swaps to dataset
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Replay Engine  │ → Feeds events back into detectors
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Fill Simulator  │ → Simulates execution with realism
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Attribution +   │ → Generates reports
│ Reporting       │
└─────────────────┘
```

---

## Component Specifications

### A) Swap Recorder

**Goal:** Create a clean event log of real swaps that can be replayed deterministically.

#### Requirements

1. **Subscribe to same DEX programs** we already parse:
   - PumpSwap: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
   - PumpFun: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
   - Raydium AMM: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`

2. **Record NormalizedSwapEvent** for each swap:
   ```typescript
   interface NormalizedSwapEvent {
     // Transaction metadata
     slot: number;
     signature: string;
     blockTime: number;
     programId: string;
     
     // Pool & token info
     poolAddress: string;
     tokenMint: string;
     baseMint: string; // SOL or USDC
     
     // Trade details
     trader: string;
     side: 'buy' | 'sell';
     amountIn: number;  // In base units (SOL/USDC)
     amountOut: number; // In token units
     amountInSOL: number; // Normalized to SOL
     amountOutSOL: number; // Normalized to SOL
     
     // Pool state snapshot (CRITICAL - from on-chain, not API)
     poolState: {
       slot: number;
       reserveSOL: number;
       reserveToken: number;
       priceSOL: number; // Computed from reserves
       liquidityUSD?: number; // Optional, for reporting
     };
   }
   ```

3. **Pool State Snapshot Logic:**
   - **MUST** read pool reserves from on-chain at/near the swap slot
   - **MUST NOT** use DexScreener or any external API for liquidity
   - Fetch pool account data using RPC `getAccountInfo` at the slot
   - Parse pool state according to DEX program format:
     - Raydium: Parse AMM pool account structure
     - PumpFun: Parse bonding curve state
     - PumpSwap: Parse pool reserves
   - Compute `priceSOL = reserveSOL / reserveToken`
   - Compute `liquidityUSD` (optional, for reporting only)

4. **Storage Format:**
   - **Primary:** JSONL (JSON Lines) - one event per line, append-only
   - **Optional:** Parquet for efficient querying
   - **Database:** Store in `swap_events` table for querying
   - **File naming:** `swaps_YYYY-MM-DD.jsonl` or `swaps_YYYY-MM-DD_HH-MM-SS.jsonl`

5. **Recording Duration:**
   - Minimum: 1 day
   - Recommended: 3-7 days
   - Should capture various market conditions (volatile, choppy, trending)

6. **Data Quality:**
   - Skip events with missing pool state (can't read reserves)
   - Skip events with invalid amounts
   - Log skipped events for debugging
   - Maintain event order (by slot, then by transaction index)

#### Implementation Notes

```typescript
// Example: Recording a swap event
async function recordSwapEvent(
  trade: RawTrade,
  poolState: PoolStateSnapshot
): Promise<void> {
  const event: NormalizedSwapEvent = {
    slot: trade.slot,
    signature: trade.signature,
    blockTime: trade.blockTime,
    programId: trade.programId,
    poolAddress: poolState.poolAddress,
    tokenMint: trade.tokenMint,
    baseMint: 'So11111111111111111111111111111111111111112', // SOL
    trader: trade.traderWallet,
    side: trade.type,
    amountIn: trade.amountIn,
    amountOut: trade.amountOut,
    amountInSOL: trade.amountSOL,
    amountOutSOL: trade.amountOut * poolState.priceSOL,
    poolState: {
      slot: poolState.slot,
      reserveSOL: poolState.reserveSOL,
      reserveToken: poolState.reserveToken,
      priceSOL: poolState.priceSOL,
      liquidityUSD: poolState.liquidityUSD,
    },
  };
  
  // Write to JSONL
  await appendToJSONL('swaps_2025-12-26.jsonl', event);
  
  // Store in database
  await db.query(
    `INSERT INTO swap_events (...) VALUES (...)`,
    [event.slot, event.signature, ...]
  );
}
```

#### Database Schema

```sql
CREATE TABLE IF NOT EXISTS swap_events (
  id SERIAL PRIMARY KEY,
  slot BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  block_time TIMESTAMPTZ NOT NULL,
  program_id TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  base_mint TEXT NOT NULL,
  trader TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  amount_in NUMERIC NOT NULL,
  amount_out NUMERIC NOT NULL,
  amount_in_sol NUMERIC NOT NULL,
  amount_out_sol NUMERIC NOT NULL,
  -- Pool state
  pool_reserve_sol NUMERIC NOT NULL,
  pool_reserve_token NUMERIC NOT NULL,
  pool_price_sol NUMERIC NOT NULL,
  pool_liquidity_usd NUMERIC,
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_slot (slot),
  INDEX idx_token_mint (token_mint),
  INDEX idx_trader (trader),
  INDEX idx_block_time (block_time)
);
```

---

### B) Replay Engine

**Goal:** Feed recorded events back into existing detectors/scorer as if they're live.

#### Requirements

1. **CLI Interface:**
   ```bash
   npm run replay -- \
     --input <dataset.jsonl> \
     --speed <1|10|max> \
     --start <slot|timestamp> \
     --end <slot|timestamp> \
     --config <config.json>
   ```

2. **Replay Logic:**
   - Read events from JSONL file in order (by slot, then by index)
   - Re-emit events into existing pipeline:
     - `TradeFeed` → `SellDetector` → `AbsorptionDetector` → `StabilizationChecker` → `EntryManager` → `PositionMonitor`
   - **DO NOT** change business logic - use existing components
   - **DO** inject events instead of WebSocket connection

3. **Timing Windows:**
   - **MUST** be slot-based, not wall-clock seconds
   - Current code uses `Date.now()` - needs to be converted to slot-based
   - Example: "30 second window" → "~20 slots" (Solana ~1.5s per slot)
   - Use slot deltas: `absorptionWindowSlots = 20` instead of `absorptionWindowMs = 30000`

4. **Replay Speed:**
   - `1x`: Real-time (respect slot timing)
   - `10x`: 10x faster (for quick iteration)
   - `max`: As fast as possible (for backtesting)

5. **Determinism:**
   - Same dataset + same config = identical results
   - No random number generation (use seeded RNG if needed)
   - No external API calls (all data from recorded events)
   - Generate run hash: `sha256(dataset_hash + config_hash)`

6. **Event Injection:**
   - Create `ReplayTradeFeed` that extends `TradeFeed`
   - Instead of WebSocket, read from JSONL and emit events
   - Maintain same event structure: `RawTrade` objects

#### Implementation Notes

```typescript
// ReplayTradeFeed.ts
export class ReplayTradeFeed extends EventEmitter {
  private events: NormalizedSwapEvent[];
  private currentIndex = 0;
  private speed: '1x' | '10x' | 'max';
  private startSlot: number;
  private endSlot: number;
  
  async loadDataset(filePath: string): Promise<void> {
    // Read JSONL file
    const lines = await readFile(filePath, 'utf-8');
    this.events = lines
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .filter(event => 
        event.slot >= this.startSlot && 
        event.slot <= this.endSlot
      )
      .sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature));
  }
  
  async start(): Promise<void> {
    for (const event of this.events) {
      // Convert to RawTrade format
      const trade: RawTrade = {
        signature: event.signature,
        slot: event.slot,
        blockTime: event.blockTime,
        programId: event.programId,
        tokenMint: event.tokenMint,
        traderWallet: event.trader,
        type: event.side,
        amountSOL: event.amountInSOL,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
      };
      
      // Emit as if from WebSocket
      this.emit('trade', trade);
      
      // Handle replay speed
      if (this.speed === '1x') {
        await this.waitForNextSlot(event);
      } else if (this.speed === '10x') {
        await new Promise(resolve => setTimeout(resolve, 150)); // 10x faster
      }
      // max: no delay
    }
  }
}
```

#### Slot-Based Timing Conversion

```typescript
// Convert existing timing windows to slot-based
const SLOTS_PER_SECOND = 0.67; // Solana ~1.5s per slot

interface SlotBasedConfig {
  absorptionWindowSlots: number; // Was: absorptionWindowMs
  stabilizationWindowSlots: number; // Was: stabilizationTimeframeMs
  minResponseSlots: number; // For infra classification
}

function convertToSlotBased(config: InfraSignalConfig): SlotBasedConfig {
  return {
    absorptionWindowSlots: Math.ceil(
      config.absorptionWindowMs / 1000 * SLOTS_PER_SECOND
    ),
    stabilizationWindowSlots: Math.ceil(
      config.stabilizationTimeframeMs / 1000 * SLOTS_PER_SECOND
    ),
    minResponseSlots: 20, // Configurable
  };
}
```

---

### C) Fill Simulator (Paper Execution with Realism)

**Goal:** When EntryManager says "enter", simulate fills with realistic execution friction.

#### Requirements

1. **Configurable Parameters:**
   ```typescript
   interface FillSimulatorConfig {
     // Latency
     latencySlots: number; // Default: 2 slots (~3 seconds)
     
     // Slippage
     slippageModel: 'constant' | 'reserves' | 'none';
     slippageBps: number; // For constant model (e.g., 50 bps = 0.5%)
     
     // Fees
     lpFeeBps: number; // Default: 30 bps (0.3%)
     priorityFeeSOL: number; // Default: 0.0001 SOL
     
     // Failure modeling
     quoteStaleProbability: number; // 0-1, default: 0.05 (5%)
     routeFailProbability: number; // 0-1, default: 0.02 (2%)
     partialFillProbability: number; // 0-1, default: 0.01 (1%)
     partialFillRatio: number; // 0-1, default: 0.5 (50% filled)
   }
   ```

2. **Fill Simulation Logic:**
   - When `EntryManager` triggers entry/exit:
     - Apply latency (delay by N slots)
     - Fetch pool state at `currentSlot + latencySlots`
     - Compute slippage using pool reserves
     - Apply fees
     - Check for failures (stale quote, route fail, partial fill)
     - Return executed fill price or failure reason

3. **Slippage Models:**
   - **Constant:** Fixed bps (e.g., 50 bps = 0.5%)
   - **Reserves:** Compute using constant-product formula:
     ```
     newPrice = (reserveSOL + amountSOL) / (reserveToken - amountToken)
     slippage = (newPrice - oldPrice) / oldPrice
     ```
   - **None:** No slippage (for testing)

4. **Output:**
   ```typescript
   interface FillResult {
     success: boolean;
     fillPrice: number; // SOL per token
     slippageBps: number;
     feesSOL: number;
     latencySlots: number;
     failureReason?: 'quote_stale' | 'route_fail' | 'partial_fill';
     partialFillRatio?: number;
   }
   ```

#### Implementation Notes

```typescript
// FillSimulator.ts
export class FillSimulator {
  async simulateFill(
    side: 'buy' | 'sell',
    amountSOL: number,
    tokenMint: string,
    currentSlot: number,
    config: FillSimulatorConfig
  ): Promise<FillResult> {
    // 1. Apply latency
    const executionSlot = currentSlot + config.latencySlots;
    
    // 2. Fetch pool state at execution slot (from recorded events)
    const poolState = await this.getPoolStateAtSlot(
      tokenMint,
      executionSlot
    );
    
    if (!poolState) {
      return {
        success: false,
        fillPrice: 0,
        slippageBps: 0,
        feesSOL: 0,
        latencySlots: config.latencySlots,
        failureReason: 'quote_stale',
      };
    }
    
    // 3. Compute slippage
    const slippageBps = this.computeSlippage(
      side,
      amountSOL,
      poolState,
      config
    );
    
    // 4. Apply fees
    const feesSOL = amountSOL * (config.lpFeeBps / 10000) + config.priorityFeeSOL;
    
    // 5. Check for failures
    if (Math.random() < config.quoteStaleProbability) {
      return { success: false, failureReason: 'quote_stale', ... };
    }
    if (Math.random() < config.routeFailProbability) {
      return { success: false, failureReason: 'route_fail', ... };
    }
    if (Math.random() < config.partialFillProbability) {
      return {
        success: true,
        partialFillRatio: config.partialFillRatio,
        fillPrice: poolState.priceSOL * (1 + slippageBps / 10000),
        slippageBps,
        feesSOL,
        latencySlots: config.latencySlots,
      };
    }
    
    // 6. Successful fill
    return {
      success: true,
      fillPrice: poolState.priceSOL * (1 + slippageBps / 10000),
      slippageBps,
      feesSOL,
      latencySlots: config.latencySlots,
    };
  }
  
  private computeSlippage(
    side: 'buy' | 'sell',
    amountSOL: number,
    poolState: PoolStateSnapshot,
    config: FillSimulatorConfig
  ): number {
    if (config.slippageModel === 'constant') {
      return config.slippageBps;
    }
    
    if (config.slippageModel === 'reserves') {
      // Constant-product formula
      const k = poolState.reserveSOL * poolState.reserveToken;
      const newReserveSOL = poolState.reserveSOL + amountSOL;
      const newReserveToken = k / newReserveSOL;
      const newPrice = newReserveSOL / newReserveToken;
      const oldPrice = poolState.priceSOL;
      return ((newPrice - oldPrice) / oldPrice) * 10000; // Convert to bps
    }
    
    return 0; // No slippage
  }
}
```

---

### D) Attribution + Reporting

**Goal:** Log detailed trade context and produce comprehensive reports.

#### Requirements

1. **Per-Trade Attribution:**
   ```typescript
   interface TradeAttribution {
     // Trade identification
     tradeId: string;
     tokenMint: string;
     entrySlot: number;
     exitSlot: number;
     entryTime: Date;
     exitTime: Date;
     
     // Entry context
     entryReason: {
       signals: string[]; // ['large_sell', 'absorption', 'stabilization']
       signalStrength: number; // 0-100
       infraWallets: string[]; // Addresses involved
       regimeState: 'healthy' | 'mild_chop' | 'hostile' | 'unknown';
       stabilizationScore: number; // 0-30
       defendedLevel: number; // SOL price
     };
     
     // Exit context
     exitReason: 'take_profit' | 'stop_loss' | 'distribution' | 'defense_break' | 'time_stop' | 'manual';
     exitPrice: number; // SOL per token
     
     // Performance metrics
     entryPrice: number; // SOL per token
     exitPrice: number; // SOL per token
     pnlSOL: number;
     pnlPct: number;
     holdingTimeSlots: number;
     holdingTimeMs: number;
     
     // Execution metrics
     entrySlippageBps: number;
     exitSlippageBps: number;
     entryFeesSOL: number;
     exitFeesSOL: number;
     totalFeesSOL: number;
     
     // Risk metrics
     mae: number; // Maximum Adverse Excursion (worst drawdown)
     mfe: number; // Maximum Favorable Excursion (best profit)
     maePct: number;
     mfePct: number;
   }
   ```

2. **Run Summary:**
   ```typescript
   interface RunSummary {
     // Run metadata
     runId: string;
     datasetHash: string;
     configHash: string;
     startTime: Date;
     endTime: Date;
     durationMs: number;
     
     // Market coverage
     totalEvents: number;
     totalSwaps: number;
     uniqueTokens: number;
     uniqueTraders: number;
     
     // Signal generation
     largeSellsDetected: number;
     absorptionsConfirmed: number;
     stabilizationConfirmed: number;
     signalsGenerated: number;
     
     // Trading activity
     entriesAttempted: number;
     entriesExecuted: number;
     entriesFailed: number;
     exitsExecuted: number;
     
     // Performance
     totalTrades: number;
     winningTrades: number;
     losingTrades: number;
     winRate: number;
     totalPnLSOL: number;
     totalPnLPct: number;
     totalFeesSOL: number;
     netPnLSOL: number; // After fees
     
     // Risk metrics
     maxDrawdown: number;
     maxDrawdownPct: number;
     avgHoldingTimeMs: number;
     avgMAE: number;
     avgMFE: number;
     
     // Wallet performance
     infraWalletsDiscovered: number;
     infraWalletsConfirmed: number;
     infraWalletsFalsePositives: number;
   }
   ```

3. **Output Artifacts:**
   - `run_summary.json` - Complete run summary
   - `trades.csv` - Per-trade details
   - `wallet_performance.csv` - Per-wallet analysis
   - `report.md` - Human-readable report

4. **Report Format (report.md):**
   ```markdown
   # Replay Run Report
   
   **Run ID:** abc123...
   **Dataset:** swaps_2025-12-26.jsonl
   **Duration:** 3 days
   **Config Hash:** def456...
   
   ## Summary
   - Total Trades: 42
   - Win Rate: 57.1% (24 wins, 18 losses)
   - Total PnL: +2.34 SOL (+23.4%)
   - Net PnL (after fees): +2.12 SOL (+21.2%)
   - Max Drawdown: -0.45 SOL (-4.5%)
   - Avg Holding Time: 12.3 minutes
   
   ## Signal Quality
   - Large Sells Detected: 156
   - Absorptions Confirmed: 89
   - Stabilization Confirmed: 67
   - Signals Generated: 45
   - Entry Success Rate: 93.3% (42/45)
   
   ## Top Performing Wallets
   1. eGkFSm9Y... - 8 trades, +0.67 SOL, 75% win rate
   2. Ar2Y6o1Q... - 6 trades, +0.45 SOL, 66.7% win rate
   
   ## Worst Performing Wallets
   1. 3nMFwZXw... - 3 trades, -0.23 SOL, 0% win rate (FALSE POSITIVE)
   
   ## Regime Analysis
   - Healthy Regime: 68% of time, 31 trades, +1.89 SOL
   - Mild Chop: 22% of time, 8 trades, +0.34 SOL
   - Hostile Regime: 10% of time, 3 trades, +0.11 SOL
   
   ## No-Trade Periods
   - 4 periods detected (total 2.3 hours)
   - Prevented 12 potential entries
   - Estimated savings: -0.67 SOL (avoided losses)
   ```

#### Implementation Notes

```typescript
// AttributionEngine.ts
export class AttributionEngine {
  private trades: TradeAttribution[] = [];
  
  logTrade(trade: TradeAttribution): void {
    this.trades.push(trade);
  }
  
  async generateReports(outputDir: string): Promise<void> {
    const summary = this.computeRunSummary();
    
    // Write run_summary.json
    await writeFile(
      `${outputDir}/run_summary.json`,
      JSON.stringify(summary, null, 2)
    );
    
    // Write trades.csv
    await this.writeTradesCSV(`${outputDir}/trades.csv`);
    
    // Write wallet_performance.csv
    await this.writeWalletPerformanceCSV(`${outputDir}/wallet_performance.csv`);
    
    // Write report.md
    await this.writeMarkdownReport(`${outputDir}/report.md`, summary);
  }
  
  private computeRunSummary(): RunSummary {
    // Aggregate all metrics from trades
    // ...
  }
}
```

---

## Database Schema Updates

### New Tables

```sql
-- Swap events (from recorder)
CREATE TABLE IF NOT EXISTS swap_events (
  id SERIAL PRIMARY KEY,
  slot BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  block_time TIMESTAMPTZ NOT NULL,
  program_id TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  base_mint TEXT NOT NULL,
  trader TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  amount_in NUMERIC NOT NULL,
  amount_out NUMERIC NOT NULL,
  amount_in_sol NUMERIC NOT NULL,
  amount_out_sol NUMERIC NOT NULL,
  pool_reserve_sol NUMERIC NOT NULL,
  pool_reserve_token NUMERIC NOT NULL,
  pool_price_sol NUMERIC NOT NULL,
  pool_liquidity_usd NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Replay runs
CREATE TABLE IF NOT EXISTS replay_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT UNIQUE NOT NULL,
  dataset_path TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade attributions (from replay)
CREATE TABLE IF NOT EXISTS trade_attributions (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES replay_runs(run_id),
  trade_id TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  entry_slot BIGINT NOT NULL,
  exit_slot BIGINT NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  entry_reason JSONB NOT NULL,
  exit_reason TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  pnl_sol NUMERIC NOT NULL,
  pnl_pct NUMERIC NOT NULL,
  holding_time_slots BIGINT NOT NULL,
  holding_time_ms BIGINT NOT NULL,
  entry_slippage_bps INTEGER NOT NULL,
  exit_slippage_bps INTEGER NOT NULL,
  entry_fees_sol NUMERIC NOT NULL,
  exit_fees_sol NUMERIC NOT NULL,
  total_fees_sol NUMERIC NOT NULL,
  mae NUMERIC NOT NULL,
  mfe NUMERIC NOT NULL,
  mae_pct NUMERIC NOT NULL,
  mfe_pct NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Acceptance Criteria

### Must-Have

1. **Deterministic Results:**
   - Same dataset + same config = identical outputs
   - Run hash: `sha256(dataset_hash + config_hash)`
   - No external API calls during replay
   - Seeded RNG for failure modeling

2. **End-to-End Replay:**
   - Can run without external price APIs
   - All data from recorded events
   - Existing detectors/scorers work unchanged

3. **Automatic Reporting:**
   - Reports generated at end of each run
   - All required metrics included
   - Human-readable + machine-readable formats

4. **Candidate vs Confirmed Separation:**
   - Candidate wallets never contribute full score
   - Only confirmed infra wallets in signal scoring
   - Clear distinction in reports

### Nice-to-Have

1. **Golden Test Fixtures:**
   - Saved known swap transactions per DEX
   - Assert decoding + reserve reads don't regress
   - Run as part of test suite

2. **Abort Switches Visualization:**
   - Show "no-trade" periods clearly in reports
   - Prove regime filter prevents churn
   - Highlight prevented entries

3. **Interactive Analysis:**
   - Jupyter notebook for deeper analysis
   - Plotting tools for visualization
   - Query interface for trade data

---

## Implementation Phases

### Phase 1: Swap Recorder (Week 1)
- [ ] Implement on-chain pool state reader
- [ ] Build JSONL writer
- [ ] Create database schema
- [ ] Record 1-3 days of swaps
- [ ] Validate data quality

### Phase 2: Replay Engine (Week 2)
- [ ] Build ReplayTradeFeed
- [ ] Convert timing windows to slot-based
- [ ] Implement CLI interface
- [ ] Test with small dataset
- [ ] Verify determinism

### Phase 3: Fill Simulator (Week 2-3)
- [ ] Implement fill simulation logic
- [ ] Add slippage models
- [ ] Integrate with EntryManager
- [ ] Test failure scenarios
- [ ] Validate against known fills

### Phase 4: Attribution + Reporting (Week 3)
- [ ] Build AttributionEngine
- [ ] Implement report generation
- [ ] Create CSV/Markdown outputs
- [ ] Add wallet performance analysis
- [ ] Generate first full report

### Phase 5: Testing + Validation (Week 4)
- [ ] Run full 7-day replay
- [ ] Validate all metrics
- [ ] Compare against live paper trading
- [ ] Document findings
- [ ] Iterate on parameters

---

## Out of Scope (For Now)

- Live trading / Jupiter execution
- Real-time streaming during replay
- ML models or predictive features
- Multi-threaded replay (single-threaded is fine)
- Web UI (CLI + reports is sufficient)

---

## Success Metrics

After building the sandbox, we should be able to answer:

1. **Signal Quality:**
   - What's the hit rate? (signals that lead to profitable trades)
   - What's the false positive rate? (signals that lose money)

2. **Wallet Performance:**
   - Which infra wallets add value?
   - Which are false positives?
   - What's the confidence decay rate?

3. **Risk Metrics:**
   - What's the max drawdown?
   - What's the average MAE/MFE?
   - How long do we hold positions?

4. **Regime Effectiveness:**
   - Does the regime filter prevent losses?
   - How many trades were prevented?
   - What's the impact of no-trade periods?

5. **Execution Impact:**
   - How much slippage do we pay?
   - How many fills fail?
   - What's the latency impact?

---

## Next Steps After Sandbox

Once the sandbox is built and validated:

1. **Implement Critical Gaps:**
   - On-chain pool state reader (already needed for recorder)
   - Multi-event infra validation
   - Strict stabilization gates
   - Distribution detection

2. **Extended Paper Trading:**
   - Run sandbox on 7+ days of data
   - Validate strategy across market conditions
   - Tune parameters based on results

3. **Micro-Size Live Trading:**
   - Only after sandbox + extended paper pass
   - 1 position max, tiny SOL per trade
   - Daily performance reports

---

**Last Updated:** December 26, 2025


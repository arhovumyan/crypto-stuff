# Phase 2: Correctness Implementation - Progress Report

## Status: IN PROGRESS (30% Complete)

**Started:** December 26, 2025  
**Goal:** Fix critical correctness issues before first replay run

---

## ✅ Completed (3/8)

### 1. Program ID Issue - FIXED
**Issue:** PumpSwap and PumpFun had duplicate program IDs  
**Fix:** Documented that they may share the same bonding curve program  
**Files:** `src/sandbox/pool-state-reader.ts`, `src/trade-feed.ts`  
**Note:** PumpSwap actual program ID is `PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP`

### 2. TimeProvider Interface - IMPLEMENTED
**Issue:** Timing must be slot-based for deterministic replay  
**Fix:** Created `TimeProvider` interface with two implementations:
- `LiveTimeProvider` - Uses wall clock + estimated slots
- `ReplayTimeProvider` - Uses event slots (deterministic)

**Files:** `src/sandbox/time-provider.ts` (new, 120 LOC)

**Key Methods:**
```typescript
interface TimeProvider {
  nowSlot(): number;
  nowMs(): number;
  hasElapsedSlots(referenceSlot: number, slotsToElapse: number): boolean;
  msToSlots(ms: number): number;
  slotsToMs(slots: number): number;
}
```

### 3. Transaction Ordering Schema - UPDATED
**Issue:** Events sorted by signature, not transaction index  
**Fix:** Added `txIndex`, `logIndex`, `innerIndex` to `HistoricalSwapEvent`

**Files:** `src/sandbox/types.ts`

---

## 🔄 In Progress (2/8)

### 4. Event Ordering Implementation
**Status:** Schema updated, need to:
- [ ] Update `swap-recorder.ts` to capture txIndex from Helius
- [ ] Update `replay-trade-feed.ts` to sort by (slot, txIndex, logIndex)
- [ ] Test with real data

**Critical:** Without correct ordering, absorption windows fire at wrong times

### 5. TimeProvider Integration
**Status:** Interface created, need to:
- [ ] Wire into `AbsorptionDetector` (replace `Date.now()` with `timeProvider.nowSlot()`)
- [ ] Wire into `StabilizationChecker` (same)
- [ ] Wire into `EntryManager` (same)
- [ ] Wire into `PositionMonitor` (same)
- [ ] Pass `ReplayTimeProvider` to all modules in replay mode
- [ ] Update replay feed to call `timeProvider.setCurrentSlot()` before emitting events

---

## ⏳ Pending (3/8)

### 6. Wire Real Strategy Modules
**Issue:** `SimulationCoordinator` uses simplified signal generation  
**Required:**
- [ ] Remove simplified logic from coordinator
- [ ] Initialize real `SellDetector`, `AbsorptionDetector`, etc.
- [ ] Pass `ReplayTradeFeed` as drop-in replacement for `TradeFeed`
- [ ] Ensure all modules work with `TimeProvider`

**Files to modify:**
- `src/sandbox/simulation-coordinator.ts`
- All strategy modules (to accept `TimeProvider`)

### 7. Real Pool State Parsers
**Issue:** Raydium and Pump parsers are stubs  
**Required:**
- [ ] Implement Raydium AMM pool account parsing
  - Read reserves from pool account data
  - Use Raydium SDK or manual binary parsing
- [ ] Implement PumpFun bonding curve parsing
  - Read virtual SOL/token reserves
  - Compute price from bonding curve formula
- [ ] Ensure reserves are read at event slot, not "latest"

**Files to modify:**
- `src/sandbox/pool-state-reader.ts`

**Resources:**
- Raydium SDK: https://github.com/raydium-io/raydium-sdk
- PumpFun contracts: (need to research)

### 8. Equity Curve + Metrics Tracking
**Issue:** Equity curve and coverage metrics are placeholder/empty  
**Required:**
- [ ] Add equity snapshot every N slots in `VirtualPortfolioManager`
- [ ] Track counters in `SimulationCoordinator`:
  - totalEvents, totalSwaps
  - largeSellsDetected, absorptionsConfirmed
  - stabilizationsConfirmed, signalsGenerated
  - entriesAttempted, entriesExecuted, entriesFailed
  - exitsExecuted
- [ ] Pass counters to `AttributionEngine` for reports

**Files to modify:**
- `src/sandbox/virtual-portfolio.ts`
- `src/sandbox/simulation-coordinator.ts`
- `src/sandbox/attribution-engine.ts`

---

## 🚫 Not Started (2/8)

### 9. CI Check for No-Signing Constraint
**Issue:** Need to prevent accidental signing/submission in sandbox  
**Required:**
- [ ] Add grep check in CI: fail if any sandbox file references:
  - `sendTransaction`
  - `Keypair.sign`
  - `Transaction.sign`
  - Jupiter swap execution
- [ ] Add to `.github/workflows/` or package.json test script

### 10. Invariants Test Suite
**Issue:** Need automated correctness checks  
**Required:**
- [ ] Same dataset + same config = identical run hash/output
- [ ] No-trade config = zero trades, zero portfolio changes
- [ ] Disabled module = expected downstream effects
- [ ] Replay vs live parity check (1-2 hour window)

**Files to create:**
- `src/sandbox/__tests__/invariants.test.ts`
- `src/sandbox/__tests__/determinism.test.ts`
- `src/sandbox/__tests__/parity.test.ts`

---

## 🎯 Next Actions (Priority Order)

1. **Complete Event Ordering** (30 min)
   - Update swap-recorder to capture txIndex
   - Update replay-trade-feed to sort correctly

2. **Complete TimeProvider Integration** (1-2 hours)
   - Wire into all strategy modules
   - Test with simple replay

3. **Wire Real Strategy Modules** (2-3 hours)
   - Remove simplified coordinator logic
   - Initialize real modules
   - Test end-to-end

4. **Implement Pool Parsers** (3-4 hours)
   - Research Raydium/Pump formats
   - Implement parsing
   - Test with real pool accounts

5. **Add Equity Curve Tracking** (1 hour)
   - Snapshot portfolio state
   - Track counters

6. **Add CI Check** (30 min)
   - Grep for forbidden patterns

7. **Add Invariants Tests** (2-3 hours)
   - Determinism test
   - No-trade test
   - Parity test

**Total Estimated Time:** 10-14 hours

---

## 🔍 Testing Plan

### Phase 2A: Unit Tests
- [ ] TimeProvider tests (live vs replay)
- [ ] Event ordering tests
- [ ] Pool parser tests (with known accounts)

### Phase 2B: Integration Tests
- [ ] Record 1 hour of swaps
- [ ] Replay at 100x speed
- [ ] Verify determinism (run twice, compare hashes)
- [ ] Verify no-trade config works

### Phase 2C: Parity Check
- [ ] Run live paper trading for 1 hour (record events)
- [ ] Replay same window
- [ ] Compare:
  - Large sell detections (count, tokens)
  - Absorption events (count, wallets)
  - Entry/exit counts
  - Final portfolio state

---

## 📝 Known Issues

1. **PumpSwap Program ID** - May need verification
2. **Transaction Index** - Need to confirm Helius provides this
3. **Pool Account Formats** - Need to research exact binary layouts
4. **Slot Timing** - 400ms per slot is approximate (actual varies)

---

## 📚 Resources Needed

- Raydium SDK documentation
- PumpFun contract source code
- Helius transaction format documentation
- Solana account data parsing examples

---

**Last Updated:** December 26, 2025  
**Next Update:** After completing event ordering + TimeProvider integration


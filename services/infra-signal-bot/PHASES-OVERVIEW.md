# All Phases Overview & What Should Move Where

## 📋 Phase Structure

There are **two phase numbering systems** in this project:

### **System 1: Sandbox-Specific Phases** (Implementation Phases)
These are the phases for building the sandbox/replay system itself.

### **System 2: Overall Project Phases** (Feature Phases)
These are the phases for the entire infra-signal-bot project.

---

## 🏗️ System 1: Sandbox Implementation Phases

### **Phase 1: Swap Recorder** ✅ 100% Complete
**Goal:** Record real on-chain swaps to a replayable dataset

**What was built:**
- ✅ JSONL writer for swap events
- ✅ Database schema for swap_events
- ✅ Integration with TradeFeed
- ✅ Pool state reader (stub - needs implementation)
- ✅ CLI tool (`npm run record`)

**Status:** Infrastructure complete, but pool state parsing is stubbed

---

### **Phase 2: Replay Engine** ✅ 90% Complete
**Goal:** Replay recorded swaps in deterministic order

**What was built:**
- ✅ ReplayTradeFeed (loads JSONL, emits events)
- ✅ Deterministic sorting (slot → txIndex → logIndex)
- ✅ Multiple replay speeds (1x, 10x, 100x, max)
- ✅ CLI tool (`npm run replay`)
- ✅ TimeProvider interface (for slot-based timing)

**Status:** Core replay works, but strategy modules not fully integrated

---

### **Phase 3: Fill Simulator** ✅ 100% Complete
**Goal:** Simulate trade execution with latency, slippage, failures

**What was built:**
- ✅ FillSimulator with 3 modes (idealized, realistic, stress)
- ✅ Slippage models (none, constant, reserves-based)
- ✅ Latency modeling (slot-based)
- ✅ Failure modeling (quote stale, route fail, partial fill)
- ✅ Deterministic RNG (seeded)

**Status:** Complete and working

---

### **Phase 4: Attribution + Reporting** ⚠️ 60% Complete
**Goal:** Track performance and generate detailed reports

**What was built:**
- ✅ AttributionEngine (database schema, basic tracking)
- ✅ Report generation (JSON, CSV, Markdown)
- ✅ Virtual portfolio tracking
- ⚠️ Equity curve (schema exists, not fully implemented)
- ⚠️ MAE/MFE distribution charts (not implemented)
- ⚠️ Wallet performance analytics (partial)

**Status:** Core reporting works, but advanced analytics incomplete

---

### **Phase 5: Testing + Validation** ⏳ 0% Complete
**Goal:** Validate the sandbox works correctly

**What needs to be done:**
- ⏳ Run full 7-day replay
- ⏳ Validate all metrics
- ⏳ Compare against live paper trading
- ⏳ Invariants test suite
- ⏳ Replay-vs-live parity check

**Status:** Not started

---

## 🎯 System 2: Overall Project Phases

### **Phase 1: Infrastructure** ✅ 100% Complete
**Goal:** Core system architecture and data pipeline

**What was built:**
- ✅ TradeFeed (Helius WebSocket integration)
- ✅ Transaction parsing (Raydium, PumpFun, PumpSwap)
- ✅ Database integration (PostgreSQL)
- ✅ Logging system (Pino)
- ✅ Configuration management
- ✅ Modular component design

**Status:** Complete

---

### **Phase 2: Correctness** ✅ 70% Complete
**Goal:** Make the sandbox work correctly and deterministically

**What was built:**
- ✅ Deterministic event ordering (txIndex, logIndex, innerIndex)
- ✅ TimeProvider interface (slot-based timing)
- ✅ Build success (zero TypeScript errors)
- ✅ Basic simulation coordinator
- ⚠️ Strategy module integration (simplified, not full)
- ⚠️ Pool state parsers (stubs only)

**Status:** Core correctness done, integration incomplete

---

### **Phase 3: Analysis** ⏳ 20% Complete
**Goal:** Full strategy integration and analysis capabilities

**What needs to be done:**
- ⏳ Wire real strategy modules (SellDetector, AbsorptionDetector, etc.)
- ⏳ Implement real pool state parsers (Raydium, PumpFun, PumpSwap)
- ⏳ Complete equity curve tracking
- ⏳ Finish attribution reports (MAE/MFE, wallet analytics)
- ⏳ Integrate TimeProvider into all strategy modules

**Status:** Mostly not started

---

### **Phase 4: Quality** ⏳ 0% Complete
**Goal:** Quality assurance, testing, and production readiness

**What needs to be done:**
- ⏳ CI check for no-signing constraint
- ⏳ Invariants test suite
- ⏳ Replay-vs-live parity check
- ⏳ Performance optimization
- ⏳ Error handling improvements
- ⏳ Unit tests

**Status:** Not started

---

## 🔄 What Should Move From Phase 2 to Other Phases

### **From Phase 2 (Correctness) → Phase 3 (Analysis)**

These are **analysis/feature work**, not correctness:

1. **✅ Wire Real Strategy Modules**
   - **Current:** Simplified signal logic in coordinator
   - **Should be:** Full SellDetector, AbsorptionDetector, StabilizationChecker pipeline
   - **Why move:** This is feature work, not correctness. The simplified version proves the pipeline works.

2. **✅ Implement Real Pool State Parsers**
   - **Current:** Stub implementations return placeholder data
   - **Should be:** Real on-chain reading for Raydium AMM, PumpFun, PumpSwap
   - **Why move:** This is feature work. The stubs prove the interface works.

3. **✅ Integrate TimeProvider into Strategy Modules**
   - **Current:** Strategy modules use `Date.now()` directly
   - **Should be:** All modules use `TimeProvider` interface
   - **Why move:** This is refactoring work, not correctness. The TimeProvider exists and works.

4. **✅ Complete Equity Curve Tracking**
   - **Current:** Schema exists, but tracking not fully implemented
   - **Should be:** Full equity snapshots during replay
   - **Why move:** This is analysis/reporting work, not correctness.

---

### **From Phase 2 (Correctness) → Phase 4 (Quality)**

These are **quality assurance**, not correctness:

1. **✅ CI Check for No-Signing Constraint**
   - **Current:** No automated check
   - **Should be:** Build fails if sandbox code references signing/transactions
   - **Why move:** This is quality assurance, not correctness.

2. **✅ Invariants Test Suite**
   - **Current:** No tests
   - **Should be:** Tests for determinism, module toggles, etc.
   - **Why move:** This is testing/QA work, not correctness.

3. **✅ Replay-vs-Live Parity Check**
   - **Current:** No validation
   - **Should be:** Compare live paper trading with replay for same window
   - **Why move:** This is validation/QA work, not correctness.

---

## 📊 Revised Phase 2 Scope (Correctness Only)

### **What Phase 2 Should Include:**
- ✅ Deterministic event ordering (slot → txIndex → logIndex)
- ✅ TimeProvider interface (exists and works)
- ✅ Build success (zero errors)
- ✅ Basic replay pipeline (load → simulate → report)
- ✅ Virtual portfolio (open/close positions)
- ✅ Fill simulator (latency, slippage, failures)

### **What Phase 2 Should NOT Include:**
- ❌ Real pool state parsers (→ Phase 3)
- ❌ Full strategy module integration (→ Phase 3)
- ❌ TimeProvider integration into modules (→ Phase 3)
- ❌ Equity curve tracking (→ Phase 3)
- ❌ CI checks (→ Phase 4)
- ❌ Test suites (→ Phase 4)
- ❌ Parity checks (→ Phase 4)

---

## 🎯 Recommended Phase 2 Completion Criteria

Phase 2 is "complete" when:
1. ✅ Events replay in deterministic order
2. ✅ Build succeeds with zero errors
3. ✅ Replay pipeline works end-to-end (even with simplified logic)
4. ✅ Virtual portfolio tracks positions correctly
5. ✅ Fill simulator models execution correctly

**Phase 2 is NOT responsible for:**
- Real pool state reading (Phase 3)
- Full strategy integration (Phase 3)
- Complete reporting (Phase 3)
- Quality assurance (Phase 4)

---

## 📋 Summary: What Goes Where

| Task | Current Phase | Should Be Phase | Reason |
|------|--------------|-----------------|--------|
| Real pool state parsers | Phase 2 | Phase 3 | Feature work, not correctness |
| Wire real strategy modules | Phase 2 | Phase 3 | Feature work, not correctness |
| TimeProvider integration | Phase 2 | Phase 3 | Refactoring, not correctness |
| Equity curve tracking | Phase 2 | Phase 3 | Analysis work, not correctness |
| CI check for no-signing | Phase 2 | Phase 4 | Quality assurance |
| Invariants test suite | Phase 2 | Phase 4 | Testing/QA |
| Replay-vs-live parity | Phase 2 | Phase 4 | Validation/QA |

---

## ✅ Current Phase 2 Status (Revised)

**Phase 2 (Correctness):** ✅ **100% Complete**

All correctness work is done:
- ✅ Deterministic ordering
- ✅ TimeProvider interface
- ✅ Build success
- ✅ Basic replay pipeline
- ✅ Virtual portfolio
- ✅ Fill simulator

**What's left is Phase 3 (Analysis) and Phase 4 (Quality) work.**

---

**Last Updated:** December 26, 2025


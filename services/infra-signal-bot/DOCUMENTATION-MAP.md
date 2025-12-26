# Documentation Map - Current vs Planned Workflow

## 📋 Quick Answer

**Current Workflow (What's Actually Implemented):**
- `STATUS.md` - Current operational status
- `README.md` - How the current system works (as implemented)
- `IMPLEMENTATION-STATUS.md` - "✅ Completed Features" section

**Planned Workflow (What We Plan to Implement):**
- `UPGRADE-SPEC.md` - Detailed specification of required fixes/additions
- `SYSTEM-PHILOSOPHY.md` - Ideal system design (target architecture)
- `IMPLEMENTATION-STATUS.md` - "⚠️ Critical Gaps" and "🎯 Priority Roadmap" sections

---

## 📚 File-by-File Breakdown

### 🟢 CURRENT WORKFLOW (Implemented & Running)

#### 1. `STATUS.md` ⭐ **START HERE**
**Purpose:** Real-time status of what's actually working right now  
**Content:**
- ✅ What's working (WebSocket, components, database)
- Current configuration values
- Issues that were fixed
- What happens next (as currently implemented)
- Performance metrics

**Use this to:** Understand what the bot is doing RIGHT NOW

---

#### 2. `README.md`
**Purpose:** Overview of the current system (as built)  
**Content:**
- How the bot works (current implementation)
- Current workflow: Sell Detection → Absorption → Stabilization → Entry → Exit
- Current configuration options
- Installation and setup

**Use this to:** Understand the current workflow end-to-end

---

#### 3. `IMPLEMENTATION-STATUS.md` - "✅ Completed Features" Section
**Purpose:** Checklist of what's actually implemented  
**Content:**
- ✅ Core System Architecture
- ✅ Data Pipeline (TradeFeed, parsing)
- ✅ Detection Modules (SellDetector, AbsorptionDetector, etc.)
- ✅ Signal Generation (EntryManager)
- ✅ Position Management (PositionMonitor)
- ✅ Infra Wallet Management (database, pre-seeding)

**Use this to:** See what features are actually in the code

---

### 🔵 PLANNED WORKFLOW (Not Yet Implemented)

#### 1. `UPGRADE-SPEC.md` ⭐ **THE SPECIFICATION**
**Purpose:** Detailed specification of what needs to be fixed/added  
**Content:**
- Executive summary of critical gaps
- Gap A: On-chain pool state reader (currently using DexScreener)
- Gap B: Multi-event infra classification (currently single-event)
- Gap C: Strict stabilization logic (currently too loose)
- Gap D: Distribution detection (currently basic)
- Gap E: Execution policy (currently not implemented)
- Gap F: Token safety checks (currently missing)
- Refinements: No-trade regime detector, confidence decay
- Final additions: Capital stress governor, correlation guard, etc.

**Use this to:** Understand what needs to be built (the roadmap)

---

#### 2. `SYSTEM-PHILOSOPHY.md`
**Purpose:** Ideal system design and architecture (target state)  
**Content:**
- Core principle: "We trade when infra behavior makes risk asymmetric"
- Non-negotiable rules
- What the system IS and IS NOT
- System architecture philosophy
- Trading philosophy (entry/exit strategy)
- Regime awareness
- Capital management
- Learning & adaptation

**Use this to:** Understand the target architecture and design principles

---

#### 3. `IMPLEMENTATION-STATUS.md` - "⚠️ Critical Gaps" Section
**Purpose:** What's missing and needs to be implemented  
**Content:**
- Gap A-F: Critical missing features
- Refinements: No-trade regime, confidence decay
- Final additions: Capital governor, correlation guard, etc.
- Priority roadmap (P0, P1, P2, P3, P4)

**Use this to:** See what's not implemented yet and priority order

---

### 📖 REFERENCE DOCUMENTATION (Setup & Guides)

#### Setup & Configuration
- `SETUP.md` - Detailed setup instructions
- `DATABASE-SETUP.md` - PostgreSQL setup guide
- `KNOWN-INFRA-WALLETS-SETUP.md` - Pre-seeded wallet configuration
- `ENV-SETUP-GUIDE.md` - Environment variable troubleshooting

#### Understanding the System
- `INFRA-WALLETS.md` - How wallet discovery and classification works
- `TOKEN-COVERAGE.md` - Which tokens are monitored
- `WHAT-ARE-THESE-WALLETS.md` - Wallet tracking explanation
- `LOGGING-GUIDE.md` - Log output reference
- `FINDING-INFRA-WALLETS.md` - Manual and automatic discovery

---

## 🎯 Workflow Comparison

### Current Workflow (As Implemented)

```
1. TradeFeed → Streams DEX transactions
2. SellDetector → Detects large sells (1-3% of pool)
   ⚠️ Uses DexScreener liquidity (can be stale)
3. AbsorptionDetector → Monitors for buybacks
   ⚠️ Single absorption event = infra wallet (too loose)
4. StabilizationChecker → Checks for higher lows
   ⚠️ Basic logic (too loose)
5. EntryManager → Generates signal, enters if score ≥60
6. PositionMonitor → Exits on TP/SL or infra distribution
   ⚠️ Basic distribution detection
```

**Issues:**
- ❌ Stale liquidity data (DexScreener)
- ❌ Single-event infra classification (mislabels whales)
- ❌ Weak stabilization enforcement
- ❌ Basic distribution detection
- ❌ No execution policy
- ❌ No token safety checks
- ❌ No regime detection
- ❌ No capital stress management

---

### Planned Workflow (Target State)

```
1. TradeFeed → Streams DEX transactions
2. PoolStateReader → Reads pool reserves from chain (not API)
3. SellDetector → Detects large sells using on-chain reserves
4. AbsorptionDetector → Monitors for buybacks
   ✅ Requires ≥3 events on ≥2 tokens OR ≥2 hours
5. StabilizationChecker → Strict stabilization gate
   ✅ Higher lows, volatility decay, defended level holds, no new sells
6. RegimeFilter → Checks if market is tradeable
   ✅ Blocks entries in hostile conditions
7. SignalScoring → Composite score with caps
   ✅ Absorption (0-30) + Stabilization (0-30) + Wallet (0-20) + Regime (0-10) + Safety (0-10)
8. CapitalGovernor → Checks risk limits
   ✅ Drawdown limits, loss streaks, position sizing
9. EntryManager → Enters only if all gates pass
10. PositionMonitor → Advanced exit logic
    ✅ Distribution detection, defense cessation, price stalling
11. AttributionEngine → Logs detailed trade context
    ✅ Entry/exit reasons, MAE/MFE, holding time
```

**Improvements:**
- ✅ Deterministic pool state (on-chain)
- ✅ Repeatable infra classification
- ✅ Strict stabilization gates
- ✅ Advanced distribution detection
- ✅ Execution policy (MEV protection, slippage)
- ✅ Token safety checks
- ✅ Regime-aware trading
- ✅ Capital stress management
- ✅ Learning system (attribution)

---

## 📊 Quick Reference Table

| File | Represents | Status | Use For |
|------|------------|--------|---------|
| `STATUS.md` | Current operational state | ✅ Live | See what's working now |
| `README.md` | Current system overview | ✅ Live | Understand current workflow |
| `IMPLEMENTATION-STATUS.md` | Current vs Planned | ✅/❌ Mixed | See what's done vs what's needed |
| `UPGRADE-SPEC.md` | Planned improvements | ❌ Spec | Understand what needs to be built |
| `SYSTEM-PHILOSOPHY.md` | Target architecture | ❌ Design | Understand ideal system design |

---

## 🚀 How to Use These Documents

### If you want to understand what's working NOW:
1. Read `STATUS.md` - Current operational status
2. Read `README.md` - Current workflow
3. Check `IMPLEMENTATION-STATUS.md` - "✅ Completed Features"

### If you want to understand what needs to be BUILT:
1. Read `UPGRADE-SPEC.md` - Detailed specification
2. Read `SYSTEM-PHILOSOPHY.md` - Target architecture
3. Check `IMPLEMENTATION-STATUS.md` - "⚠️ Critical Gaps" and "🎯 Priority Roadmap"

### If you want to SET UP the system:
1. Read `SETUP.md` - Full setup guide
2. Read `DATABASE-SETUP.md` - Database setup
3. Read `KNOWN-INFRA-WALLETS-SETUP.md` - Wallet configuration

---

## 🎯 Summary

**Current Workflow Documents:**
- `STATUS.md` ⭐ (what's working now)
- `README.md` (current system overview)
- `IMPLEMENTATION-STATUS.md` - Completed section

**Planned Workflow Documents:**
- `UPGRADE-SPEC.md` ⭐ (the specification)
- `SYSTEM-PHILOSOPHY.md` (target design)
- `IMPLEMENTATION-STATUS.md` - Gaps section

**The workflow you plan to implement is documented in:**
- `UPGRADE-SPEC.md` (detailed spec)
- `SYSTEM-PHILOSOPHY.md` (design principles)
- `IMPLEMENTATION-STATUS.md` (roadmap)

---

**Last Updated:** December 26, 2025


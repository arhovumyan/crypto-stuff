# 🎯 Infrastructure Wallet Discovery Bot - Complete

## ✅ What Was Built

A **comprehensive behavioral wallet discovery system** that automatically identifies infrastructure / liquidity-absorbing wallets on Solana by analyzing on-chain transaction patterns in real-time.

### Core Principle
**Identifies wallets that change market structure, not wallets that make money.**

High PnL ≠ Infrastructure wallet  
Consistent price stabilization = Infrastructure wallet

---

## 📦 Complete System Components

### 1. Data Ingestion (`swapMonitor.ts`)
- Monitors Raydium AMM, PumpFun, PumpSwap via WebSocket
- Parses transactions in real-time
- Extracts: trader, amounts, price impact, pool reserves
- Maintains pool state cache

### 2. Large Sell Detector (`largeSellDetector.ts`)
- Detects "large sells" (1-3% of pool liquidity)
- Excludes panic dumps (>3%) and noise (<1%)
- Opens 60-second observation windows
- Tracks price before/after events

### 3. Absorption Analyzer (`absorptionAnalyzer.ts`)
- Tracks all buyers during observation windows
- Measures % of sell absorbed by each wallet
- Counts buy transactions
- Measures response latency (in slots)
- Filters for meaningful absorption (20-80%)

### 4. Stabilization Validator (`stabilizationValidator.ts`)
- Validates if price stabilizes after absorption
- Checks: no new lows, volume contraction, defense level held
- Calculates confidence score (0-100)
- Requires 5+ minute stabilization window

### 5. Wallet Scorer (`walletScorer.ts`) - **MOST CRITICAL**
- Tracks wallets longitudinally across time
- **Requirements:** 3+ events, 2+ tokens, 60%+ success rate
- Calculates confidence scores with decay
- Classifications: defensive-infra, aggressive-infra, cyclical, opportunistic, noise
- Prunes low-confidence wallets automatically

### 6. Output Manager (`outputManager.ts`)
- Exports `data/infra_wallets.json` (full data)
- Exports `data/infra_wallets.csv` (spreadsheet)
- Generates per-wallet markdown reports with evidence
- Saves every 15 minutes

### 7. Main Orchestrator (`infraWalletDiscovery.ts`)
- Coordinates all components
- Real-time event processing
- Statistics logging every 5 minutes
- Graceful shutdown handling

---

## 🚀 How to Use

### Quick Start

```bash
cd services/infra-wallet-discovery
npm install
npm run dev
```

### Wait for Results
- **Minimum:** Few hours
- **Reliable:** 24+ hours  
- **High confidence:** Several days

The system needs time to observe repeatable behavior patterns.

### Check Output

```bash
# Main output - complete wallet data
cat data/infra_wallets.json

# CSV for Excel/Google Sheets
cat data/infra_wallets.csv

# Detailed per-wallet reports
ls data/reports/
cat data/reports/[wallet_address]_report.md
```

---

## 📊 What You'll Find

### Wallet Classifications

| Type | Description | Confidence | Priority |
|------|-------------|------------|----------|
| **defensive-infra** | Consistent defenders, 80%+ success | 80+ | ⭐⭐⭐⭐⭐ |
| **aggressive-infra** | Large positions, 70%+ success | 70+ | ⭐⭐⭐⭐ |
| **cyclical** | Appears during stress, periodic | 60+ | ⭐⭐⭐ |
| **opportunistic** | Buys dumps, inconsistent | 60+ | ⭐⭐ |
| **noise** | No correlation with stabilization | Any | ❌ Ignore |
| **candidate** | Insufficient data yet | <60 | ⏳ Wait |

### Example Output

```json
{
  "wallet": "eGkFSm9Y...",
  "classification": "defensive-infra",
  "confidenceScore": 85.5,
  "totalAbsorptions": 5,
  "successfulAbsorptions": 4,
  "stabilizationRate": 80.0,
  "uniqueTokens": 3,
  "avgAbsorptionPercent": 35.2,
  "avgResponseLatency": 45
}
```

---

## 🎓 Understanding the System

### What Makes a Wallet "Infra"?

✅ **Required:**
1. Buys during large dumps (1-3% of pool)
2. Absorbs meaningful amount (20-80% of sell)
3. Price stabilizes afterward
4. Does this 3+ times
5. Across 2+ different tokens
6. 60%+ stabilization success rate

❌ **NOT Infra:**
- One-time lucky trade
- High PnL without stabilization
- Buys pumps instead of dumps
- Erratic, inconsistent behavior
- Single token only

### Confidence Score Breakdown

Score calculated from:
- **Event count** (30 points max) - More events = higher confidence
- **Stabilization rate** (25 points max) - % of successful absorptions
- **Token diversity** (15 points max) - Breadth across tokens
- **Size consistency** (10 points max) - Predictable position sizing
- **Activity pattern** (10 points max) - Consistent > Cyclical > Opportunistic
- **Response speed** (10 points max) - Faster = better
- **Penalty** (-20 points) - For failed stabilizations

### Why Longitudinal Analysis?

**Single event = NOT infra**

The system requires **repeatable patterns** because:
- Anyone can get lucky once
- True infrastructure shows systematic behavior
- Confidence grows slowly over multiple events
- Decay mechanism removes temporary actors

---

## ⚙️ Configuration

All settings in `.env`:

### Key Parameters

```bash
# Sell Detection
DISCOVERY_MIN_SELL_PCT=1.0          # 1% of pool = large sell
DISCOVERY_MAX_SELL_PCT=3.0          # 3% max (exclude panic)

# Absorption Thresholds
DISCOVERY_MIN_ABSORPTION_PCT=20     # 20% minimum absorbed
DISCOVERY_MAX_ABSORPTION_PCT=80     # 80% maximum

# Scoring Requirements (CRITICAL)
SCORING_MIN_EVENTS=3                # Require 3 events minimum
SCORING_MIN_TOKENS=2                # Require 2 tokens minimum
SCORING_MIN_STABILIZATION_RATE=0.6  # 60% success rate minimum
SCORING_CONFIDENCE_DECAY_DAYS=7     # Confidence halves every 7 days
```

### Tuning for Different Goals

**More Strict (Fewer False Positives):**
```bash
SCORING_MIN_EVENTS=5
SCORING_MIN_STABILIZATION_RATE=0.7
DISCOVERY_MIN_ABSORPTION_PCT=30
```

**More Permissive (More Candidates):**
```bash
SCORING_MIN_EVENTS=2
SCORING_MIN_STABILIZATION_RATE=0.5
DISCOVERY_MIN_ABSORPTION_PCT=15
```

---

## 📈 Monitoring

### Console Output

Every 5 minutes you'll see:
```
📊 SYSTEM STATISTICS
Uptime: 2.5 hours
Swaps Processed: 1,234
Large Sell Events: 15
Confirmed Infrastructure Wallets: 2
```

Real-time events:
```
🔴 Large sell detected: Token 3eqzsw3f... 2.34% of pool
🟢 Absorption candidate: eGkFSm9Y... absorbed 42.1%
✅ Stabilization confirmed (confidence: 85%)
```

### Log Files

```bash
# Full logs
tail -f logs/infra-discovery.log

# Errors only
tail -f logs/infra-discovery-error.log
```

---

## 🔗 Integration

### With Post-Absorption Trader

```typescript
// Read discovered wallets
import { readFileSync } from 'fs';
const data = JSON.parse(
  readFileSync('data/infra_wallets.json', 'utf-8')
);

// Filter for high-confidence defensive infra
const topInfra = data.infraWallets
  .filter(w => 
    w.classification === 'defensive-infra' &&
    w.confidenceScore >= 80 &&
    w.status === 'active'
  )
  .map(w => w.wallet);

// Use in post-absorption trader
// services/post-absorption-trader
```

### Export for Analysis

```bash
# CSV for Excel/Google Sheets
open data/infra_wallets.csv

# Reports for detailed review
open data/reports/
```

---

## 🎯 What Makes This System Unique

### 1. Behavioral Analysis Only
No PnL signals. Only observable on-chain behavior.

### 2. Longitudinal Tracking
Wallets must prove themselves over time (3+ events minimum).

### 3. Stabilization Correlation
The key metric: Do absorptions actually stabilize prices?

### 4. Confidence Decay
Inactive wallets lose confidence. System stays current.

### 5. Transparent Reasoning
Every classification has evidence. You can always answer: "Why is this wallet infra?"

### 6. No False Permanence
Wallets are not "infra forever" - they can decay and be reclassified.

---

## 📚 Documentation

All documentation included:

1. **QUICKSTART.md** - 5-minute setup guide
2. **README.md** - Complete system documentation
3. **IMPLEMENTATION-COMPLETE.md** - Technical implementation details
4. **Inline code comments** - Every function documented
5. **Per-wallet reports** - Behavior explanation with evidence

---

## ✅ Success Criteria

The system succeeds when:

1. ✅ It repeatedly finds the same wallets over time
2. ✅ False infra wallets decay naturally  
3. ✅ High-PnL non-structural wallets are rejected
4. ✅ Identified wallets correlate with price stabilization
5. ✅ Classification is always explainable

---

## 🎉 Ready to Run

```bash
cd services/infra-wallet-discovery
npm run dev
```

The system will:
1. Connect to DEX programs via WebSocket
2. Monitor real-time swaps
3. Detect large sell events
4. Analyze absorption behavior
5. Validate stabilization
6. Score wallets longitudinally
7. Export results every 15 minutes

**Let it run for 24+ hours for best results.**

---

## 💡 Key Takeaways

1. **This is NOT a trading bot** - It's a discovery system
2. **Behavior > PnL** - Structural impact matters, not profit
3. **Time is required** - Behavioral patterns emerge over days
4. **Evidence-based** - Every classification has proof
5. **Read the reports** - JSON has data, reports explain WHY

---

## 🚀 Next Steps

1. **Start the bot:** `npm run dev`
2. **Wait 24+ hours** for reliable data
3. **Check output:** `cat data/infra_wallets.json`
4. **Read reports:** `data/reports/[wallet]_report.md`
5. **Integrate:** Use discovered wallets in trading systems

**The system is complete, production-ready, and ready to discover infrastructure wallets.**

# 🎯 QUICK REFERENCE - ENHANCED TRADING BOT

## New Features at a Glance

### 1. **Wallet Confidence** 🎯
- **What**: Tracks performance of each infra wallet
- **Score**: 0-1 based on win rate, avg P&L, profit factor
- **Decay**: 2% per day (old edges fade)
- **Minimum**: 0.3 confidence required to trade
- **File**: `data/wallet-confidence.json`

### 2. **Token Safety** 🛡️
Must pass to trade:
- ✅ No freeze authority
- ✅ No mint authority (or large supply)
- ✅ Top holder <40%
- ✅ Token age >1 hour
- ✅ Transaction count >100

### 3. **Enhanced Stabilization** 📊
**7 checks** (must pass ALL):
- Volatility ≤10%
- Price deviation ≤8%
- Price recovery ≥-5%
- Liquidity ≥$5k
- Volume ratio ≥0.5
- **Higher lows ≥2** (NEW)
- **No large sells** (NEW)

**Sampling**: 10s intervals, 90s window (9 samples)

### 4. **Defense Monitor** 🛡️
Exits when defense breaks:
- 3+ infra sells in 5 minutes
- Price falls >5% through support
- Volume spike + price stall
- No infra activity 10+ minutes

### 5. **Execution Hardening** ⚡
- Max quote age: 5 seconds
- Max price impact: 3%
- Max price movement: 2% since signal
- Retry attempts: 2 with exponential backoff

### 6. **Regime Filter** 🚫
Blocks entries when:
- 3+ failed stabilizations in 1 hour
- Daily loss >50% of limit (-$25)
- Win rate <30% or avg P&L <-10%

### 7. **Tighter Risk** 💰
- Max positions: **1** (was 5)
- Position size: **0.05 SOL** (was 0.1)
- Stop loss: **-15%** (was -20%)
- Partial exit: **+20%** (was +30%)
- Full exit: **+40%** (was +50%)
- Max hold: **4 hours** (was 24)
- Daily loss: **$50** (was $100)
- Portfolio: **$50** (was $500)

---

## Expected Log Flow

### Successful Entry:
```
[WalletListener] ✅ Valid swap: BUY H9FzJmC2... for 3.58 SOL
[AbsorptionDetector] ✅ Signal: DIP_ABSORPTION (3.58 SOL)
[PostAbsorptionTrader] Running token safety checks...
[TokenSafety] ✅ SAFE H9FzJmC2... (all checks passed)
[PostAbsorptionTrader] Starting stabilization monitoring...
[StabilizationMonitor] Sample 1: $0.00124 (0:10)
[StabilizationMonitor] Sample 2: $0.00122 (0:20)
...
[StabilizationMonitor] ✅ STABILIZED (score: 100)
  ✓ Volatility OK
  ✓ Price stable
  ✓ Higher lows (3)
  ✓ No large sells
[PostAbsorptionTrader] Stabilization confirmed - attempting entry
[RegimeFilter] ✅ ACTIVE (0 recent failures)
[JupiterHardened] Attempt 1/2
[JupiterHardened] ✓ Quote age: 1.2s
[JupiterHardened] ✓ Price impact: 1.34%
[JupiterHardened] ✅ Swap successful
[PostAbsorptionTrader] ✅ Position entered, defense monitoring started
```

### Blocked Entry:
```
[PostAbsorptionTrader] Skipping H9FzJmC2... - wallet eGkFSm... below confidence threshold
OR
[TokenSafety] ❌ UNSAFE - top holder owns 65% (max: 40%)
OR
[RegimeFilter] 🚫 BLOCKING - choppy market: 4 failed stabilizations
```

### Defense Break:
```
[DefenseMonitor] ⚠️ H9FzJmC2... infra SELL: FSkmRP... 1.23 SOL
[DefenseMonitor] 🚨 DEFENSE BROKEN | EXIT_NOW
  • Infra selling cluster: 3 sells (2.34 SOL) in 5 min
  • Defended level broken: -6.2% below support
```

---

## Status Dashboard

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Status Update]
  📊 Active Absorptions: 1
  💼 Open Positions: 1/1
  💰 Daily P&L: +$2.34 (3 trades)
  📈 Portfolio Exposure: $12.50
  ✅ REGIME: ACTIVE (1 recent failures)
  
  Wallet Confidence (top 3):
    FSkmRP... | 82% confidence | 70% win | 15 trades
    eGkFSm... | 68% confidence | 55% win | 12 trades
    ERBVcq... | 45% confidence | 40% win | 8 trades
  
  Open Positions:
    🛡️ NOMORE67: +12.5% | 8m hold
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Files to Monitor

### Generated Data:
- `data/wallet-confidence.json` - Wallet performance tracking
- `data/regime-state.json` - Regime filter state
- `trade-history/trades_YYYY-MM-DD.json` - Daily trade log

### Important Logs:
- Wallet confidence scoring
- Token safety results
- Stabilization checks (7 of them)
- Defense monitoring warnings
- Regime filter blocks
- Execution retries

---

## Scaling Guidelines

**After 50+ successful trades:**

1. **Increase Positions**: 1 → 2
   ```
   ABSORPTION_MAX_POSITIONS=2
   ```

2. **Increase Size**: 0.05 → 0.075 SOL
   ```
   ABSORPTION_BUY_AMOUNT_SOL=0.075
   ```

3. **Loosen Stop**: -15% → -18%
   ```
   ABSORPTION_STOP_LOSS=18
   ```

4. **Extend Targets**: +20%/+40% → +25%/+45%
   ```
   ABSORPTION_PARTIAL_EXIT_PROFIT=25
   ABSORPTION_FULL_EXIT_PROFIT=45
   ```

**After 100+ successful trades:**

- Max positions: 3
- Position size: 0.1 SOL
- Stop loss: -20%
- Targets: +30%/+50%

---

## Emergency Commands

### Unblock Regime:
```typescript
regimeFilter.unblock()
```

### Check Wallet Stats:
```typescript
walletConfidence.getAllStats()
```

### Check Defense Status:
```typescript
defenseMonitor.getStatus(token)
```

---

## Key Metrics to Track

### Daily:
- Win rate (target: >50%)
- Average P&L (target: >15%)
- Failed stabilizations (max: 3/hour)
- Regime blocks (min: 0)

### Weekly:
- Wallet confidence trends
- Token safety rejection rate
- Defense breaks (should be rare)
- Execution retry rate

### Monthly:
- Overall P&L
- Best/worst wallets
- Most common rejection reasons
- Exit reason distribution

---

## What to Expect

### **More Selective:**
- Fewer entries (quality over quantity)
- More rejections (safety filters)
- Longer wait times (90s stabilization)

### **Better Fills:**
- Fewer bad executions
- Retries on transient errors
- Price impact validation

### **Earlier Exits:**
- Distribution signals trigger exits
- Defense breaks force closes
- Not waiting for full TP

### **Safer Risk:**
- Smaller positions
- Tighter stops
- Lower exposure

---

## Success Indicators

✅ **Good:**
- Wallet confidence scores trending up
- Low regime filter blocks
- High stabilization pass rate
- Defense breaks are rare
- Win rate >50%, avg P&L >15%

⚠️ **Warning:**
- Wallet confidence decaying
- Frequent regime blocks
- Many token safety rejections
- Frequent defense breaks
- Win rate <40%, avg P&L <10%

🚨 **Action Needed:**
- Multiple wallets below 0.3 confidence → Add new wallets
- Regime blocked >6 hours → Review strategy
- Token safety rejecting >80% → Adjust filters
- Defense breaks >50% → Tighten entry criteria

---

## Bottom Line

**Before**: Aggressive, risky, brittle
**After**: Conservative, safe, adaptive

Start small. Validate. Scale gradually.

🚀

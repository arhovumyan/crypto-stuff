# Infra-Wallet Confirmation Trading System Philosophy

## Core Principle

> **We do not trade because infra wallets trade.**  
> **We trade when infra behavior makes risk asymmetric.**

This sentence guides every code decision in this system.

---

## Non-Negotiable Rules

### 1. Never race infra wallets
- We are not trying to front-run or copy infra traders
- We observe their behavior as a signal, not a trigger
- Speed is not our edge; structure is

### 2. Never trade the wick
- We do not buy into panic sells
- We do not chase pumps
- We wait for stabilization confirmation

### 3. Never assume infra is always right
- Infra wallets can be wrong
- Infra wallets can change strategies
- Infra wallets can disappear
- All infra signals are subject to decay and validation

### 4. Trade structure, not transactions
- A single infra buy is not a signal
- A single absorption is not confirmation
- We require: pattern + repeatability + stabilization

### 5. Capital preservation > win rate
- Protecting capital is more important than being right
- Small losses are acceptable; large losses are not
- Risk management is not optional

---

## What This System Is

✅ **A confirmation-based structural trader**
- Uses infra behavior as one signal among many
- Requires multiple confirmations before entry
- Exits proactively when structure breaks

✅ **A risk-first system**
- Capital preservation is the primary goal
- Position sizing adapts to regime quality
- Automatic risk reduction under stress

✅ **A learning system**
- Logs detailed attribution for every trade
- Analyzes which infra types are profitable
- Adapts to changing market conditions

---

## What This System Is NOT

❌ **A sniper**
- We don't try to catch exact bottoms
- We don't race for first entry

❌ **A copy-trader**
- We don't mirror infra wallet trades
- We don't follow them blindly

❌ **A MEV bot**
- We don't compete on speed
- We don't extract value from transaction ordering

❌ **A bottom catcher**
- We don't buy falling knives
- We wait for stabilization confirmation

---

## System Architecture Philosophy

### Modular Design
Each component has a single, clear responsibility:
- **Wallet Monitor**: Track infra activity (context, not triggers)
- **Large Sell Detector**: Identify market stress events
- **Absorption Detector**: Confirm infra defense behavior
- **Stabilization Gate**: Validate price structure before entry
- **Regime Filter**: Prevent trading in hostile conditions
- **Signal Scoring**: Combine multiple signals with caps
- **Execution Engine**: Execute trades reliably and safely
- **Position Monitor**: Exit proactively when structure breaks
- **Capital Governor**: Protect capital under stress
- **Attribution Engine**: Learn from every trade

### Signal Composition
No single signal can dominate:
- Absorption strength (0–30 points)
- Stabilization quality (0–30 points)
- Wallet confidence (0–20 points)
- Regime health (0–10 points)
- Token safety (0–10 points)

**Total score required for entry: 60+ points**

### Capital Management
Risk reduction is automatic:
- Position sizing adapts to regime quality
- Consecutive losses trigger cooldown
- Drawdown limits enforce discipline
- Correlation guards prevent stacked exposure

---

## Trading Philosophy

### Entry Strategy
**We only enter when:**
1. Large sell occurs (1–3% of pool liquidity)
2. Infra wallet absorbs ≥50% of sell within window
3. Price stabilizes (higher lows, volume contraction)
4. No new large sells during confirmation
5. Regime is healthy (not saturated/choppy)
6. Signal score ≥60 points

**Entry is boring and patient.**

### Exit Strategy
**We exit immediately when:**
1. Price breaks defended level
2. Infra wallets start selling in clusters
3. Infra defense disappears
4. Price stalls with volume spike
5. Time stop (no progress after N minutes)
6. Take profit target hit

**Exit is proactive and mechanical.**

### Risk Management
**Capital is protected by:**
1. Small position sizes (1–2% risk per trade)
2. Strict stop losses (no hope holding)
3. Drawdown limits (daily/weekly caps)
4. Loss-streak cooldowns (automatic pause)
5. Correlation guards (prevent stacked exposure)

**Risk management is not negotiable.**

---

## Regime Awareness

### Healthy Regime (Trade Normally)
- Infra absorption frequency is stable
- Wallet churn is low
- Average hold times are reasonable
- Defense patterns are consistent

**Action: Normal position sizing**

### Mild Chop (Reduce Risk)
- Absorption frequency drops 20–50%
- Wallet churn increases
- Hold times shorten

**Action: 50% position sizing**

### Hostile Regime (No Trading)
- Absorption frequency drops >50%
- 10+ new infra wallets in 24h (saturation)
- Wallet churn >30%
- Average hold time <5 minutes

**Action: No new entries**

---

## Confidence Decay

### Infra Wallet Confidence
Confidence scores are not permanent:
- **Time decay**: Scores decay over time
- **Recency weighting**: Recent activity matters more
- **Inactivity penalties**: Dormant wallets lose confidence
- **Performance tracking**: Losing trades reduce confidence

**Prevents trading on stale edge.**

### Signal Quality Decay
Signals have expiration:
- Absorption events expire after window
- Stabilization must be recent
- Regime health is continuously updated

**Prevents acting on outdated information.**

---

## Learning & Adaptation

### Post-Trade Attribution
Every trade logs:
- Entry reason (which signals fired)
- Infra wallets involved
- Regime state at entry
- Stabilization quality score
- Exit reason (why we exited)
- MAE (Maximum Adverse Excursion)
- MFE (Maximum Favorable Excursion)
- Holding time

### Analysis Questions
Periodically answer:
- Which infra wallet types are profitable?
- Which regime filters prevent losses?
- Which exit triggers matter most?
- Which stabilization patterns work best?

**The system improves over time.**

---

## Deployment Philosophy

### Testing Sequence (Non-Negotiable)
1. **Replay simulation** (historical on-chain data)
   - Validate signal generation
   - Measure false positive rate
   - Analyze MAE/MFE

2. **Paper trading** (live feeds, simulated execution)
   - Test with real-time data
   - Validate execution logic
   - Track slippage and fails

3. **Micro-size live trading** (tiny positions)
   - 1 position max
   - Tiny SOL per trade
   - Strict daily loss cap
   - Daily performance reports

4. **Scale slowly** (only after proven)
   - Increase size gradually
   - Monitor performance continuously
   - Be ready to reduce or pause

**Skipping steps invalidates results.**

---

## Success Metrics

### Primary Metrics
- **Capital preservation**: Drawdown < threshold
- **Risk-adjusted returns**: Sharpe ratio > 1.0
- **Win rate**: Secondary (not primary)
- **Average win > average loss**: 1.5:1 minimum

### Secondary Metrics
- Signal quality (hit rate)
- Execution quality (slippage, fails)
- Regime detection accuracy
- Infra wallet classification accuracy

### Failure Indicators
- Consecutive losses (3+)
- Daily drawdown > threshold
- Weekly drawdown > threshold
- Signal quality degradation
- Regime saturation

**When failure indicators trigger, reduce risk automatically.**

---

## Final Principle

> **This system wins by not losing.**

We don't need to catch every move.  
We don't need to be the fastest.  
We don't need to be the smartest.

We need to:
- Enter when risk is asymmetric
- Exit when structure breaks
- Protect capital under stress
- Learn from every trade

**That's how retail survives in crypto.**

---

**Last Updated:** December 26, 2025


# What Are These Wallets?

## From Your Stats Report

```
Classification:
  Wallets Tracked:     71
  Classified:          2
  By Type:             D:0 C:0 A:2 P:0
```

---

## What These Numbers Mean

### **71 Wallets Tracked**
These are **all wallets** that have made trades on PumpSwap, PumpFun, or Raydium that the bot has seen in the last 6 minutes.

**What the bot does:**
- Listens to all DEX transactions
- Records every trade (buy or sell)
- Tracks which wallet made each trade
- Builds a history of trading patterns

**These are NOT necessarily infra wallets** - they're just wallets that have traded. The bot is analyzing them to find patterns.

---

### **2 Classified**
Out of 71 wallets tracked, **2 have enough trading history** (10+ trades) to be classified.

**Classification Requirements:**
- Minimum 10 trades
- Confidence score >= 50%
- Clear behavior pattern detected

---

### **By Type: D:0 C:0 A:2 P:0**

**D = Defensive** (0 wallets)
- High buy ratio (>60%)
- Quick response times (<10 seconds)
- Defends price levels consistently
- **What they do:** Buy back dips quickly, support price floors

**C = Cyclical** (0 wallets)
- Balanced buy/sell ratio (~50%)
- Regular trading intervals (5-60 minutes)
- Predictable patterns
- **What they do:** Trade in cycles, accumulate and distribute

**A = Aggressive** (2 wallets) ✅ **You have 2 of these!**
- High frequency trading (>10 trades/hour)
- Large trade sizes (>1 SOL average)
- Mixed buy/sell activity
- **What they do:** Market making, high-frequency trading, large volume

**P = Passive** (0 wallets)
- Low activity
- Small trade sizes
- Infrequent trading
- **What they do:** Occasional trading, not active market participants

---

## What Are These 2 Aggressive Wallets?

The **2 Aggressive wallets** are likely:

1. **High-frequency traders** - Making many trades quickly
2. **Market makers** - Providing liquidity, trading both sides
3. **Large volume traders** - Trading significant amounts (>1 SOL per trade)

**Why they're classified as "Aggressive":**
- They've made 10+ trades in the observation period
- Average trade size is >1 SOL
- Trading frequency is high (>10 trades/hour)
- They're actively participating in the market

---

## Why Only 2 Out of 71?

**Most wallets don't meet classification criteria:**

- **Need 10+ trades** - Most wallets only trade once or twice
- **Need clear pattern** - Random trading doesn't get classified
- **Need confidence >= 50%** - Weak patterns are ignored

**The 69 unclassified wallets:**
- Probably made 1-9 trades each
- Don't show clear behavior patterns yet
- Need more trading activity to classify

---

## Are These Infra Wallets?

**Not necessarily!**

**Infra wallets** are specifically wallets that:
- ✅ Absorb large sells (50%+ of a sell within 30 seconds)
- ✅ Defend price levels
- ✅ Show consistent defensive behavior

**These 2 Aggressive wallets** are:
- ✅ Active traders (high frequency, large size)
- ❓ Might be infra, but we need to see them absorb sells first
- ❓ Could just be regular whales or market makers

**To become "infra wallets":**
- They need to absorb a large sell (1-3% of pool liquidity)
- Then they'll be saved to the `infra_wallets` table
- Then they'll show up in "Known Infra Wallets" count

---

## Where Are They Stored?

**Currently:**
- ✅ **In memory** - `walletHistory` Map in `infra-classifier.ts`
- ❌ **NOT in database** - Database was empty when bot started

**After restart with database:**
- ✅ Will be saved to `infra_wallets` table when:
  - They absorb a large sell, OR
  - They get classified with confidence >= 50%

---

## How to See These Wallets

### Option 1: Check Logs for Classifications

```bash
grep "WALLET CLASSIFIED" /tmp/infra-bot-final.log
```

This will show the 2 wallets that were classified as Aggressive.

### Option 2: Add Logging to See All Tracked Wallets

The bot doesn't currently log all tracked wallets (only classifications). You could add logging to see them.

### Option 3: Wait for Database Persistence

After restarting with database connected, classified wallets will be saved and you can query:

```sql
SELECT address, behavior_type, confidence_score, total_trades
FROM infra_wallets
WHERE behavior_type = 'aggressive';
```

---

## Summary

**71 Wallets Tracked:**
- All wallets that traded on monitored DEXs
- Being analyzed for patterns
- Most are just regular traders

**2 Classified as Aggressive:**
- High-frequency, large-volume traders
- Made 10+ trades with clear patterns
- Could be market makers or active whales
- Not confirmed as "infra" yet (need to see them absorb sells)

**0 Known Infra Wallets:**
- No wallets have absorbed large sells yet
- Database was empty when bot started
- Will populate as bot discovers absorptions

---

**The bot is working correctly!** It's analyzing trading patterns and will identify infra wallets when they absorb large sells.

---

**Last Updated:** December 25, 2025


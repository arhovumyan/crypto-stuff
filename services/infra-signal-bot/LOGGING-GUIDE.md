# Infra Wallet Discovery Logging Guide

## Where to See Infra Wallet Logs

The bot now logs infra wallet discoveries and classifications prominently. Here's what to look for:

---

## 🔴 Large Sell Detection

When a large sell (1-3% of pool liquidity) is detected, you'll see:

```
[INFO] 🔴 LARGE SELL DETECTED
  token: ABC123...
  seller: XYZ789...
  amountSOL: 2.5000
  liquidityPct: 1.85%
```

**Location:** `sell-detector` component  
**When:** Immediately when a qualifying sell happens

---

## 💰 Buyback Detection

When buybacks are detected after a large sell:

```
[INFO] 💰 Buyback detected for sell ABC123...
  buyer: DEF456...
  isInfra: ✅ YES / ❌ NO
  buyAmountSOL: 1.2500 SOL
  totalBuybackSOL: 1.2500 SOL
  targetSOL: 1.2500 SOL
  progress: 100.0%
```

**Location:** `absorption-detector` component  
**When:** Within 30 seconds of a large sell

---

## 🛡️ Absorption Confirmed

When 50%+ of a large sell is absorbed:

```
[INFO] 🛡️ ✅ ABSORPTION CONFIRMED
  token: ABC123...
  sellAmountSOL: 2.5000 SOL
  absorptionAmountSOL: 1.5000 SOL
  ratio: 60.0%
  delayMs: 5000ms
  buyers: 2
  absorberWallet: DEF456...
  isKnownInfra: ✅ YES / ❌ NO (NEW!)
```

**Location:** `absorption-detector` component  
**When:** Absorption threshold (50%) is reached

---

## 🎯 New Infra Wallet Discovered

When a wallet absorbs a large sell for the first time:

```
[INFO] 🎯 NEW INFRA WALLET DISCOVERED!
  wallet: DEF456...
  walletShort: DEF456...
  behaviorType: unknown
  reason: Absorbed large sell
  absorptionCount: 1
```

**Location:** `absorption-detector` component  
**When:** First time a wallet absorbs a large sell

---

## 🎯 Wallet Classified

When a wallet has enough trading history (10+ trades) and gets classified:

```
[INFO] 🎯 WALLET CLASSIFIED
  wallet: DEF456...
  behaviorType: AGGRESSIVE
  confidence: 75%
  reasons: High frequency: 15.2 trades/hour, Large avg trade: 2.50 SOL
  metrics:
    trades: 25
    buyRatio: 55.0%
    avgTradeSize: 2.5000 SOL
```

**Location:** `infra-classifier` component  
**When:** Wallet has 10+ trades and confidence >= 50%

**Behavior Types:**
- **DEFENSIVE** - High buy ratio, quick responses, defends levels
- **AGGRESSIVE** - High frequency, large trades, mixed buy/sell
- **CYCLICAL** - Regular patterns, balanced buy/sell
- **PASSIVE** - Low activity, small trades

---

## 📊 Stats Report

Every minute, you'll see a stats report:

```
[INFO] 📊 STATS REPORT
Uptime: 5 minutes

Detection:
  Tokens Tracked:      3
  Large Sells:         2 (1 pending)
  Pending Absorptions: 1
  Known Infra Wallets: 5

Classification:
  Wallets Tracked:     15
  Classified:          3
  By Type:             D:1 C:0 A:2 P:0

Signals:
  Pending Signals:     1
  Tokens Monitoring:   1

Positions:
  Open Positions:      0
  Unrealized P&L:      0.0000 SOL (0.00%)
```

**Location:** `infra-signal-bot` component  
**When:** Every 60 seconds

---

## How to Filter Logs

### See only infra wallet discoveries:
```bash
grep -E "(NEW INFRA WALLET|WALLET CLASSIFIED|ABSORPTION CONFIRMED)" /tmp/infra-bot-final.log
```

### See large sells and absorptions:
```bash
grep -E "(LARGE SELL|Buyback|ABSORPTION)" /tmp/infra-bot-final.log
```

### See all discovery activity:
```bash
grep -E "(🎯|🛡️|💰|🔴)" /tmp/infra-bot-final.log
```

### Watch live:
```bash
tail -f /tmp/infra-bot-final.log | grep -E "(🎯|🛡️|💰|🔴|STATS)"
```

---

## Why You Might Not See Logs Yet

### 1. No Large Sells Detected
- **Reason:** Large sells are rare (1-3% of pool liquidity)
- **Solution:** Wait for market activity or lower thresholds temporarily

### 2. No Absorptions
- **Reason:** Not all large sells get absorbed
- **Solution:** Normal - the bot is waiting for the right conditions

### 3. Wallets Not Classified Yet
- **Reason:** Need 10+ trades per wallet before classification
- **Solution:** Wait for more trading activity

### 4. Database Not Connected
- **Reason:** PostgreSQL might not be running
- **Solution:** Start PostgreSQL and apply schema (optional - bot works without it)

---

## Current Status (From Your Terminal)

Looking at your stats report:
```
Classification:
  Wallets Tracked:     5
  Classified:          1
  By Type:             D:0 C:0 A:1 P:0
```

**This means:**
- ✅ 5 wallets are being tracked
- ✅ 1 wallet has been classified as **AGGRESSIVE**
- ⏳ 4 wallets need more trades (need 10+ trades each)

**To see which wallet was classified:**
```bash
grep "WALLET CLASSIFIED" /tmp/infra-bot-final.log
```

---

## Expected Timeline

- **0-5 minutes:** Processing transactions, building wallet history
- **5-30 minutes:** First classifications appear (wallets with 10+ trades)
- **30+ minutes:** More infra wallets discovered as large sells occur
- **Hours:** Pattern recognition improves, more accurate classifications

---

## Summary

The bot **IS** logging infra wallet discoveries, but you'll only see them when:

1. ✅ Large sells happen (1-3% of pool) → `🔴 LARGE SELL DETECTED`
2. ✅ Buybacks occur → `💰 Buyback detected`
3. ✅ Absorption threshold reached → `🛡️ ✅ ABSORPTION CONFIRMED`
4. ✅ New wallet absorbs → `🎯 NEW INFRA WALLET DISCOVERED!`
5. ✅ Wallet has 10+ trades → `🎯 WALLET CLASSIFIED`

**Your bot is working correctly!** It's just waiting for the right market conditions. The stats show 1 wallet already classified, which means the system is functioning.

---

**Last Updated:** December 25, 2025


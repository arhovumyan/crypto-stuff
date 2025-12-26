# Where Infra Wallets Are Saved

## Database Storage

Infra wallets are saved in **PostgreSQL** in the `infra_wallets` table.

---

## Database Table: `infra_wallets`

**Location:** PostgreSQL database (configured via `DATABASE_URL` in `.env`)

**Schema:**
```sql
CREATE TABLE infra_wallets (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  
  -- Classification
  behavior_type TEXT NOT NULL DEFAULT 'unknown',
  confidence_score NUMERIC DEFAULT 0, -- 0-100
  
  -- Behavior metrics
  total_defenses INT DEFAULT 0,
  total_absorptions INT DEFAULT 0,
  avg_defense_size_sol NUMERIC DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  
  -- Distribution behavior
  distribution_frequency NUMERIC DEFAULT 0,
  avg_distribution_size_pct NUMERIC DEFAULT 0,
  
  -- Activity
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  total_trades INT DEFAULT 0,
  
  -- Metadata
  notes TEXT,
  is_blacklisted BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## When Wallets Are Saved

### 1. **When Wallet Absorbs a Large Sell** (First Time)
**Location:** `absorption-detector.ts` → `updateInfraWallet()`

**Trigger:** Wallet absorbs 50%+ of a large sell for the first time

**What Gets Saved:**
- Wallet address
- `total_absorptions = 1`
- `total_trades = 1`
- `avg_defense_size_sol` = absorption amount
- `avg_response_time_ms` = response time
- `first_seen_at` = current timestamp
- `last_seen_at` = current timestamp

### 2. **When Wallet Gets Classified** (After 10+ Trades)
**Location:** `infra-classifier.ts` → `updateClassifications()`

**Trigger:** Wallet has 10+ trades and confidence >= 50%

**What Gets Saved:**
- `behavior_type` = 'defensive' | 'aggressive' | 'cyclical' | 'passive'
- `confidence_score` = calculated confidence (0-100)
- `total_trades` = number of trades
- Updated `last_seen_at`

### 3. **When Wallet Absorbs Again** (Updates Existing)
**Location:** `absorption-detector.ts` → `updateInfraWallet()`

**Trigger:** Known infra wallet absorbs another sell

**What Gets Updated:**
- `total_absorptions` += 1
- `avg_defense_size_sol` = recalculated average
- `avg_response_time_ms` = recalculated average
- `last_seen_at` = current timestamp

---

## How to Query Saved Wallets

### Connect to Database

```bash
# Using DATABASE_URL from .env
psql $DATABASE_URL

# Or directly
psql postgresql://user:password@localhost:5432/copytrader
```

### Query All Infra Wallets

```sql
-- All infra wallets
SELECT 
  address,
  behavior_type,
  confidence_score,
  total_absorptions,
  total_defenses,
  total_trades,
  first_seen_at,
  last_seen_at
FROM infra_wallets
WHERE is_blacklisted = false
ORDER BY total_absorptions DESC;
```

### Query by Behavior Type

```sql
-- Defensive wallets
SELECT address, confidence_score, total_absorptions
FROM infra_wallets
WHERE behavior_type = 'defensive'
ORDER BY confidence_score DESC;

-- Aggressive wallets
SELECT address, confidence_score, total_trades
FROM infra_wallets
WHERE behavior_type = 'aggressive'
ORDER BY total_trades DESC;
```

### Query Best Performers

```sql
-- Top absorbers
SELECT 
  address,
  behavior_type,
  total_absorptions,
  avg_response_time_ms,
  confidence_score
FROM infra_wallets
WHERE total_absorptions >= 3
ORDER BY total_absorptions DESC, confidence_score DESC;
```

### Query Recently Discovered

```sql
-- Wallets discovered in last 24 hours
SELECT 
  address,
  behavior_type,
  total_absorptions,
  first_seen_at
FROM infra_wallets
WHERE first_seen_at > NOW() - INTERVAL '24 hours'
ORDER BY first_seen_at DESC;
```

---

## Database Setup

### 1. Apply Schema

```bash
# From project root
psql $DATABASE_URL < database/infra-signal-schema.sql
```

### 2. Verify Tables Exist

```sql
\dt infra_*
```

Should show:
- `infra_wallets`
- `large_sell_events`
- `infra_signals`
- `infra_trades`
- `pool_snapshots`
- `price_candles`

---

## Current Status

**From your terminal stats:**
```
Known Infra Wallets: 0
Wallets Tracked: 5
Classified: 1
```

**This means:**
- ✅ 5 wallets are being tracked in memory
- ✅ 1 wallet has been classified
- ❌ 0 wallets saved to database (likely because database isn't connected)

**Why 0 saved?**
- Database might not be running
- Schema might not be applied
- Database connection might be failing

---

## Check Database Connection

### Check if Database is Connected

Look for errors in logs:
```bash
grep -i "database\|postgres\|connection" /tmp/infra-bot-final.log | tail -10
```

### Check if Schema is Applied

```bash
psql $DATABASE_URL -c "\dt infra_*"
```

If you see "relation does not exist", apply the schema:
```bash
psql $DATABASE_URL < database/infra-signal-schema.sql
```

---

## Alternative: Export to File

If database isn't available, you can add file-based logging:

```typescript
// Add to absorption-detector.ts
fs.appendFileSync(
  'infra-wallets-discovered.txt',
  `${new Date().toISOString()} | ${walletAddress} | ${behaviorType}\n`
);
```

---

## Summary

**Where:** PostgreSQL `infra_wallets` table  
**When:** 
1. First absorption → Creates new record
2. Classification → Updates behavior_type and confidence
3. Subsequent absorptions → Updates stats

**To View:**
```sql
SELECT * FROM infra_wallets ORDER BY total_absorptions DESC;
```

**If Database Not Connected:**
- Wallets are tracked in memory only
- They'll be lost on restart
- Apply schema and ensure database is running for persistence

---

**Last Updated:** December 25, 2025


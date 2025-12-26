# Database Setup - Where Wallets Are Saved

## ⚠️ Current Status: Database Not Running

**Your PostgreSQL database is not running**, which means:

- ✅ Wallets are being tracked **in memory** (5 wallets tracked, 1 classified)
- ❌ Wallets are **NOT being saved** to database
- ⚠️ Wallets will be **lost on restart** until database is connected

---

## Where Wallets Should Be Saved

**Database:** PostgreSQL  
**Table:** `infra_wallets`  
**Connection:** `postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader`

---

## How to Start Database and Save Wallets

### Step 1: Start PostgreSQL

**On macOS (using Homebrew):**
```bash
brew services start postgresql@15
# or
brew services start postgresql@14
```

**On Linux:**
```bash
sudo systemctl start postgresql
# or
sudo service postgresql start
```

**Using Docker:**
```bash
docker run -d \
  --name postgres-copytrader \
  -e POSTGRES_USER=copytrader \
  -e POSTGRES_PASSWORD=copytrader_dev_password \
  -e POSTGRES_DB=copytrader \
  -p 5432:5432 \
  postgres:15
```

### Step 2: Verify Database is Running

```bash
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader" -c "SELECT 1;"
```

Should return: `1`

### Step 3: Apply Schema

```bash
cd /Users/aro/Documents/Trading/CopyTrader
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader" < database/infra-signal-schema.sql
```

### Step 4: Restart Bot

The bot will automatically:
- Connect to database
- Load existing infra wallets
- Start saving new discoveries

---

## Query Saved Wallets

Once database is running:

```sql
-- Connect to database
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader"

-- View all infra wallets
SELECT 
  address,
  behavior_type,
  confidence_score,
  total_absorptions,
  total_trades,
  first_seen_at,
  last_seen_at
FROM infra_wallets
WHERE is_blacklisted = false
ORDER BY total_absorptions DESC;

-- Count wallets
SELECT 
  COUNT(*) as total_wallets,
  COUNT(CASE WHEN behavior_type != 'unknown' THEN 1 END) as classified,
  COUNT(CASE WHEN total_absorptions > 0 THEN 1 END) as with_absorptions
FROM infra_wallets;
```

---

## Current In-Memory Wallets

**Right now (from your stats):**
- 5 wallets tracked in memory
- 1 wallet classified as "Aggressive"
- 0 wallets saved to database (because DB isn't running)

**These will be lost on restart** unless you:
1. Start PostgreSQL
2. Apply schema
3. Restart bot (it will save them)

---

## Quick Start Commands

```bash
# 1. Start PostgreSQL
brew services start postgresql@15

# 2. Wait a few seconds, then verify
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader" -c "SELECT 1;"

# 3. Apply schema
cd /Users/aro/Documents/Trading/CopyTrader
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader" < database/infra-signal-schema.sql

# 4. Restart bot (it will connect and start saving)
cd services/infra-signal-bot
npm run dev
```

---

## Summary

**Where wallets are saved:** PostgreSQL `infra_wallets` table  
**Current status:** Database not running → wallets only in memory  
**To persist:** Start PostgreSQL, apply schema, restart bot

---

**Last Updated:** December 25, 2025


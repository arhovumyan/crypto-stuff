# Known Infra Wallets Setup Guide

## Overview

The bot supports **pre-seeding known infrastructure wallets** from environment variables. These wallets are automatically:
1. Loaded into the database on startup
2. Treated as confirmed infra wallets (confidence score = 100)
3. Used for absorption detection immediately

---

## How to Add Known Infra Wallets

### Step 1: Add to `.env` file

In your project root `.env` file (`/Users/aro/Documents/Trading/CopyTrader/.env`), add wallets using this format:

```bash
# Known Infrastructure Wallets (Pre-Seeded)
# Format: Known_Infra_Wallets_N where N is 1, 2, 3, etc.
Known_Infra_Wallets_1=eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q5YbKQ9sUf
Known_Infra_Wallets_2=Ar2Y6o1QmrRAskjii1cRfijeKugHH13ycxW5cd7rro1x
Known_Infra_Wallets_3=ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT
Known_Infra_Wallets_4=5eKXMMPUQBN1utwx9Vsqz5ZfGbSSAm7GL1Jzy5eexbyv
Known_Infra_Wallets_5=FSkmRPArUnFFGZuRUdZ1W7vh5Hm7KqgjDQ19UBjW2kbC
Known_Infra_Wallets_6=7jDVmS8HBdDNdtGXSxepjcktvG6FzbPurZvYUVgY7TG5
```

**Important:**
- Start numbering from 1
- Use sequential numbers (1, 2, 3, 4, ...)
- No gaps in numbering (bot stops at first missing number)
- Each wallet on its own line

### Step 2: Restart the bot

```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/infra-signal-bot
npm run dev
```

---

## What Happens on Startup

### 1. Environment Loading
```
Loaded 6 known infra wallets from environment
  wallets: ["eGkFSm9Y...", "Ar2Y6o1Q...", "ERBVcqUW...", ...]
```

### 2. Database Seeding
```
✅ Seeded 6 pre-configured infra wallets into database
  wallets: ["eGkFSm9Y...", "Ar2Y6o1Q...", "ERBVcqUW...", ...]
```

### 3. Wallet Loading
```
✅ Loaded 6 known infra wallets from database
  wallets: ["eGkFSm9Y...", "Ar2Y6o1Q...", "ERBVcqUW...", ...]
```

---

## Verify Wallets Are Loaded

### Check the logs
Look for these messages in the bot output:
```
[INFO] main | Loaded 6 known infra wallets from environment
[INFO] absorption-detector | ✅ Seeded 6 pre-configured infra wallets into database
[INFO] absorption-detector | ✅ Loaded 6 known infra wallets from database
```

### Check the database
```bash
psql "postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader" \
  -c "SELECT address, behavior_type, confidence_score, notes FROM infra_wallets WHERE notes LIKE '%Pre-configured%';"
```

Expected output:
```
                address                | behavior_type | confidence_score |                  notes                   
---------------------------------------+---------------+------------------+------------------------------------------
 eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q... | unknown       |              100 | Pre-configured infra wallet from environment
 Ar2Y6o1QmrRAskjii1cRfijeKugHH13ycx... | unknown       |              100 | Pre-configured infra wallet from environment
 ...
```

---

## How Pre-Seeded Wallets Work

### Confidence Score
- **Pre-seeded wallets start with confidence score = 100**
- This is the maximum confidence (fully trusted)
- They are treated as confirmed infra wallets immediately

### Behavior Classification
- Initial behavior type: `unknown`
- The `InfraClassifier` will analyze their trading patterns
- After 10+ trades, they'll be classified as:
  - `defensive` (buy-heavy, quick response)
  - `cyclical` (balanced buy/sell, regular intervals)
  - `aggressive` (high frequency, large size)
  - `passive` (low activity)

### Absorption Detection
- When a large sell occurs (1–3% of pool liquidity)
- If a pre-seeded wallet buys ≥50% within 30 seconds
- **Absorption is confirmed immediately** (no need to prove repeatability)
- Signal is generated for entry evaluation

---

## Current Pre-Seeded Wallets

Based on your request, these 6 wallets are configured:

1. `eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q5YbKQ9sUf`
2. `Ar2Y6o1QmrRAskjii1cRfijeKugHH13ycxW5cd7rro1x`
3. `ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT`
4. `5eKXMMPUQBN1utwx9Vsqz5ZfGbSSAm7GL1Jzy5eexbyv`
5. `FSkmRPArUnFFGZuRUdZ1W7vh5Hm7KqgjDQ19UBjW2kbC`
6. `7jDVmS8HBdDNdtGXSxepjcktvG6FzbPurZvYUVgY7TG5`

**Note:** Wallet #3 appears twice in your original list, so there are 6 unique wallets.

---

## Adding More Wallets Later

### Option 1: Add to `.env` (Recommended)
```bash
# Add new wallet
Known_Infra_Wallets_7=NewWalletAddressHere
```

Then restart the bot.

### Option 2: Add directly to database
```sql
INSERT INTO infra_wallets (
  address, 
  behavior_type, 
  confidence_score, 
  notes
) VALUES (
  'NewWalletAddressHere',
  'unknown',
  100,
  'Manually added infra wallet'
);
```

No restart needed, but wallet won't be loaded until next restart.

---

## Removing Wallets

### Option 1: Blacklist (Recommended)
```sql
UPDATE infra_wallets 
SET is_blacklisted = true 
WHERE address = 'WalletToRemove';
```

Blacklisted wallets are ignored by the bot.

### Option 2: Delete from database
```sql
DELETE FROM infra_wallets 
WHERE address = 'WalletToRemove';
```

Also remove from `.env` to prevent re-seeding.

---

## Troubleshooting

### Wallets not loading
**Check logs for errors:**
```bash
grep "Failed to seed" /tmp/infra-bot-final.log
grep "Failed to load" /tmp/infra-bot-final.log
```

**Common issues:**
- Database not running
- Invalid wallet addresses
- Missing `.env` file
- Typo in environment variable names

### Wallets not appearing in database
**Verify environment variables:**
```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/infra-signal-bot
node -e "require('dotenv').config({path: '../../../.env'}); console.log(process.env.Known_Infra_Wallets_1)"
```

Should output the wallet address.

### Duplicate wallets
The system uses `ON CONFLICT (address) DO UPDATE` to prevent duplicates.
If a wallet already exists, it's just updated with `updated_at = NOW()`.

---

## Best Practices

### 1. Verify wallets before adding
- Check on Solscan/Solana Explorer
- Confirm they're active on DEXs
- Verify they show defensive behavior

### 2. Start with a small list
- Don't add 50+ wallets at once
- Start with 5–10 proven wallets
- Add more as you discover them

### 3. Monitor performance
- Track which wallets generate profitable signals
- Remove wallets that consistently fail
- Use the attribution engine to analyze

### 4. Keep `.env` backed up
- Your wallet list is valuable
- Back up `.env` regularly
- Don't commit to git (already in `.gitignore`)

---

## System Philosophy

> **We do not trade because infra wallets trade.**  
> **We trade when infra behavior makes risk asymmetric.**

Pre-seeded wallets are **context providers**, not triggers:
- Their trades are observed, not copied
- Their absorption behavior is a signal, not a command
- They must still pass stabilization gates before entry

See `SYSTEM-PHILOSOPHY.md` for full details.

---

**Last Updated:** December 26, 2025


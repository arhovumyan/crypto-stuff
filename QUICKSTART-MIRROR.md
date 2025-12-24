# 🚀 Quick Start: Wallet Mirror Trading

Copy trades from leader wallets with a fixed $0.10 buy amount!

## Prerequisites

✅ PostgreSQL running on `localhost:5432`
✅ Database `copytrader` created
✅ Redis running on `localhost:6379` (optional)
✅ Node.js 18+ installed

## Step 1: Configure .env

Edit `.env` in the project root:

```env
# Required: Wallets to watch (comma-separated, no spaces)
WATCH_ADDRESSES=5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6,C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38

# Required: Your trading wallet (12-word seed phrase)
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase goes here

# Trading mode (start with false to test!)
ENABLE_LIVE_TRADING=false

# Optional: Blacklist tokens
BLACKLIST_TOKENS=3SaU3piu8Pc2hJfpqGx2fr8ZBJJFm9QdTvmsvbeipump

# Helius API (already configured in your .env)
HELIUS_API_KEY=99d782b2-3a53-421e-a40a-19cb4157acd5
```

## Step 2: Install Dependencies

```bash
cd services/wallet-mirror
npm install
```

## Step 3: Initialize Database

```bash
# From project root
psql -U copytrader -d copytrader -f database/schema.sql
```

## Step 4: Run Both Programs

### Terminal 1: Start the Listener

```bash
cd services/wallet-mirror
npm run listener
```

You should see:
```
╔══════════════════════════════════════════════════╗
║   🔍 Wallet Watch Listener Starting...          ║
╚══════════════════════════════════════════════════╝

Loaded 2 wallet(s) to watch:
  - 5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6
  - C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38

✅ Database connected
✅ Listener is running. Checking every 2 minutes...
```

### Terminal 2: Start the Executor

```bash
cd services/wallet-mirror
npm run executor
```

You should see:
```
╔══════════════════════════════════════════════════╗
║   💰 Mirror Executor Starting...                ║
╚══════════════════════════════════════════════════╝

Trading Mode: 📝 PAPER
Fixed Buy Amount: $0.1
✅ Database connected
✅ Executor is running. Checking for new trades every 2 minutes...
```

## What Happens Next?

### When a Leader Buys
1. 🔍 Listener detects the transaction
2. 💾 Stores it in database
3. 🎯 Executor sees the new trade
4. 💰 Buys $0.10 worth of the same token
5. ✅ Logs the result

**Example Output:**
```
[WATCH-LISTENER] 🟢 BUY DETECTED
═══════════════════════════════════════════════════════════
Wallet:     5XvRrfXa7...K6
Token:      BONK (DezXAZ8z7...)
Amount:     0.5000 SOL ↔ 15000.00 BONK
═══════════════════════════════════════════════════════════
```

```
[MIRROR-EXECUTOR] 🎯 Processing BUY: BONK
═══════════════════════════════════════════════════════════
Leader:  5XvRrfXa7...
💰 Buying 0.000500 SOL (~$0.10) worth of BONK
📝 PAPER TRADE - Not executing real transaction
═══════════════════════════════════════════════════════════
```

### When a Leader Sells
1. 🔍 Listener detects the sell
2. 💾 Stores it in database  
3. 🎯 Executor sees the sell
4. 💼 Checks your position
5. 🔴 Sells your entire position
6. ✅ Logs the result

## Enable Live Trading

Once you've tested and everything works:

1. **Stop both programs** (Ctrl+C)
2. Edit `.env`:
   ```env
   ENABLE_LIVE_TRADING=true
   ```
3. **Make sure you have SOL** in your wallet
4. **Restart both programs**

## Check Your Wallet Balance

```bash
# Install Solana CLI if you haven't
solana balance <YOUR_WALLET_ADDRESS>
```

You need at least 0.1 SOL to start trading (plus some for fees).

## Monitor the Database

```bash
# View detected trades
psql -U copytrader -d copytrader -c "SELECT * FROM leader_trades ORDER BY id DESC LIMIT 10;"

# View your copy attempts
psql -U copytrader -d copytrader -c "SELECT * FROM copy_attempts ORDER BY id DESC LIMIT 10;"
```

## Common Issues

### "No WATCH_ADDRESSES found"
→ Make sure `WATCH_ADDRESSES` is set in `.env` with valid wallet addresses

### "No wallet configured"
→ Add `COPY_WALLET_SEED_PHRASE` to `.env` for live trading

### "Database connection failed"
→ Check PostgreSQL is running: `pg_isready`
→ Verify `DATABASE_URL` in `.env`

### "No new transactions"
→ Leader wallets might not be trading
→ Wait 2+ minutes for first check
→ Check listener logs for errors

## Stop the Programs

Press `Ctrl+C` in each terminal to stop gracefully.

## Background Running (Optional)

### Using screen

```bash
# Terminal 1
screen -S listener
cd services/wallet-mirror && npm run listener
# Press Ctrl+A then D to detach

# Terminal 2  
screen -S executor
cd services/wallet-mirror && npm run executor
# Press Ctrl+A then D to detach

# Reattach later
screen -r listener
screen -r executor
```

### Using tmux

```bash
tmux new -s mirror
# Split window: Ctrl+B then "
# Top pane: npm run listener
# Bottom pane: npm run executor
# Detach: Ctrl+B then D
```

## Next Steps

1. ✅ Test in paper mode first
2. ✅ Watch for a few trades
3. ✅ Check database records
4. ✅ Enable live trading
5. ✅ Monitor your wallet balance
6. ✅ Adjust blacklist as needed

## Need Help?

Check the detailed documentation:
- [services/wallet-mirror/MIRROR-README.md](services/wallet-mirror/MIRROR-README.md)
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)

## ⚠️ Important Reminders

- Start with `ENABLE_LIVE_TRADING=false` to test
- Each buy is fixed at $0.10 worth of SOL
- Sells are full position (all your tokens)
- Blacklisted tokens are skipped
- Checks every 2 minutes (not real-time)
- Only mirrors LIVE trades (not historical)

Happy Trading! 🚀

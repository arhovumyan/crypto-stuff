# Environment Setup Guide - Quick Fix for 401 Error

## Problem: WebSocket 401 Unauthorized Error

If you're seeing this error:
```
ERROR: trade-feed | WebSocket error: Unexpected server response: 401
```

**This means your `HELIUS_API_KEY` is missing or invalid.**

---

## Solution: Add HELIUS_API_KEY to .env

### Step 1: Get a Helius API Key

1. Go to https://helius.dev
2. Sign up or log in
3. Create a new API key (free tier is fine for testing)
4. Copy the API key

### Step 2: Add to .env File

Open `/Users/aro/Documents/Trading/CopyTrader/.env` and add:

```bash
HELIUS_API_KEY=your_actual_api_key_here
```

**Example:**
```bash
HELIUS_API_KEY=abc123-def456-ghi789-jkl012
```

### Step 3: Verify It's Set

```bash
# From project root
cd /Users/aro/Documents/Trading/CopyTrader
grep HELIUS_API_KEY .env
```

You should see your API key printed.

### Step 4: Restart the Bot

```bash
cd services/infra-signal-bot
npm run dev
```

---

## Full .env Example

Your `.env` file should have at least these variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/copytrader

# Wallet
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase here

# Helius (REQUIRED)
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here
HELIUS_WS_URL=wss://mainnet.helius-rpc.com

# Jupiter (optional, for live trading)
JUPITER_API_KEY=your_jupiter_key_here

# Trading Mode (optional, defaults to paper trading)
PAPER_TRADING_MODE=true
ENABLE_LIVE_TRADING=false
```

---

## Common Issues

### Issue 1: "HELIUS_API_KEY is required" error on startup
**Solution:** Add `HELIUS_API_KEY` to your `.env` file (see above)

### Issue 2: 401 Unauthorized even with API key set
**Possible causes:**
- API key is invalid (regenerate on helius.dev)
- API key has expired (check your Helius dashboard)
- API key doesn't have WebSocket permissions (use a different key)
- Extra spaces in `.env` file (make sure no spaces around `=`)

**Fix:**
```bash
# Wrong (has spaces)
HELIUS_API_KEY = abc123

# Correct (no spaces)
HELIUS_API_KEY=abc123
```

### Issue 3: 429 Rate Limit errors
**Solution:** 
- Upgrade your Helius tier
- Or temporarily use a public RPC (slower):
  ```bash
  HELIUS_RPC_URL=https://api.mainnet-beta.solana.com
  ```

---

## Quick Checklist

Before running the bot, make sure:

- [ ] `.env` file exists at project root
- [ ] `HELIUS_API_KEY` is set in `.env`
- [ ] `DATABASE_URL` is set and database is running
- [ ] `COPY_WALLET_SEED_PHRASE` is set
- [ ] No extra spaces in `.env` file
- [ ] API key is valid (test on helius.dev dashboard)

---

## Test Your Setup

```bash
# 1. Check .env file
cd /Users/aro/Documents/Trading/CopyTrader
cat .env | grep HELIUS_API_KEY

# 2. Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# 3. Run the bot
cd services/infra-signal-bot
npm run dev
```

If you see:
```
INFO: trade-feed | Connecting to Helius WebSocket...
INFO: trade-feed | WebSocket connected
```

✅ You're good to go!

---

## Still Having Issues?

1. **Regenerate your Helius API key** on helius.dev
2. **Check Helius dashboard** for API key status
3. **Verify no rate limits** on your account
4. **Try a different RPC provider** temporarily

---

## Need Help?

Common error messages and solutions:

| Error | Solution |
|-------|----------|
| `401 Unauthorized` | Add/fix `HELIUS_API_KEY` in `.env` |
| `429 Too Many Requests` | Upgrade Helius tier or use public RPC |
| `HELIUS_API_KEY is required` | Add to `.env` file |
| `WebSocket closed: 1006` | Usually follows a 401, fix API key |
| `Database connection failed` | Check `DATABASE_URL` and PostgreSQL is running |

---

**Bottom line:** The bot needs a valid `HELIUS_API_KEY` in your `.env` file to work.


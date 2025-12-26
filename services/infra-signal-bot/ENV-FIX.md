# URGENT FIX: WebSocket 401 Error

## The Problem

Your `.env` file has **BOTH** of these:

```bash
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=YOUR_KEY
```

This causes the bot to create a malformed URL like:
```
wss://mainnet.helius-rpc.com/?api-key=KEY1/?api-key=KEY2
```

Which gives a 401 error.

---

## The Fix

**Option 1: Remove API key from HELIUS_WS_URL (Recommended)**

Edit your `.env` file:

```bash
# WRONG (has api-key in URL)
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=ef1c434e-a18d-4cb2-8085-29b5fb701843

# CORRECT (no api-key in URL)
HELIUS_WS_URL=wss://mainnet.helius-rpc.com
HELIUS_API_KEY=ef1c434e-a18d-4cb2-8085-29b5fb701843
```

**Option 2: Remove HELIUS_API_KEY (Alternative)**

If you want to keep the API key in the URL:

```bash
# Keep the full URL with API key
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=ef1c434e-a18d-4cb2-8085-29b5fb701843

# Remove this line (or leave it, the code now handles both)
# HELIUS_API_KEY=ef1c434e-a18d-4cb2-8085-29b5fb701843
```

---

## Recommended .env Setup

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/copytrader

# Wallet
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase here

# Helius RPC (with API key in URL)
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE

# Helius WebSocket (NO API key in URL)
HELIUS_WS_URL=wss://mainnet.helius-rpc.com

# Helius API Key (separate)
HELIUS_API_KEY=YOUR_KEY_HERE

# Trading Mode
PAPER_TRADING_MODE=true
ENABLE_LIVE_TRADING=false
```

---

## Quick Fix Command

```bash
# Edit your .env file
nano /Users/aro/Documents/Trading/CopyTrader/.env

# Change this line:
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=...

# To this:
HELIUS_WS_URL=wss://mainnet.helius-rpc.com

# Save and exit (Ctrl+X, then Y, then Enter)

# Restart the bot
cd /Users/aro/Documents/Trading/CopyTrader/services/infra-signal-bot
npm run dev
```

---

## After the Fix

You should see:

```
✅ WebSocket connected
📡 Subscribing to DEX programs...
✅ Subscription confirmed: ID 12345
📊 Processing transactions: 10 total
```

Instead of:

```
❌ WebSocket error: Unexpected server response: 401
```

---

**The code now handles both cases automatically, but it's cleaner to keep them separate.**


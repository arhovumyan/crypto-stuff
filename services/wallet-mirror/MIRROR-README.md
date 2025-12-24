# Wallet Mirror Service

A complete copy trading system that mirrors transactions from leader wallets (WATCH_ADDRESSES) with a fixed $0.10 buy amount.

## Overview

This service consists of two independent programs that work together:

1. **Wallet Watch Listener** - Monitors wallets from `WATCH_ADDRESSES` and records their live transactions
2. **Mirror Executor** - Copies those trades with a fixed $0.10 buy amount

## Features

✅ **Live Transaction Monitoring** - Only copies trades happening while the program is running
✅ **Fixed Buy Amount** - Always buys $0.10 worth (in SOL) of any token they buy
✅ **Automatic Selling** - Sells when the leader sells
✅ **2-Minute Polling** - Checks for new transactions every 2 minutes
✅ **Blacklist Support** - Respects blacklisted tokens from `.env`
✅ **Paper Trading Mode** - Test without real trades
✅ **Position Tracking** - Knows what you own and sells accordingly

## Setup

### 1. Configure Environment Variables

Make sure your `.env` file (in project root) has:

```env
# Wallets to watch and mirror
WATCH_ADDRESSES=wallet1,wallet2,wallet3

# Your trading wallet (REQUIRED for live trading)
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase here

# Trading mode
ENABLE_LIVE_TRADING=false  # Set to true for live trading
FIXED_BUY_AMOUNT_SOL=0.1   # Not used by this service (fixed at $0.10)

# Blacklisted tokens (comma-separated)
BLACKLIST_TOKENS=TokenAddress1,TokenAddress2

# API Keys
HELIUS_API_KEY=your-helius-api-key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-key
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=your-key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/copytrader
```

### 2. Install Dependencies

```bash
cd services/wallet-mirror
npm install
```

### 3. Setup Database

Make sure your PostgreSQL database is running and initialized with the schema:

```bash
psql -U copytrader -d copytrader -f ../../database/schema.sql
```

## Usage

You need to run BOTH programs in separate terminals:

### Terminal 1: Start the Listener

```bash
cd services/wallet-mirror
npm run listener
```

Or use the helper script:
```bash
./start-listener.sh
```

This will:
- Monitor all wallets in `WATCH_ADDRESSES`
- Detect when they buy or sell tokens
- Store transactions in the database
- Check every 2 minutes for new transactions

### Terminal 2: Start the Executor

```bash
cd services/wallet-mirror
npm run executor
```

Or use the helper script:
```bash
./start-executor.sh
```

This will:
- Check database every 2 minutes for new trades
- Mirror BUY trades with fixed $0.10 amount
- Mirror SELL trades (sells your entire position)
- Execute trades via Jupiter aggregator

## How It Works

### When a Leader BUYS a Token

1. **Listener** detects the transaction and stores it in database
2. **Executor** sees the new trade in database
3. **Executor** calculates: `$0.10 / SOL_price = amount of SOL to spend`
4. **Executor** gets a Jupiter quote to swap that amount of SOL for the token
5. **Executor** executes the swap and tracks your position

**Example:**
- Leader buys 100 SOL worth of TOKEN_X
- You buy $0.10 worth (≈ 0.0005 SOL) of TOKEN_X

### When a Leader SELLS a Token

1. **Listener** detects the sell transaction
2. **Executor** checks if you have a position in that token
3. **Executor** sells your ENTIRE position back to SOL
4. **Executor** updates your position tracking

**Example:**
- Leader sells their TOKEN_X position
- You sell ALL of your TOKEN_X tokens

## Trading Modes

### Paper Trading (Safe Mode)
```env
ENABLE_LIVE_TRADING=false
```
- Logs what it WOULD do
- No real transactions
- Perfect for testing

### Live Trading
```env
ENABLE_LIVE_TRADING=true
```
- Executes real swaps
- Uses your SOL balance
- Make sure you have enough SOL!

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `WATCH_ADDRESSES` | Comma-separated wallet addresses to mirror | Required |
| `ENABLE_LIVE_TRADING` | Enable real transactions | `false` |
| `BLACKLIST_TOKENS` | Comma-separated token mints to skip | Empty |
| `COPY_WALLET_SEED_PHRASE` | Your 12-word seed phrase | Required for live trading |
| `HELIUS_API_KEY` | Helius API key for transaction parsing | Required |

## Safety Features

1. **Blacklist Protection** - Won't trade blacklisted tokens
2. **Paper Trading** - Test without risk
3. **Position Tracking** - Only sells what you own
4. **Error Handling** - Logs errors, continues running
5. **Fixed Amount** - Can't accidentally spend too much

## Monitoring

Both programs provide detailed logging:

```
[WATCH-LISTENER] 🟢 BUY DETECTED
Wallet:     5XvRrfXa7...K6
Token:      BONK (DezXAZ8z7...)
Amount:     0.5000 SOL ↔ 15000.00 BONK
```

```
[MIRROR-EXECUTOR] 🎯 Processing BUY: BONK
Leader:  5XvRrfXa7...
Token:   DezXAZ8z7...
💰 Buying 0.000500 SOL (~$0.10) worth of BONK
✅ BUY executed! Signature: 3Hj8x...
```

## Troubleshooting

### "No WATCH_ADDRESSES found"
- Make sure `WATCH_ADDRESSES` is set in your `.env` file
- Check that wallet addresses are comma-separated with no spaces

### "No wallet configured"
- You need `COPY_WALLET_SEED_PHRASE` in `.env` for live trading
- Verify it's a valid 12-word seed phrase

### "Failed to get Jupiter quote"
- Check your RPC connection
- Token might have low liquidity
- Try increasing slippage tolerance in code

### "No position to sell"
- You haven't bought this token yet
- Position tracking might be out of sync
- Check database `copy_attempts` table

## Database Schema

The service uses these tables:

- `leader_trades` - Detected trades from watched wallets
- `copy_attempts` - Your mirror trade attempts and results
- `followed_wallets` - Wallet configuration (optional)

## Architecture

```
┌─────────────────────┐
│  WATCH_ADDRESSES    │
│   (Leader Wallets)  │
└──────────┬──────────┘
           │
           │ (2min polling)
           ▼
┌─────────────────────┐
│  Wallet Watch       │
│  Listener           │
│  (Terminal 1)       │
└──────────┬──────────┘
           │
           │ writes to
           ▼
┌─────────────────────┐
│  PostgreSQL         │
│  Database           │
│  (leader_trades)    │
└──────────┬──────────┘
           │
           │ reads from
           ▼
┌─────────────────────┐
│  Mirror Executor    │
│  (Terminal 2)       │
└──────────┬──────────┘
           │
           │ executes via
           ▼
┌─────────────────────┐
│  Jupiter Aggregator │
│  (Solana DEXs)      │
└─────────────────────┘
```

## Advanced Usage

### Run in Background

Using `screen` or `tmux`:

```bash
# Terminal 1
screen -S listener
cd services/wallet-mirror
npm run listener
# Press Ctrl+A, then D to detach

# Terminal 2
screen -S executor
cd services/wallet-mirror
npm run executor
# Press Ctrl+A, then D to detach

# Reattach later
screen -r listener
screen -r executor
```

### Monitor Both Processes

```bash
# In another terminal
tail -f services/wallet-mirror/logs/listener.log
tail -f services/wallet-mirror/logs/executor.log
```

## Support

For issues or questions:
1. Check the logs for error messages
2. Verify `.env` configuration
3. Test with `ENABLE_LIVE_TRADING=false` first
4. Check database connection

## License

Part of the Solana Copy Trader project.

# 10 Dollar Monster

A specialized monitoring service that watches specific wallet addresses and automatically purchases $10 worth of any new token they swap into, then shuts down.

## Features

- 🎯 **Fixed Purchase Amount**: Always buys exactly $10 worth of SOL in each token
- 👀 **Direct Wallet Monitoring**: Watches specific wallet addresses directly (not from database)
- ⏱️ **1-Minute Interval**: Checks monitored wallets every 60 seconds
- 🔄 **One-Time Purchase**: Buys once and shuts down after detecting a swap
- 🛑 **Auto-Shutdown**: Service stops automatically after executing the purchase
- 🔒 **Same Wallet**: Uses the same copy wallet as the copy-executor service
- 📝 **Purchase Tracking**: Records all purchase attempts in the database

## How It Works

1. Monitors specific wallet addresses you provide (comma-separated in env)
2. Checks every 60 seconds for new SOL → Token swaps from any monitored address
3. When a swap is detected, executes a $10 SOL swap to the same token
4. Records the purchase in `ten_dollar_purchases` table
5. **Automatically shuts down** after the purchase

## Setup

1. Install dependencies:
```bash
npm install
```

2. Make sure your `.env` file at the project root contains:
```env
DATABASE_URL=your_database_url
HELIUS_RPC_URL=your_helius_rpc_url
JUPITER_API_KEY=your_jupiter_api_key
COPY_WALLET_SEED_PHRASE=your_wallet_seed_phrase
ENABLE_LIVE_TRADING=false  # Set to 'true' for live trading

# Comma-separated list of wallet addresses to monitor
WATCH_ADDRESSES=wallet1_address,wallet2_address,wallet3_address
```

3. The service will automatically create the `ten_dollar_purchases` table on first run.

## Running

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## Example Configuration

```env
WATCH_ADDRESSES=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1
```

The service will monitor both addresses and execute a $10 buy when either makes a swap.

## API Usage for Multiple Addresses

**WebSocket subscriptions**: Monitoring multiple addresses with `getSignaturesForAddress` in the same service instance is very efficient. The RPC calls are made sequentially but use minimal resources. Helius and most RPC providers charge per request, not per address monitored.

For best efficiency, all addresses are checked in the same 60-second interval with minimal API overhead.

## Database Schema

The service creates a `ten_dollar_purchases` table:

```sql
CREATE TABLE ten_dollar_purchases (
  id SERIAL PRIMARY KEY,
  leader_trade_id INTEGER NOT NULL,
  leader_wallet TEXT NOT NULL,
  leader_signature TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  sol_amount DECIMAL(20, 9) NOT NULL,
  our_signature TEXT,
  status TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(token_mint)
);
```

## Paper Trading vs Live Trading

- **Paper Trading** (default): Simulates purchases without executing real transactions
- **Live Trading**: Set `ENABLE_LIVE_TRADING=true` in your `.env` file

## Requirements

- At least 10.1 SOL in your copy wallet (10 SOL for purchase + 0.1 SOL buffer for fees)
- Valid Jupiter API key for swaps
- Wallet addresses to monitor in WATCH_ADDRESSES

## Important Notes

- ⚠️ Service **automatically shuts down** after executing a swap
- ⚠️ You need to **restart the service** manually for the next monitoring session
- ⚠️ Only detects **SOL → Token** swaps (buys only)
- ⚠️ Does **not** perform selling operations

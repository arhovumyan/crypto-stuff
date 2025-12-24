# Solana Copy Trading Bot - Phase 1 (Listener & Recorder)

A real-time Solana transaction listener that monitors leader wallets and records all their trades to PostgreSQL.

## Prerequisites

- Node.js 20+
- Docker Desktop (for PostgreSQL and Redis)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Infrastructure

```bash
npm run docker:up
```

This starts PostgreSQL and Redis in Docker containers and automatically creates the database schema.

### 4. Run the Listener

```bash
npm run dev
```

You should see:
```
🚀 Starting Solana Copy Trader - Listener Service
✅ Redis connected
✅ WebSocket connected
📋 Found 5 followed wallets
👀 Now monitoring wallet BiiduLC...
👀 Now monitoring wallet 5aLY85p...
...
```

## Project Structure

```
CopyTrader/
├── packages/
│   └── shared/           # Shared utilities
│       ├── config.ts     # Environment validation
│       ├── logger.ts     # Pino logger

```bash
docker-compose up -d
```

This starts PostgreSQL and Redis containers in the background.

### 3. Build & Run

```bash
npm run build
npm run dev
```

The bot will:
- Connect to Solana via Helius WebSocket
- Monitor 5 leader wallets in real-time
- Detect all swaps/trades automatically
- Save everything to PostgreSQL database

## Monitoring Trades

### View Live Logs

Logs appear in the terminal where you ran `npm run dev`:

```
SWAP DETECTED | Signature: 3Av... | Wallet: Bii... | Sold: 0.512 SOL | Bought: 2.8M tokens
TRADE SAVED | ID: 25 | Time: 2025-12-23T21:32:29.000Z | Wallet: Bii... | Token In: SOL...
```

### View Saved Trades

```bash
# View last 10 trades (formatted)
npx tsx scripts/view-trades.ts

# View last 50 trades
npx tsx scripts/view-trades.ts 50

# Query database directly
docker exec copytrader-postgres psql -U copytrader -d copytrader -c "SELECT * FROM leader_trades ORDER BY block_time DESC LIMIT 5;"
```

### Check Database Connection

```bash
# Interactive PostgreSQL session
docker exec -it copytrader-postgres psql -U copytrader -d copytrader

# Once inside, run queries:
# \dt                    -- List all tables
# SELECT COUNT(*) FROM leader_trades;  -- Total trades saved
# \q                     -- Exit
```

## What Gets Saved

Every trade records:
- Leader wallet address
- Transaction signature (unique ID)
- Blockchain slot number
- Exact timestamp
- Token sold (mint address, symbol, amount)
- Token bought (mint address, symbol, amount)
- DEX used (Jupiter, pump.fun, etc.)
- Full transaction metadata (JSON)

## Configuration

Edit `.env` to:
- Add/remove leader wallets to monitor
- Change Helius API key
- Modify database credentials

```env
# Leader Wallets (comma-separated, no spaces)
LEADER_WALLETS=wallet1,wallet2,wallet3

# Helius RPC
HELIUS_API_KEY=your_api_key_here

# Database
DATABASE_URL=postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader
```

## Stopping the Bot

```bash
# Stop the Node.js process
Ctrl+C in the terminal

# Stop Docker containers
docker-compose down

# Stop but keep data
docker-compose stop
```

## Troubleshooting

### Bot not detecting trades
- Check if leader wallets are active (making trades)
- Verify Helius API key is valid
- Check WebSocket connection in logs

### Database errors
```bash
# Restart PostgreSQL
docker-compose restart copytrader-postgres

# Check container status
docker ps --filter "name=copytrader"
```

### Build errors
```bash
# Clean rebuild
rm -rf dist node_modules
npm install
npm run build
```

## Architecture

```
services/listener/          # Main bot service
├── websocket-manager.ts   # Helius WebSocket connection
├── transaction-parser.ts  # Detects swaps from transactions
├── trade-recorder.ts      # Saves to PostgreSQL
└── listener-service.ts    # Orchestrates everything

packages/shared/           # Shared utilities
├── logger.ts             # Logging configuration
├── config.ts             # Environment variables
├── database.ts           # PostgreSQL connection
└── redis.ts              # Redis (idempotency)

database/schema.sql        # Database tables
docker-compose.yml         # PostgreSQL + Redis
```

## Current Status

✅ **Phase 1 Complete** - Listener & Recorder fully operational
- Real-time trade detection working
- Database storage confirmed
- 5 leader wallets monitored
- All trades automatically saved

⏳ **Phase 2** - Risk Engine & Jupiter Integration (not started)
⏳ **Phase 3** - Live Execution (not started)

## Database Tables

- `followed_wallets` - Leader wallets being monitored
- `leader_trades` - All detected trades (main table)
- `copy_attempts` - For Phase 2 (copying trades)
- `positions` - For Phase 2 (tracking open positions)
- `risk_events` - For Phase 2 (risk management)

## Notes

- Trades are detected via delta-based parsing (works with ANY DEX)
- Redis prevents duplicate processing (7-day cache)
- Database port: 5432
- Redis port: 6379
- All data persists in Docker volumes


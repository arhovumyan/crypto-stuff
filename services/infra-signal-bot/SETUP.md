# Setup Guide - Infrastructure Signal Bot

## Step 1: Database Setup

You need to create the database tables for the bot. The command uses `$DATABASE_URL` which is an environment variable.

### Option A: If you already have DATABASE_URL in your .env file

```bash
# From the project root directory
cd /Users/aro/Documents/Trading/CopyTrader

# Load the environment variable and run the schema
psql $DATABASE_URL < database/infra-signal-schema.sql
```

### Option B: If you don't have DATABASE_URL set, use the full connection string

Replace with your actual database credentials:

```bash
# Format: postgresql://username:password@host:port/database_name
psql postgresql://your_username:your_password@localhost:5432/copytrader < database/infra-signal-schema.sql
```

**Example:**
```bash
psql postgresql://postgres:mypassword@localhost:5432/copytrader < database/infra-signal-schema.sql
```

### Option C: If you're using a remote database (like Supabase, Railway, etc.)

```bash
# Use your full connection string from the service dashboard
psql "postgresql://postgres.xxxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres" < database/infra-signal-schema.sql
```

**To verify it worked:**
```bash
psql $DATABASE_URL -c "\dt infra_*"
```

You should see tables like `infra_wallets`, `large_sell_events`, `infra_signals`, etc.

---

## Step 2: Environment Variables

Create or edit your `.env` file in the project root (`/Users/aro/Documents/Trading/CopyTrader/.env`):

### Minimum Required Variables

```bash
# Database connection (same as you use for other services)
DATABASE_URL=postgresql://username:password@localhost:5432/copytrader

# Solana RPC endpoint (Helius recommended)
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com
HELIUS_API_KEY=your_helius_api_key_here

# Your trading wallet seed phrase (12 or 24 words)
COPY_WALLET_SEED_PHRASE="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
```

### Optional - Customize Bot Behavior

```bash
# Trading amounts
BUY_AMOUNT_SOL=0.1              # How much SOL to spend per trade

# Entry thresholds
MIN_SIGNAL_STRENGTH=60          # Signal quality (0-100, higher = stricter)
MAX_CONCURRENT_POSITIONS=3      # Max open positions at once

# Exit targets
TAKE_PROFIT_PCT=15              # Sell when up +15%
STOP_LOSS_PCT=8                 # Sell when down -8%

# Detection sensitivity
MIN_SELL_LIQUIDITY_PCT=1        # Min sell size to detect (1% of pool)
MAX_SELL_LIQUIDITY_PCT=3        # Max sell size to detect (3% of pool)
```

### Trading Mode (IMPORTANT - Start with Paper Trading!)

```bash
# Paper trading (simulated, no real money)
ENABLE_LIVE_TRADING=false
PAPER_TRADING_MODE=true

# When ready for live trading, change to:
# ENABLE_LIVE_TRADING=true
# PAPER_TRADING_MODE=false
# JUPITER_API_KEY=your_jupiter_api_key  # Required for live trading
```

---

## Step 3: Get API Keys (if you don't have them)

### Helius API Key (for WebSocket streaming)
1. Go to https://helius.dev
2. Sign up / Log in
3. Create a new API key
4. Copy it to `HELIUS_API_KEY` in your `.env`

### Jupiter API Key (only needed for live trading)
1. Go to https://station.jup.ag
2. Sign up for API access
3. Get your API key
4. Add to `.env` as `JUPITER_API_KEY`

---

## Step 4: Start the Bot

### Development Mode (with auto-reload)

```bash
cd services/infra-signal-bot
npm run dev
```

### Production Mode

```bash
cd services/infra-signal-bot
npm run build
npm start
```

---

## Step 5: What to Expect

When the bot starts, you'll see:

```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║            🔮 INFRASTRUCTURE SIGNAL TRADING BOT 🔮                        ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

⚙️  CONFIGURATION
═══════════════════════════════════════════════════════════════
Trading Mode:         📝 PAPER
Buy Amount:           0.1 SOL
...
```

### In Paper Trading Mode, you'll see:
- `🔴 LARGE SELL DETECTED` - When a significant sell happens
- `✅ ABSORPTION CONFIRMED` - When infra wallets buy back
- `✅ STABILIZATION CONFIRMED` - When price stabilizes
- `📝 PAPER TRADE EXECUTED` - Simulated trades (no real money)

### The bot will NOT execute real trades until you:
1. Set `ENABLE_LIVE_TRADING=true`
2. Set `PAPER_TRADING_MODE=false`
3. Add `JUPITER_API_KEY` to your `.env`

---

## Troubleshooting

### "DATABASE_URL not found"
- Make sure your `.env` file is in the project root
- Check that `DATABASE_URL` is set correctly
- Try using the full connection string in the psql command instead

### "COPY_WALLET_SEED_PHRASE not found"
- Add your seed phrase to `.env`
- Make sure it's in quotes: `COPY_WALLET_SEED_PHRASE="word1 word2 ..."`

### "WebSocket connection failed"
- Check your `HELIUS_API_KEY` is correct
- Verify `HELIUS_WS_URL` is set
- Make sure you have Helius API credits

### "No sells detected"
- This is normal if there's no market activity
- Lower `MIN_SELL_LIQUIDITY_PCT` to detect smaller sells
- Check that WebSocket is connected (look for "WebSocket connected" in logs)

---

## Quick Start Checklist

- [ ] Database schema applied (`psql $DATABASE_URL < database/infra-signal-schema.sql`)
- [ ] `.env` file created with `DATABASE_URL`, `HELIUS_RPC_URL`, `COPY_WALLET_SEED_PHRASE`
- [ ] `ENABLE_LIVE_TRADING=false` (paper trading mode)
- [ ] `PAPER_TRADING_MODE=true`
- [ ] Run `npm run dev` from `services/infra-signal-bot/`
- [ ] See "INFRA SIGNAL BOT IS LIVE!" message
- [ ] Monitor logs for signal generation

Once you see signals being generated in paper mode, you can consider enabling live trading with small amounts first!


# 📘 Complete Guide: Running Listener & Copy-Executor

This guide explains how to run the **listener** and **copy-executor** services to automatically copy trades from Solana wallets.

---

## 🎯 Overview

The system consists of two services that work together:

1. **Listener Service** (`/services/listener`) - Monitors wallets and detects trades
2. **Copy Executor** (`/services/copy-executor`) - Executes copy trades based on detected trades

### How It Works

```
Leader Wallet → [Listener] → Database → [Copy Executor] → Your Wallet
   (trades)      (detects)    (stores)     (executes)      (copies)
```

---

## 📋 Prerequisites

### 1. Required Services

- **PostgreSQL Database** - Stores detected trades and configuration
- **Redis** - Prevents duplicate transaction processing
- **Node.js** (v20+) - Runtime environment

### 2. Required API Keys

- **Helius API Key** - For Solana RPC and WebSocket connections
- **Jupiter API Key** - For executing swaps (Ultra API)

### 3. Database Setup

Run the database schema:

```bash
psql $DATABASE_URL < database/schema.sql
```

Or manually create the database and run the schema file.

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

#### Required Variables

```env
# Helius RPC & WebSocket
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/copytrader

# Redis
REDIS_URL=redis://localhost:6379

# Your Trading Wallet (for copy-executor)
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase here"
# OR
COPY_WALLET_SEED_PHREASE="your twelve word seed phrase here"  # (typo variant also supported)

# Jupiter API (for executing swaps)
JUPITER_API_KEY=your_jupiter_api_key_here
JUPITER_API_URL=https://api.jup.ag  # Default, usually don't need to change
```

#### Wallet Configuration (What Wallets to Listen To)

You can configure wallets in **two ways**:

**Option 1: Environment Variables (Easiest)**

```env
# Set up to 20 wallets using LEADER_WALLET_1 through LEADER_WALLET_20
LEADER_WALLET_1=BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
LEADER_WALLET_2=5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG
LEADER_WALLET_3=2pDhRxLSGriCnFBY4BH5YFJXUFfE1R1ZnCCdP8iMGpxk
# ... up to LEADER_WALLET_20

# OR use comma-separated list (backward compatibility)
WATCH_ADDRESSES=wallet1,wallet2,wallet3
```

**Option 2: Database (More Flexible)**

Insert wallets directly into the database:

```sql
INSERT INTO followed_wallets (address, enabled) VALUES
  ('BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM', true),
  ('5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG', true)
ON CONFLICT (address) DO NOTHING;
```

**Note:** The listener combines wallets from BOTH sources (database + .env), so you can use either or both methods.

#### Buy Amount Configuration

Configure how much to buy per trade:

**Option 1: Fixed Amount (Recommended for Testing)**

```env
# Always buy exactly this amount of SOL worth
FIXED_BUY_AMOUNT_SOL=0.1
```

**Option 2: Percentage of Leader Trade**

```env
# Buy 10% of what the leader bought
COPY_PERCENTAGE=10

# Example: If leader buys 1 SOL worth, you buy 0.1 SOL worth
```

**Option 3: Both Set (Fixed Takes Priority)**

If both are set, `FIXED_BUY_AMOUNT_SOL` takes priority.

#### Trading Mode

```env
# Set to 'true' for live trading, 'false' for paper trading (simulation)
ENABLE_LIVE_TRADING=false

# IMPORTANT: Start with false to test without spending real money!
```

#### Additional Configuration

```env
# Maximum position size per token (in SOL)
MAX_POSITION_SIZE_SOL=999999

# Blacklist specific tokens (comma-separated)
BLACKLIST_TOKENS=token1,token2,token3

# Logging level
LOG_LEVEL=info  # Options: debug, info, warn, error
```

---

## 🚀 Running the Services

### Step 1: Install Dependencies

From the project root:

```bash
npm install
```

### Step 2: Build the Services

```bash
# Build all services
npm run build

# OR build individually
cd services/listener && npm run build
cd services/copy-executor && npm run build
```

### Step 3: Start the Listener Service

**Terminal 1 - Listener:**

```bash
cd services/listener

# Production mode
npm start

# OR Development mode (auto-reload on changes)
npm run dev
```

**What to expect:**

```
Starting Solana Copy Trader - Listener Service
Connecting to Redis...
Connecting to Helius WebSocket...
Found 3 followed wallets to monitor
Now monitoring wallet: BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
Now monitoring wallet: 5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG
Listener service is running and waiting for transactions
Waiting for transactions...
```

When a trade is detected:

```
═══════════════════════════════════════════════════
🟢 BUY DETECTED
═══════════════════════════════════════════════════
Wallet:     BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
Token:      SOL → BONK
Amount:     1.0000 SOL → 1000000.000000 BONK
Signature:  5j7s8K9m...
═══════════════════════════════════════════════════
✅ Trade saved (ID: 123) | SOL → BONK | Amount: 1.0000 → 1000000.000000
```

### Step 4: Start the Copy Executor Service

**Terminal 2 - Copy Executor:**

```bash
cd services/copy-executor

# Production mode
npm start

# OR Development mode (auto-reload on changes)
npm run dev
```

**What to expect:**

```
🚀 Starting Copy Executor service...
💼 Wallet initialized | Address: 7xKXtg...
💰 Wallet ready | Balance: 5.2847 SOL
📝 PAPER TRADING MODE | Transactions will be simulated only
⚙️  Executor initialized | Mode: Fixed 0.1 SOL | Trading: 📝 PAPER | Blacklist: 0 tokens
✅ Resuming from trade ID: 0
```

When a trade is executed:

```
👀 Processing trade #123 | SOL → BONK
═══════════════════════════════════════════════════
📝 PAPER BUY EXECUTED
═══════════════════════════════════════════════════
Trade ID:   #123
Wallet:     BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
Token:      SOL → BONK
Amount:     0.100000 SOL → 100000.000000 BONK
Signature:  SIMULATED
═══════════════════════════════════════════════════
```

---

## 📊 What Wallets Are Being Listened To?

The listener monitors wallets from **two sources**:

1. **Database** (`followed_wallets` table) - Wallets with `enabled = true`
2. **Environment Variables** - `LEADER_WALLET_1` through `LEADER_WALLET_20`, or `WATCH_ADDRESSES`

**The listener combines both sources** and monitors all unique wallets.

### Check Currently Monitored Wallets

The listener displays wallet statistics on startup:

```
========== Wallet Statistics ==========
─────────────────────────────────────────────────
ENABLED | BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM | Trades: 45 | Last: 1/4/2025, 3:45:23 PM
ENABLED | 5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG | Trades: 12 | Last: 1/4/2025, 2:30:15 PM
─────────────────────────────────────────────────
```

### Add/Remove Wallets

**Add a wallet via .env:**

```env
LEADER_WALLET_4=NewWalletAddressHere
```

Then restart the listener.

**Add a wallet via database:**

```sql
INSERT INTO followed_wallets (address, enabled) 
VALUES ('NewWalletAddressHere', true)
ON CONFLICT (address) DO UPDATE SET enabled = true;
```

**Disable a wallet:**

```sql
UPDATE followed_wallets 
SET enabled = false 
WHERE address = 'WalletAddressHere';
```

**Remove a wallet:**

```sql
DELETE FROM followed_wallets 
WHERE address = 'WalletAddressHere';
```

---

## 💰 Buy Amount Configuration Explained

### Fixed Amount Mode

```env
FIXED_BUY_AMOUNT_SOL=0.1
```

- **Always buys exactly 0.1 SOL worth** of tokens
- **Independent of leader trade size**
- **Best for:** Consistent position sizing, risk management

**Example:**
- Leader buys 10 SOL worth → You buy 0.1 SOL worth
- Leader buys 0.01 SOL worth → You buy 0.1 SOL worth

### Percentage Mode

```env
COPY_PERCENTAGE=10
```

- **Buys 10% of what the leader bought**
- **Scales with leader trade size**
- **Best for:** Proportional copying

**Example:**
- Leader buys 1 SOL worth → You buy 0.1 SOL worth (10%)
- Leader buys 0.5 SOL worth → You buy 0.05 SOL worth (10%)

### Priority

If **both** are set, `FIXED_BUY_AMOUNT_SOL` takes priority.

---

## 🔒 Safety Features

### 1. Paper Trading Mode

**Always start with paper trading!**

```env
ENABLE_LIVE_TRADING=false
```

- Simulates all trades
- No real transactions
- Logs what would happen
- Perfect for testing

### 2. Blacklist Tokens

```env
BLACKLIST_TOKENS=token1,token2,token3
```

Skip specific tokens you don't want to trade.

### 3. Minimum Balance Check

The executor requires at least **0.1 SOL** in your wallet before executing buys.

### 4. Position Size Limits

```env
MAX_POSITION_SIZE_SOL=999999
```

Maximum position size per token (prevents over-exposure).

### 5. Duplicate Prevention

- Redis prevents processing the same transaction twice
- Database unique constraints prevent duplicate records

---

## 🐛 Troubleshooting

### Listener Not Detecting Trades

1. **Check wallets are configured:**
   ```bash
   # Check .env has LEADER_WALLET_* variables
   # OR check database
   psql $DATABASE_URL -c "SELECT * FROM followed_wallets WHERE enabled = true;"
   ```

2. **Check WebSocket connection:**
   - Verify `HELIUS_WS_URL` is correct
   - Check Helius API key is valid

3. **Check Redis connection:**
   - Verify `REDIS_URL` is correct
   - Ensure Redis is running: `redis-cli ping`

### Copy Executor Not Executing Trades

1. **Check wallet is initialized:**
   - Verify `COPY_WALLET_SEED_PHRASE` is set correctly
   - Check wallet has sufficient balance (min 0.1 SOL)

2. **Check trading mode:**
   - If `ENABLE_LIVE_TRADING=false`, trades are simulated (this is normal!)

3. **Check Jupiter API:**
   - Verify `JUPITER_API_KEY` is set
   - Check API key is valid

4. **Check database connection:**
   - Verify `DATABASE_URL` is correct
   - Ensure listener is running and recording trades

### Database Connection Errors

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# Check if tables exist
psql $DATABASE_URL -c "\dt"
```

### Redis Connection Errors

```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
```

---

## 📈 Monitoring

### Check Recent Trades

```sql
-- Recent leader trades
SELECT * FROM leader_trades 
ORDER BY detected_at DESC 
LIMIT 10;

-- Recent copy attempts
SELECT * FROM copy_attempts 
ORDER BY created_at DESC 
LIMIT 10;
```

### Check Wallet Statistics

```sql
SELECT 
  fw.address,
  fw.enabled,
  COUNT(lt.id) as trade_count,
  MAX(lt.detected_at) as last_trade
FROM followed_wallets fw
LEFT JOIN leader_trades lt ON lt.leader_wallet = fw.address
GROUP BY fw.id, fw.address, fw.enabled
ORDER BY trade_count DESC;
```

### Check Copy Performance

```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successes
FROM copy_attempts
GROUP BY status;
```

---

## 🎯 Quick Start Checklist

- [ ] PostgreSQL database set up and schema applied
- [ ] Redis server running
- [ ] `.env` file created with all required variables
- [ ] Wallets configured (via .env or database)
- [ ] Buy amount configured (`FIXED_BUY_AMOUNT_SOL` or `COPY_PERCENTAGE`)
- [ ] `ENABLE_LIVE_TRADING=false` for testing
- [ ] Trading wallet seed phrase configured
- [ ] Services built (`npm run build`)
- [ ] Listener service running (Terminal 1)
- [ ] Copy executor service running (Terminal 2)

---

## 📝 Example .env File

```env
# Helius
HELIUS_API_KEY=your_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=your_key

# Database
DATABASE_URL=postgresql://copytrader:password@localhost:5432/copytrader

# Redis
REDIS_URL=redis://localhost:6379

# Wallets to Monitor
LEADER_WALLET_1=BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
LEADER_WALLET_2=5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG

# Trading Wallet
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase here"

# Jupiter API
JUPITER_API_KEY=your_jupiter_key_here

# Buy Configuration
FIXED_BUY_AMOUNT_SOL=0.1
# OR
# COPY_PERCENTAGE=10

# Trading Mode
ENABLE_LIVE_TRADING=false

# Optional
MAX_POSITION_SIZE_SOL=999999
BLACKLIST_TOKENS=
LOG_LEVEL=info
```

---

## 🆘 Need Help?

- Check logs for detailed error messages
- Verify all environment variables are set correctly
- Ensure all services (PostgreSQL, Redis) are running
- Start with paper trading mode (`ENABLE_LIVE_TRADING=false`)
- Check database and Redis connections

---

**Remember:** Always test with paper trading first! Set `ENABLE_LIVE_TRADING=false` until you're confident everything works correctly.


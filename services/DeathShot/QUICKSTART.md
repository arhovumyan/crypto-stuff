# DeathShot Trading Bot - Quick Start Guide

## 🚦 Getting Started in 5 Minutes

### Step 1: Verify Prerequisites

```bash
# Check Node.js version (must be >= 18)
node --version

# Check PostgreSQL
pg_isready

# Check if database exists
psql -lqt | cut -d \| -f 1 | grep -qw copytrader && echo "Database exists" || echo "Database missing"
```

### Step 2: Install and Build

```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/DeathShot

# Install dependencies
npm install

# Build the project
npm run build
```

### Step 3: Configure

The bot reads from the root `.env` file which is already configured with:
- ✅ Helius RPC endpoints
- ✅ Database connection
- ✅ Wallet private key
- ✅ Risk parameters

**Important**: Verify paper trading is enabled:
```bash
grep "PAPER_TRADING" ../../.env
# Should show: PAPER_TRADING=true
```

### Step 4: Initialize Database

```bash
# Apply schema (ignore "already exists" warnings)
psql postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader -f schema.sql
```

### Step 5: Run the Bot

```bash
# Option 1: Development mode (with auto-reload)
npm run dev

# Option 2: Production mode
npm start

# Option 3: Using startup script
./start.sh
```

---

## 📝 Example: Monitoring a Pump.fun Token

### Finding Pool Information

1. Go to DexScreener or Raydium
2. Find your target token
3. Get the pool address and vault addresses

### Adding the Market

Edit `src/index.ts` and add after `await bot.start()`:

```typescript
// Example: Monitor a specific token
await bot.addMarket(
  'TokenMintAddress',        // The token you want to trade
  'PoolAddress',             // The AMM pool address
  'BaseVaultAddress',        // Token vault address
  'QuoteVaultAddress'        // SOL/USDC vault address
);

logger.info('Market monitoring started');
```

Rebuild and restart:
```bash
npm run build && npm start
```

---

## 🎛️ Tuning the Strategy

### Conservative Settings (Safer)

```env
DIP_THRESHOLD_PCT=8.0              # Require bigger dip
MIN_LIQUIDITY_SOL=5000.0           # Only liquid pools
MAX_SLIPPAGE_PCT=2.0               # Tighter slippage
MAX_SOL_PER_TRADE=1.0              # Smaller positions
TAKE_PROFIT_PCT=5.0                # Higher take profit
STOP_LOSS_PCT=1.5                  # Tighter stop loss
```

### Aggressive Settings (Higher Risk/Reward)

```env
DIP_THRESHOLD_PCT=3.0              # Smaller dips
MIN_LIQUIDITY_SOL=500.0            # Less liquid OK
MAX_SLIPPAGE_PCT=5.0               # Wider slippage
MAX_SOL_PER_TRADE=10.0             # Bigger positions
TAKE_PROFIT_PCT=10.0               # Wait for bigger gains
STOP_LOSS_PCT=3.0                  # Wider stop loss
```

### Scalping Settings (Quick Trades)

```env
DIP_THRESHOLD_PCT=2.0              # Any dip
TIME_STOP_SECONDS=60               # Exit after 1 minute
TAKE_PROFIT_PCT=2.0                # Quick profit
STOP_LOSS_PCT=1.0                  # Quick stop
COOLDOWN_SECONDS=60                # Trade frequently
```

---

## 🔍 Monitoring & Debugging

### View Real-Time Logs

```bash
# With pretty formatting
npm run dev | pino-pretty

# Raw JSON (for parsing)
npm run dev > bot.log
```

### Check Database Activity

```sql
-- View recent trade intents
SELECT 
    created_at,
    market_id,
    side,
    size_sol,
    price_drop_pct,
    risk_decision,
    rejection_reason
FROM trade_intents
ORDER BY created_at DESC
LIMIT 20;

-- View open positions
SELECT 
    position_id,
    market_id,
    state,
    entry_price,
    entry_amount,
    entry_time
FROM positions
WHERE state = 'OPEN';

-- View daily PnL
SELECT 
    COUNT(*) as trades,
    SUM(realized_pnl_sol) as total_pnl,
    AVG(realized_pnl_sol) as avg_pnl,
    MIN(realized_pnl_sol) as worst,
    MAX(realized_pnl_sol) as best
FROM positions
WHERE state = 'CLOSED'
    AND exit_time >= CURRENT_DATE;
```

### Common Log Messages

```
✅ "Trade intent created" → Dip detected
⚠️  "Trade intent rejected" → Failed risk check
✅ "Position opened" → Entry executed
✅ "Take profit triggered" → Exiting with profit
⚠️  "Stop loss triggered" → Exiting with loss
📄 "Paper trade executed" → Simulated (not real)
```

---

## 🧪 Testing Before Live Trading

### 1. Paper Trading (Recommended First Step)

```bash
# Ensure paper trading is ON
echo "PAPER_TRADING=true" >> ../../.env

# Run and observe
npm run dev
```

Watch for:
- Signals being generated
- Risk checks passing/failing
- Simulated fills occurring
- Exit conditions triggering

### 2. Database Verification

After running paper trades:

```sql
-- Check trade intents logged
SELECT COUNT(*) FROM trade_intents;

-- Check simulated positions
SELECT * FROM execution_logs WHERE event_type = 'SIMULATION';
```

### 3. Enable Live Trading

**Only after verifying paper trading works correctly:**

```bash
# Edit root .env
nano ../../.env

# Change:
ENABLE_LIVE_TRADING=true
PAPER_TRADING=false
```

**Start with tiny amounts:**
```env
MAX_SOL_PER_TRADE=0.05    # 0.05 SOL max per trade
```

---

## 🚨 Emergency Procedures

### Stop the Bot Immediately

```bash
# Press Ctrl+C in terminal
^C

# Or find and kill process
ps aux | grep deathshot
kill -9 <PID>
```

### Emergency Circuit Breaker

If bot is malfunctioning:

```sql
-- Check current state
SELECT * FROM positions WHERE state = 'OPEN';

-- Manually close positions via Solana wallet UI
-- Then update database:
UPDATE positions 
SET state = 'FAILED', 
    metadata = jsonb_set(metadata, '{emergency_close}', 'true')
WHERE state IN ('OPEN', 'PENDING_OPEN', 'PENDING_CLOSE');
```

### Reset Daily PnL Counter

```sql
-- If you want to reset the daily loss limit
-- (The bot does this automatically at midnight UTC)

-- Check current PnL
SELECT SUM(realized_pnl_sol) FROM positions 
WHERE state = 'CLOSED' AND exit_time >= CURRENT_DATE;
```

---

## 📊 Performance Analysis

### Generate Reports

```sql
-- Win rate
WITH stats AS (
    SELECT 
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE realized_pnl_sol > 0) as wins,
        COUNT(*) FILTER (WHERE realized_pnl_sol < 0) as losses
    FROM positions
    WHERE state = 'CLOSED'
        AND exit_time >= CURRENT_DATE - INTERVAL '7 days'
)
SELECT 
    total_trades,
    wins,
    losses,
    ROUND(wins::numeric / total_trades * 100, 2) as win_rate_pct
FROM stats;

-- Average hold time
SELECT 
    AVG(EXTRACT(EPOCH FROM (exit_time - entry_time))) / 60 as avg_hold_minutes
FROM positions
WHERE state = 'CLOSED'
    AND exit_time >= CURRENT_DATE - INTERVAL '7 days';

-- Exit reason breakdown
SELECT 
    exit_reason,
    COUNT(*) as count,
    AVG(realized_pnl_sol) as avg_pnl
FROM positions
WHERE state = 'CLOSED'
    AND exit_time >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY exit_reason
ORDER BY count DESC;
```

---

## 🔄 Common Workflows

### Daily Startup Routine

```bash
# 1. Check database
pg_isready

# 2. Check wallet balance
solana balance <YOUR_WALLET>

# 3. Review yesterday's performance
psql ... -c "SELECT SUM(realized_pnl_sol) FROM positions WHERE exit_time >= CURRENT_DATE - 1"

# 4. Start bot
./start.sh

# 5. Monitor for 5 minutes
# Watch logs for any errors
```

### Adding a New Market

```bash
# 1. Find pool info (use Solscan/DexScreener)

# 2. Edit src/index.ts
nano src/index.ts

# 3. Add after bot.start():
# await bot.addMarket('token_mint', 'pool', 'base_vault', 'quote_vault');

# 4. Rebuild and restart
npm run build && npm start
```

### Adjusting Parameters Mid-Run

The bot supports dynamic configuration (requires code modification):

```typescript
// In a separate monitoring script:
const bot = new DeathShotBot();
await bot.start();

// Update signal thresholds
bot.updateSignalConfig({
    thresholdPct: 4.0,
    minLiquiditySol: 2000
});

// Update risk limits
bot.updateRiskConfig({
    maxSolPerTrade: 3.0,
    maxDailyLossSol: 15.0
});
```

---

## 💡 Pro Tips

1. **Start Small**: Begin with 0.05 SOL per trade
2. **Monitor Closely**: Watch first 100 trades carefully
3. **Adjust Gradually**: Change one parameter at a time
4. **Paper Trade Long**: Run paper trading for at least 24 hours
5. **Check Logs Daily**: Review rejection reasons to optimize
6. **Backup Database**: `pg_dump copytrader > backup.sql`
7. **Version Control**: Keep backups of working configurations
8. **Set Alerts**: Monitor logs for errors
9. **Track Metrics**: Log daily PnL, win rate, avg hold time
10. **Know When to Stop**: If losing consistently, stop and reassess

---

## 🐛 Debug Mode

For detailed debugging:

```bash
# Set log level to debug
LOG_LEVEL=debug npm run dev | pino-pretty

# This shows:
# - All market updates
# - Gate check details
# - Slippage calculations
# - Risk decision logic
```

---

## 📞 Need Help?

1. **Check Logs**: Most issues show clear error messages
2. **Review README**: Main documentation has detailed troubleshooting
3. **Database**: Query tables to see what's happening
4. **Configuration**: Double-check .env values

---

**Remember: Start with paper trading, use small amounts, and never trade more than you can afford to lose!** 🛡️

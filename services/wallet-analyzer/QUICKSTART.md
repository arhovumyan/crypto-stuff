# Wallet Analyzer - Quick Start Guide

Get started analyzing profitable Solana wallets in under 5 minutes!

## Prerequisites

- ✅ Node.js 18+ installed
- ✅ PostgreSQL 15+ running
- ✅ Helius API key configured in `.env`
- ✅ Bot wallet addresses in `.env` under `BOT_WALLETS=`

## Step 1: Install Dependencies

```bash
cd services/wallet-analyzer
npm install
```

## Step 2: Set Up Database

```bash
# Create the database schema
psql $DATABASE_URL -f ../../database/wallet-analyzer-schema.sql
```

Expected output:
```
CREATE TABLE
CREATE TABLE
CREATE TABLE
...
CREATE FUNCTION
```

## Step 3: Build the Project

```bash
npm run build
```

## Step 4: Analyze Your First Wallet

### Option A: Analyze All Bot Wallets (Recommended)

```bash
npm run analyze -- --multiple
```

This will:
1. ✅ Fetch complete transaction history
2. ✅ Parse and classify all transactions
3. ✅ Enrich with market data
4. ✅ Match buy/sell pairs
5. ✅ Calculate performance metrics

**Expected time**: 2-10 minutes per wallet (depending on transaction count)

### Option B: Analyze Single Wallet

```bash
npm run analyze -- --wallet <WALLET_ADDRESS> --label "Test Wallet"
```

## Step 5: Check Status

```bash
npm run status
```

You should see output like:
```
✓ Found 9 tracked wallets

Wallet Status:

6TbDFs2dkHET...
  Label: Bot Wallet 1
  Transactions: 1,234
  Matched Trades: 456
  Win Rate: 67.50%
  Total Profit: 12.3456 SOL
  Last Analyzed: 1/4/2026, 10:30:00 AM
```

## Step 6: Generate Reports

```bash
npm run report -- --all
```

Reports will be saved to `./reports/` directory.

## Step 7: View Your First Report

```bash
# Mac/Linux
cat reports/*.md | less

# Or open in your editor
code reports/
```

## What's in the Report?

Each report contains:

### 📊 Executive Summary
- Total trades and win rate
- Profit/loss metrics
- Trading style classification

### 🎯 Token Selection
- Preferred market cap range
- Liquidity requirements
- Common patterns

### ⏰ Entry Timing
- Peak trading hours
- Day-of-week patterns
- Entry triggers

### 🚪 Exit Strategy
- Profit targets
- Stop losses
- Hold time analysis

### 🏆 Best/Worst Trades
- Top 10 winners
- Top 10 losers
- Detailed metrics

### 💡 Strategy Recommendations
- Replicable elements
- Success factors
- Implementation guide

## Common Commands

### Full Analysis + Reports
```bash
npm run analyze -- --multiple && npm run report -- --all
```

### Analyze Recent Activity Only
```bash
npm run analyze -- --multiple --start-date 2024-01-01
```

### Re-generate Reports
```bash
npm run report -- --all
```

### Check Specific Wallet
```bash
npm run status
npm run report -- --wallet <ADDRESS>
```

## Troubleshooting

### "Cannot connect to database"
```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### "Helius API error"
```bash
# Check your .env file
cat ../../.env | grep HELIUS_API_KEY

# Test API connection
curl "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

### "No transactions found"
- Verify wallet address is correct
- Check wallet has trading activity
- Try different wallet from BOT_WALLETS

### "Rate limit exceeded"
- Wait a few minutes
- System will automatically retry
- Check Helius plan limits

## Next Steps

### 1. Explore Your Data

Query the database directly:
```sql
-- Top performing wallets
SELECT 
  address,
  total_profit_sol,
  win_rate
FROM v_wallet_summary
ORDER BY total_profit_sol DESC;

-- Recent trading activity
SELECT * FROM v_recent_activity LIMIT 50;

-- Best trades
SELECT * FROM v_top_trades LIMIT 20;
```

### 2. Customize Analysis

Edit the analyzers in `src/walletAnalyzer.ts` to add:
- Custom pattern detection
- Additional metrics
- New strategy classifications

### 3. Automate Reports

Set up a cron job to analyze daily:
```bash
# Add to crontab
0 2 * * * cd /path/to/wallet-analyzer && npm run analyze -- --multiple && npm run report -- --all
```

### 4. Build Trading Bots

Use the insights to create automated traders:
- Copy successful entry patterns
- Replicate token selection criteria
- Implement same exit strategies
- Match risk management approaches

## Understanding the Metrics

### Win Rate
Percentage of profitable trades. 60%+ is excellent.

### Return %
Average profit per trade. Higher is better, but watch volatility.

### Hold Time
How long positions are held. Scalpers: < 1 hour, Swing: > 1 day

### Profit Factor
Total profits / Total losses. > 2.0 is very strong.

### Market Cap Preference
Size of tokens being traded. Lower = higher risk/reward.

## Advanced Usage

### Compare Multiple Wallets
```bash
# Analyze specific wallets
npm run analyze -- --wallet WALLET1
npm run analyze -- --wallet WALLET2
npm run analyze -- --wallet WALLET3

# Generate comparison report (coming soon)
```

### Export Data
```bash
# Export to CSV
psql $DATABASE_URL -c "\COPY (SELECT * FROM v_wallet_summary) TO 'wallets.csv' CSV HEADER"

# Export trades
psql $DATABASE_URL -c "\COPY (SELECT * FROM matched_trades) TO 'trades.csv' CSV HEADER"
```

### Real-time Monitoring
```javascript
// Coming in Phase 2
const analyzer = new WalletAnalyzer(db, helius, dexScreener);
await analyzer.watchWalletRealtime('ADDRESS', (trade) => {
  console.log('New trade detected:', trade);
});
```

## Performance Tips

### Speed Up Analysis
- Use `--start-date` to limit history
- Analyze fewer wallets at once
- Upgrade Helius plan for higher rate limits

### Reduce API Costs
- Cache token data locally
- Reuse existing snapshots
- Run analysis during off-peak hours

### Optimize Database
```sql
-- Create indexes
CREATE INDEX IF NOT EXISTS idx_custom ON wallet_transactions(custom_column);

-- Vacuum and analyze
VACUUM ANALYZE;
```

## Getting Help

1. **Check Logs**: `cat logs/combined.log`
2. **Review Roadmap**: `cat ../../WALLET-ANALYZER-ROADMAP.md`
3. **Read README**: `cat README.md`
4. **Inspect Database**: `psql $DATABASE_URL`

## Success Checklist

- ✅ Dependencies installed
- ✅ Database schema created
- ✅ Project built successfully
- ✅ At least one wallet analyzed
- ✅ Reports generated
- ✅ Data looks reasonable

**Congratulations! You're now analyzing profitable Solana wallets! 🎉**

---

**Next**: Read the full roadmap in `WALLET-ANALYZER-ROADMAP.md` to understand all the features and future enhancements.

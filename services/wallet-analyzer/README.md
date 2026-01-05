# Wallet Behavior Analysis System

A comprehensive system for analyzing Solana wallet trading behavior to reverse-engineer profitable trading strategies.

## Overview

This service analyzes successful Solana trading wallets to understand:
- **What** they buy (token selection criteria)
- **When** they buy (timing patterns, market conditions)
- **How** they trade (entry/exit strategies, hold times)
- **Why** they're profitable (key success factors, risk management)

The goal is to identify repeatable patterns that can be used to build automated trading bots.

## Features

### 📊 Data Collection
- Complete transaction history retrieval via Helius API
- Token metadata enrichment from DexScreener
- Market condition snapshots (price, volume, liquidity)
- Temporal context capture (day, hour, market sentiment)

### 🔍 Analysis
- Transaction parsing and classification (BUY, SELL, TRANSFER)
- Trade matching (buy-sell pairs with FIFO)
- Performance metrics calculation
- Behavioral pattern recognition
- Strategy classification (scalper, day-trader, swing-trader)

### 📈 Reporting
- Comprehensive markdown reports per wallet
- Performance summaries and statistics
- Token selection criteria analysis
- Entry/exit timing patterns
- Strategy recommendations
- Top winning/losing trades

### 🗄️ Storage
- PostgreSQL database for structured data
- Time-series token snapshots
- Matched trade records
- Pattern detection results

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLI Interface                       │
│          (analyze / report / status)                 │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              Wallet Analyzer                         │
│  - Orchestrates analysis workflow                    │
│  - Coordinates all services                          │
└─────┬──────────┬──────────┬──────────┬─────────────┘
      │          │          │          │
      ▼          ▼          ▼          ▼
┌─────────┐ ┌──────────┐ ┌──────┐ ┌─────────────┐
│ Helius  │ │DexScreen │ │  DB  │ │   Report    │
│ Service │ │ Service  │ │      │ │  Generator  │
└─────────┘ └──────────┘ └──────┘ └─────────────┘
      │          │          │
      ▼          ▼          ▼
┌─────────────────────────────────────┐
│     Transaction Parser               │
│  - Classifies transactions           │
│  - Extracts trade details            │
└─────────────────────────────────────┘
```

## Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Helius API key
- Environment variables configured

### Setup

1. **Install dependencies**:
```bash
cd services/wallet-analyzer
npm install
```

2. **Set up database**:
```bash
# Create the database schema
psql $DATABASE_URL -f ../../database/wallet-analyzer-schema.sql
```

3. **Configure environment**:
Ensure your `.env` file in the root contains:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/copytrader
HELIUS_API_KEY=your-helius-api-key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-key
BOT_WALLETS=wallet1,wallet2,wallet3
```

4. **Build the project**:
```bash
npm run build
```

## Usage

### Analyze Wallets

**Analyze all wallets from .env**:
```bash
npm run analyze -- --multiple
```

**Analyze a specific wallet**:
```bash
npm run analyze -- --wallet <address> --label "My Bot"
```

**Analyze with start date** (only fetch transactions after this date):
```bash
npm run analyze -- --multiple --start-date 2024-01-01
```

### Generate Reports

**Generate report for specific wallet**:
```bash
npm run report -- --wallet <address>
```

**Generate reports for all tracked wallets**:
```bash
npm run report -- --all --output ./reports
```

### Check Status

**View status of all tracked wallets**:
```bash
npm run status
```

Output includes:
- Transaction count
- Matched trades
- Win rate
- Total profit
- Last analysis date

## CLI Commands

### `analyze`
Fetch and analyze wallet transactions.

Options:
- `-w, --wallet <address>` - Single wallet address
- `-m, --multiple` - Analyze all BOT_WALLETS from .env
- `-s, --start-date <date>` - Start date (YYYY-MM-DD)
- `-l, --label <label>` - Label for the wallet

### `report`
Generate analysis reports.

Options:
- `-w, --wallet <address>` - Specific wallet
- `-a, --all` - All tracked wallets
- `-o, --output <dir>` - Output directory (default: ./reports)

### `status`
Show analysis status of all tracked wallets.

## Report Contents

Generated reports include:

### 1. Executive Summary
- Total trades, win rate, profit/loss
- Trading style classification
- Consistency and risk profile

### 2. Token Selection Analysis
- Preferred market cap range
- Liquidity requirements
- Common characteristics

### 3. Entry Timing Analysis
- Peak trading hours and days
- Hourly distribution chart
- Entry trigger patterns

### 4. Exit Strategy Analysis
- Average profit targets
- Stop loss levels
- Hold time by outcome

### 5. Top Trades
- Top 10 winning trades
- Top 10 losing trades
- Detailed trade metrics

### 6. Strategy Recommendations
- Replicable elements
- Key success factors
- Implementation difficulty
- Risk warnings

## Database Schema

### Core Tables

**tracked_wallets**: Wallets being analyzed
- `address`, `label`, `is_active`, `last_analyzed_at`

**wallet_transactions**: All transactions
- `signature`, `block_time`, `transaction_type`
- `token_mint`, `sol_amount`, `token_amount`
- `dex_name`, `fee_lamports`

**token_snapshots**: Market data at transaction time
- `price_usd`, `price_sol`, `market_cap_usd`
- `liquidity_usd`, `volume_24h_usd`

**matched_trades**: Buy-sell pairs
- `entry_time`, `exit_time`, `hold_time_seconds`
- `profit_loss_sol`, `return_percentage`
- `is_winner`, `trade_category`

**wallet_patterns**: Discovered behavioral patterns
- `pattern_type`, `pattern_name`, `confidence_score`
- `frequency`, `success_rate`

**wallet_performance**: Aggregated metrics
- `total_trades`, `win_rate`, `total_profit_sol`
- `avg_return_pct`, `sharpe_ratio`

## API Services

### Helius Service
- Transaction history retrieval
- Enhanced transaction data
- Token metadata
- Rate limiting and retry logic

### DexScreener Service
- Real-time token prices
- Market cap and liquidity data
- 24h volume and price changes
- Caching to reduce API calls

### Transaction Parser
- DEX program identification
- Token flow analysis
- Trade type classification
- Price calculation

## Analysis Workflow

1. **Data Collection**
   - Fetch complete transaction history
   - Parse and classify transactions
   - Extract trade details

2. **Enrichment**
   - Get token metadata from DexScreener
   - Calculate USD prices
   - Store market snapshots

3. **Trade Matching**
   - Group transactions by token
   - Match buys with sells (FIFO)
   - Calculate P&L and metrics

4. **Pattern Recognition**
   - Analyze token selection criteria
   - Identify entry timing patterns
   - Classify trading style
   - Assess risk profile

5. **Report Generation**
   - Compile all analysis data
   - Generate markdown reports
   - Create visualizations

## Performance Considerations

### Rate Limiting
- Helius: 100 requests/second (with backoff)
- DexScreener: 10 requests/second
- Automatic retry on rate limits

### Caching
- Token data cached for 1 minute
- Reduces redundant API calls
- Improves analysis speed

### Batch Processing
- Transactions saved in batches of 500
- Parallel token metadata fetching
- Progress tracking for long analyses

### Database Optimization
- Indexed on critical columns
- Materialized views for summaries
- Efficient query patterns

## Logging

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Errors only
- Console output - Info and above

Log levels: error, warn, info, debug

## Troubleshooting

### "Wallet not found"
- Wallet hasn't been analyzed yet
- Run `analyze` command first

### "Rate limit exceeded"
- Wait for automatic retry
- Reduce concurrent requests
- Check API key limits

### "No transactions found"
- Wallet has no trading activity
- Check wallet address is correct
- Verify API connectivity

### Database connection errors
- Check DATABASE_URL is correct
- Ensure PostgreSQL is running
- Verify schema is created

## Example Analysis Flow

```bash
# 1. Analyze all bot wallets
npm run analyze -- --multiple

# 2. Check status
npm run status

# 3. Generate reports
npm run report -- --all

# 4. View report
cat reports/*_report.md
```

## Extending the System

### Add New Pattern Detectors
Edit `walletAnalyzer.ts` and add methods to `analyzePatterns()`

### Custom Report Sections
Modify `reportGenerator.ts` to add new analysis sections

### Additional Data Sources
Create new service classes following the pattern of `DexScreenerService`

### Real-time Monitoring
Extend `HeliusService` to support WebSocket subscriptions

## Future Enhancements

### Phase 2
- [ ] Real-time wallet monitoring
- [ ] Pattern confidence scoring
- [ ] Multi-wallet comparison
- [ ] Strategy synthesis

### Phase 3
- [ ] Machine learning models
- [ ] Predictive analytics
- [ ] Backtesting framework
- [ ] Automated strategy execution

### Phase 4
- [ ] Web dashboard
- [ ] REST API
- [ ] Real-time alerts
- [ ] Community features

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT

## Support

For issues or questions:
- Check the logs in `logs/`
- Review the technical roadmap: `../../WALLET-ANALYZER-ROADMAP.md`
- Ensure all environment variables are set correctly

---

**Built with**: TypeScript, Node.js, PostgreSQL, Helius API, DexScreener API

**Version**: 1.0.0

**Last Updated**: 2026-01-04

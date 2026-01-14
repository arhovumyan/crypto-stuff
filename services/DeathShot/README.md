# DeathShot Trading Bot

## 🎯 Overview

DeathShot is an advanced Solana dip-buying trading bot that automatically detects price dips in token markets and executes scalping trades for profit. The system uses on-chain market data monitoring, intelligent signal detection, comprehensive risk management, and automated execution via Jupiter aggregator.

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Features](#features)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Usage](#usage)
7. [Module Descriptions](#module-descriptions)
8. [Database Schema](#database-schema)
9. [Trading Strategy](#trading-strategy)
10. [Risk Management](#risk-management)
11. [Troubleshooting](#troubleshooting)
12. [FAQ](#faq)

---

## 🏗️ Architecture Overview

DeathShot is built with a modular architecture consisting of six core modules:

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Main)                       │
│         Coordinates all modules and event flow               │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  MarketData  │ │    Signal    │ │     Risk     │ │  Execution   │
│   Module     │ │    Engine    │ │   Manager    │ │    Engine    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
         │              │              │              │
         └──────────────┴──────────────┴──────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │ Position Tracker │
                   └──────────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │   PostgreSQL DB  │
                   └──────────────────┘
```

### Data Flow

1. **MarketData** → Monitors on-chain pool accounts via WebSocket
2. **SignalEngine** → Detects dip conditions and generates trade intents
3. **RiskManager** → Validates intents against safety rules
4. **ExecutionEngine** → Executes approved trades via Jupiter
5. **PositionTracker** → Monitors open positions for exit conditions
6. **Database** → Persists all state and audit trail

---

## ✨ Features

### Core Trading Features
- ✅ **Real-time Market Monitoring**: WebSocket subscriptions to Solana pool accounts
- ✅ **Intelligent Dip Detection**: Multi-gate validation system
- ✅ **Automated Execution**: Jupiter aggregator integration for best prices
- ✅ **Position Management**: Full lifecycle tracking (open → close)
- ✅ **Exit Strategies**: Take-profit, stop-loss, time-stop triggers

### Risk Management
- ✅ **Position Limits**: Max concurrent positions
- ✅ **Loss Limits**: Daily loss threshold with circuit breaker
- ✅ **Exposure Limits**: Per-token exposure caps
- ✅ **Rate Limiting**: Hourly trade count restrictions
- ✅ **System Health Checks**: Staleness detection and failsafe

### Operational Features
- ✅ **Paper Trading Mode**: Simulate trades without real transactions
- ✅ **Structured Logging**: JSON logs with full context
- ✅ **Database Persistence**: Complete audit trail
- ✅ **Graceful Shutdown**: Clean resource cleanup
- ✅ **Dynamic Configuration**: Update parameters at runtime

---

## 📦 Prerequisites

### System Requirements
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v14 or higher
- **Operating System**: macOS, Linux, or WSL on Windows

### Solana Requirements
- **RPC Provider**: Helius, Triton, or QuickNode with WebSocket support
- **Wallet**: Private key with SOL for gas fees and trading
- **Network**: Solana Mainnet Beta

---

## 🚀 Installation

### 1. Clone the Repository

```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/DeathShot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Database

Ensure PostgreSQL is running and create the database:

```bash
createdb copytrader
```

Apply the schema:

```bash
psql postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader -f schema.sql
```

### 4. Configure Environment

Copy the example environment file and edit it:

```bash
cp .env.example .env.local
nano .env.local
```

Or use the root `.env` file (recommended) which is already configured.

### 5. Build the Project

```bash
npm run build
```

---

## ⚙️ Configuration

Configuration is loaded from the root `.env` file. Key parameters:

### RPC Configuration
```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### Wallet Configuration
```env
COPY_WALLET_PRIVATE_KEY=YOUR_PRIVATE_KEY_BASE58
```

### Risk Parameters
```env
MAX_SOL_PER_TRADE=5.0              # Maximum SOL per trade
MAX_CONCURRENT_POSITIONS=10         # Max open positions
MAX_EXPOSURE_PER_TOKEN=10.0         # Max SOL per token
MAX_DAILY_LOSS_SOL=20.0            # Daily loss limit
MAX_HOURLY_TRADES=50               # Hourly trade limit
```

### Signal Parameters
```env
DIP_THRESHOLD_PCT=5.0              # Minimum price drop %
MIN_LIQUIDITY_SOL=1000.0           # Minimum pool liquidity
MAX_SLIPPAGE_PCT=3.0               # Maximum acceptable slippage
MIN_VOLUME_PROXY=100.0             # Minimum volume activity
COOLDOWN_SECONDS=300               # Cooldown between trades
```

### Exit Parameters
```env
TAKE_PROFIT_PCT=3.0                # Take profit at +3%
STOP_LOSS_PCT=2.0                  # Stop loss at -2%
TIME_STOP_SECONDS=300              # Exit after 5 minutes
```

### Trading Mode
```env
ENABLE_LIVE_TRADING=false          # Set to true for real trading
PAPER_TRADING=true                 # Simulate trades (safe mode)
```

---

## 🎮 Usage

### Starting the Bot

#### Development Mode (with auto-reload):
```bash
npm run dev
```

#### Production Mode:
```bash
npm start
```

#### Using the Startup Script:
```bash
./start.sh
```

### Adding Markets to Monitor

To add a market, you need to modify `src/index.ts` to call `addMarket()`:

```typescript
// Example: Add a Raydium pool
await bot.addMarket(
  'TOKEN_MINT_ADDRESS',           // Market ID (token mint)
  'POOL_ADDRESS',                 // Raydium pool address
  'BASE_VAULT_ADDRESS',           // Base token vault
  'QUOTE_VAULT_ADDRESS'           // Quote token vault (SOL/USDC)
);
```

### Monitoring the Bot

The bot outputs structured JSON logs. Watch real-time activity:

```bash
npm run dev | pino-pretty
```

### Checking Status

The bot displays a status dashboard on startup showing:
- Wallet address
- Markets monitored
- Open positions
- Daily PnL
- System health
- Trading mode

---

## 🧩 Module Descriptions

### 1. MarketData Module

**Purpose**: Monitors on-chain pool accounts via WebSocket subscriptions.

**Key Functions**:
- Subscribe to base/quote vault accounts
- Parse token balances to derive price
- Maintain 60-second rolling window of price data
- Detect staleness and subscription failures
- Emit market update events

**Output**: `MarketUpdate` events with price, liquidity, volume proxy

---

### 2. SignalEngine Module

**Purpose**: Detects dip conditions using multi-gate validation.

**Validation Gates**:
1. **Cooldown Check**: Prevents rapid-fire trades on same market
2. **Price Drop Threshold**: Requires 5% dip (configurable)
3. **Liquidity Check**: Ensures sufficient pool depth
4. **Slippage Estimation**: Rejects if estimated slippage too high
5. **Volume Proxy**: Filters dead/low-activity pools

**Output**: `TradeIntent` objects when all gates pass

---

### 3. RiskManager Module

**Purpose**: Enforces position limits and safety rules.

**Risk Checks**:
- Trade size within limits
- Concurrent position count
- Per-token exposure
- Daily loss threshold
- Hourly trade count
- System health status

**Output**: `APPROVED` or `REJECTED` decisions with reasons

---

### 4. ExecutionEngine Module

**Purpose**: Executes swaps via Jupiter aggregator.

**Execution Flow**:
1. Get fresh quote from Jupiter API
2. Build swap transaction
3. Add compute budget and priority fee
4. Simulate transaction (fail-fast)
5. Sign and submit with retry logic
6. Confirm transaction
7. Emit fill event

**Modes**:
- **Paper Trading**: Simulates fills without real txs
- **Live Trading**: Executes real on-chain transactions

---

### 5. PositionTracker Module

**Purpose**: Manages position lifecycle and monitors exit conditions.

**Position States**:
- `PENDING_OPEN`: Entry tx submitted
- `OPEN`: Entry confirmed, monitoring exits
- `PENDING_CLOSE`: Exit tx submitted
- `CLOSED`: Exit confirmed, PnL realized
- `FAILED`: Execution error

**Exit Triggers**:
- Take profit threshold reached
- Stop loss triggered
- Time stop expired
- Liquidity collapse detected

**Output**: `ExitIntent` events for closing positions

---

### 6. Database Module

**Purpose**: Persists all state for audit and recovery.

**Tables**:
- `market_snapshots`: Time-series market data
- `trade_intents`: All signal detections (approved/rejected)
- `positions`: Position lifecycle events
- `execution_logs`: Transaction details
- `system_metrics`: Performance metrics

---

## 🗄️ Database Schema

### market_snapshots
```sql
time                TIMESTAMPTZ
market_id           TEXT
price               NUMERIC(20,10)
base_reserve        BIGINT
quote_reserve       BIGINT
liquidity_estimate  NUMERIC(20,10)
volume_proxy        NUMERIC(20,10)
```

### trade_intents
```sql
intent_id           UUID PRIMARY KEY
created_at          TIMESTAMPTZ
market_id           TEXT
side                TEXT
size_sol            NUMERIC(20,10)
reference_price     NUMERIC(20,10)
current_price       NUMERIC(20,10)
price_drop_pct      NUMERIC(5,2)
liquidity           NUMERIC(20,10)
estimated_slippage  NUMERIC(5,2)
reason_codes        JSONB
risk_decision       TEXT
rejection_reason    TEXT
```

### positions
```sql
position_id         UUID PRIMARY KEY
intent_id           UUID
market_id           TEXT
state               TEXT
entry_tx_sig        TEXT
entry_price         NUMERIC(20,10)
entry_amount        NUMERIC(20,10)
entry_time          TIMESTAMPTZ
exit_tx_sig         TEXT
exit_price          NUMERIC(20,10)
exit_time           TIMESTAMPTZ
realized_pnl_sol    NUMERIC(20,10)
exit_reason         TEXT
metadata            JSONB
```

---

## 📊 Trading Strategy

### The "Dip Buy" Strategy

1. **Monitor**: Track price changes in 60-second windows
2. **Detect**: Identify 5%+ drops from reference price
3. **Validate**: Check liquidity, slippage, volume
4. **Enter**: Buy the dip with dynamically sized order
5. **Monitor**: Track unrealized PnL in real-time
6. **Exit**: Close at take-profit (+3%), stop-loss (-2%), or time-stop (5 min)

### Order Sizing

- **Dynamic**: 1% of pool liquidity
- **Capped**: Maximum 5 SOL per trade
- **Minimum**: 0.01 SOL to avoid dust

### Slippage Management

- Estimated before trade using constant product formula
- Rejected if exceeds configured threshold (default 3%)
- Jupiter routes provide additional slippage protection

---

## 🛡️ Risk Management

### Position Limits

- **Max Concurrent Positions**: Prevents over-exposure
- **Per-Token Exposure**: Caps risk per asset
- **Trade Size Limits**: Prevents single large loss

### Loss Protection

- **Stop Loss**: Automatic exit at -2% (configurable)
- **Daily Loss Limit**: Circuit breaker at -20 SOL (configurable)
- **Time Stop**: Exit stale positions after 5 minutes

### System Safeguards

- **Staleness Detection**: Halts trading if data > 5s old
- **Simulation Checks**: Rejects failing transactions pre-flight
- **Rate Limiting**: Prevents spam behavior
- **Emergency Stop**: Manual kill switch

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Bot Won't Start

**Symptom**: Error on startup

**Solutions**:
- Check database connection: `psql postgresql://...`
- Verify RPC URL and API key
- Ensure wallet private key is valid base58
- Check Node.js version: `node --version` (must be >= 18)

#### 2. No Trades Being Made

**Symptom**: Bot running but no signals

**Possible Causes**:
- No markets added (uncomment `addMarket()` in `index.ts`)
- Dip threshold too high (lower `DIP_THRESHOLD_PCT`)
- Liquidity requirements too strict (lower `MIN_LIQUIDITY_SOL`)
- Markets not experiencing dips

**Solutions**:
- Add markets to monitor
- Adjust signal parameters
- Check logs for rejection reasons

#### 3. All Trades Rejected by Risk Manager

**Symptom**: Signals detected but all rejected

**Check**:
- Daily loss limit not breached
- Hourly trade limit not hit
- Open position count below max
- System health is good

#### 4. Database Connection Errors

**Solutions**:
- Verify PostgreSQL is running: `pg_isready`
- Check credentials in `DATABASE_URL`
- Ensure database exists: `createdb copytrader`
- Re-run schema: `psql ... -f schema.sql`

#### 5. WebSocket Disconnections

**Symptom**: "Market data stale" warnings

**Solutions**:
- Check RPC provider status
- Verify API key and rate limits
- Consider upgrading RPC plan
- Add fallback RPC URLs

---

## ❓ FAQ

### Is this safe to use with real funds?

Start with **paper trading mode** (`PAPER_TRADING=true`) to validate strategy and configuration. Once confident, enable live trading with small amounts.

### How much SOL do I need?

- **Minimum**: 0.5 SOL for gas fees and small trades
- **Recommended**: 10-50 SOL for meaningful trading
- **Gas Fees**: ~0.00001-0.001 SOL per transaction

### What tokens can I trade?

Any token with:
- A Raydium or Orca pool
- Sufficient liquidity (> 1000 SOL by default)
- Active trading volume

### How do I add new markets?

Edit `src/index.ts` and uncomment/add `bot.addMarket()` calls with pool addresses. You can find pool info on:
- Raydium UI
- Orca UI
- Solscan
- DexScreener

### Can I run multiple instances?

Yes, but ensure:
- Each instance uses a separate database schema or namespace
- Wallet keys are different OR position tracking is coordinated
- RPC rate limits can handle combined load

### What's the expected profit?

**Disclaimer**: Past performance does not guarantee future results. Profitability depends on:
- Market volatility
- Signal tuning
- Slippage and fees
- Exit strategy effectiveness

Always backtest and paper trade extensively.

### How do I monitor performance?

- **Logs**: Real-time JSON logs via pino
- **Database**: Query `positions` table for realized PnL
- **Status API**: Call `bot.getStatus()` programmatically
- **Future**: Grafana dashboards (see technical docs)

### Is this a guaranteed money maker?

**No.** This is a **high-risk** trading bot. You can lose money. Use at your own risk. This is a tool, not financial advice.

---

## 🙏 Credits

Built following the architectural principles from the instructions provided by the user, implementing:
- Modular design
- Multi-gate signal validation
- Comprehensive risk management
- Production-grade error handling
- Full audit trail

---

## 📄 License

MIT License - Use at your own risk

---

## ⚠️ Disclaimer

**This software is provided for educational and research purposes only. Trading cryptocurrencies involves substantial risk of loss. You are solely responsible for your trading decisions and any financial losses incurred. The authors and contributors accept no liability for any losses or damages.**

**Always:**
- Start with paper trading
- Use small amounts when testing live
- Never trade more than you can afford to lose
- Understand the risks of automated trading
- Monitor your bot actively

---

## 📞 Support

For issues or questions:
1. Check this README and troubleshooting section
2. Review logs for error messages
3. Verify configuration parameters
4. Ensure database schema is up to date

---

**Happy (safe) trading! 🚀**

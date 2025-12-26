# Infrastructure Signal Trading Bot

> **We do not trade because infra wallets trade.**  
> **We trade when infra behavior makes risk asymmetric.**

A confirmation-based trading bot that uses infrastructure trader behavior as signals instead of blindly copying wallets.

## Overview

This bot detects when large sells occur and monitors for "infrastructure" wallet absorption. When infra wallets buy back a significant portion of the sell, and price stabilizes with higher lows, the bot enters a trade. It exits when take profit/stop loss is hit, or when infra behavior changes (e.g., they start selling).

## How It Works

### 1. Sell Detection
- Monitors DEX trades in real-time via WebSocket
- Detects large sells (1-3% of pool liquidity by default)
- Filters out panic sells (too large) and noise (too small)

### 2. Absorption Detection
- After a large sell, monitors for buybacks within 30 seconds
- Looks for known infra wallets or significant buy pressure
- Confirms absorption when buyback >= 50% of sell size

### 3. Price Stabilization
- After absorption, monitors price for up to 5 minutes
- Waits for higher lows to form (price stops making new lows)
- Confirms stabilization when volatility decreases

### 4. Entry
- Generates signal with strength score (0-100)
- Only enters if signal strength >= threshold (default 60)
- Places buy slightly above defended level

### 5. Exit Strategy
- Take Profit: +15% (configurable)
- Stop Loss: -8% (configurable)
- Trailing Stop: Optional
- Exit on infra distribution (if defending wallet starts selling)

### 6. Infra Classification
- Tracks wallet behavior patterns over time
- Classifies wallets as: defensive, cyclical, aggressive, passive
- Higher confidence signals from known defensive wallets

## Installation

```bash
cd services/infra-signal-bot
npm install
```

## Configuration

Set these environment variables in your `.env` file:

### Required
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/copytrader
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase here"
```

### Optional - RPC
```bash
HELIUS_API_KEY=your_helius_api_key
HELIUS_WS_URL=wss://mainnet.helius-rpc.com
```

### Optional - Sell Detection
```bash
MIN_SELL_LIQUIDITY_PCT=1       # Min sell size as % of pool (default: 1%)
MAX_SELL_LIQUIDITY_PCT=3       # Max sell size as % of pool (default: 3%)
SELL_DETECTION_WINDOW_MS=60000 # Time window for tracking sells
```

### Optional - Absorption
```bash
ABSORPTION_WINDOW_MS=30000     # Time to wait for absorption
MIN_ABSORPTION_RATIO=0.5       # Min buyback as ratio of sell (default: 50%)
```

### Optional - Stabilization
```bash
STABILIZATION_TIMEFRAME_MS=300000  # Time to check for stabilization (5 min)
MIN_HIGHER_LOWS=2              # Min higher lows needed
PRICE_STABILIZATION_PCT=5      # Max price deviation for stable
```

### Optional - Entry
```bash
MIN_SIGNAL_STRENGTH=60         # Min signal strength to enter (0-100)
ENTRY_ABOVE_DEFENSE_PCT=1      # Entry offset above defended level
MAX_CONCURRENT_POSITIONS=3     # Max positions at once
BUY_AMOUNT_SOL=0.1             # Amount to buy per trade
```

### Optional - Known Infra Wallets
```bash
# Pre-seed known infrastructure wallets (treated as confirmed from start)
Known_Infra_Wallets_1=eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q5YbKQ9sUf
Known_Infra_Wallets_2=Ar2Y6o1QmrRAskjii1cRfijeKugHH13ycxW5cd7rro1x
Known_Infra_Wallets_3=ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT
# ... add more as needed
```
See `KNOWN-INFRA-WALLETS-SETUP.md` for details.

### Optional - Exit
```bash
TAKE_PROFIT_PCT=15             # Take profit target
STOP_LOSS_PCT=8                # Stop loss
TRAILING_STOP_PCT=5            # Trailing stop (optional)
INFRA_EXIT_CHECK_MS=10000      # Check interval for exit signals
```

### Optional - Trading Mode
```bash
ENABLE_LIVE_TRADING=false      # Set to true for live trading
PAPER_TRADING_MODE=true        # Simulate trades without execution
JUPITER_API_KEY=your_jupiter_key  # Required for live trading
```

### Optional - Manual Infra Wallets
```bash
KNOWN_INFRA_WALLETS=wallet1,wallet2,wallet3
```

## Database Setup

Run the schema extension:

```bash
psql $DATABASE_URL < ../../database/infra-signal-schema.sql
```

## Running

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     InfraSignalBot                              │
│                    (Orchestrator)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   TradeFeed   │───▶│ SellDetector  │───▶│  Absorption   │
│  (WebSocket)  │    │ (Large Sells) │    │   Detector    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                                        │
        │            ┌───────────────┐           │
        └───────────▶│    Infra      │◀──────────┘
                     │  Classifier   │
                     └───────────────┘
                              │
                              ▼
                     ┌───────────────┐
                     │ Stabilization │
                     │   Checker     │
                     └───────────────┘
                              │
                              ▼
                     ┌───────────────┐
                     │   Entry       │
                     │   Manager     │
                     └───────────────┘
                              │
                              ▼
                     ┌───────────────┐
                     │   Position    │
                     │   Monitor     │
                     └───────────────┘
```

## Signal Strength Calculation

| Factor | Max Points |
|--------|------------|
| Absorption Ratio (buyback/sell) | 30 |
| Response Speed (<5s best) | 25 |
| Infra Wallet Reputation | 25 |
| Sell Size Significance | 15 |
| **Total** | **100** |

## Infra Wallet Classification

| Type | Characteristics |
|------|-----------------|
| **Defensive** | High buy ratio, fast response, defends levels |
| **Aggressive** | High frequency, large trades, market-making |
| **Cyclical** | Regular patterns, balanced buy/sell |
| **Passive** | Low frequency, small trades |

## Paper Trading

The bot defaults to paper trading mode. To verify it's working:

1. Watch logs for "LARGE SELL DETECTED" messages
2. Watch for "ABSORPTION CONFIRMED" messages
3. Watch for "STABILIZATION CONFIRMED" messages
4. Watch for "PAPER TRADE EXECUTED" messages

## Live Trading

⚠️ **WARNING**: Live trading involves real money. Start with small amounts.

1. Set `ENABLE_LIVE_TRADING=true`
2. Set `PAPER_TRADING_MODE=false`
3. Set `JUPITER_API_KEY` with your Jupiter API key
4. Fund your wallet with SOL

## Logs

The bot produces structured logs with context tags:

```
[trade-feed] Connected to WebSocket
[sell-detector] 🔴 LARGE SELL DETECTED | token: ABC... | amount: 1.5 SOL | 2.1%
[absorption-detector] ✅ ABSORPTION CONFIRMED | ratio: 65% | delay: 8500ms
[stabilization-checker] ✅ STABILIZATION CONFIRMED | higher lows: 3
[entry-manager] 🎯 SIGNAL CONFIRMED - Executing entry | strength: 75
[position-monitor] 📍 POSITION OPENED | entry: 0.00001234
[position-monitor] 🎯 TAKE PROFIT HIT | pnl: +15.2%
```

## Testing

To test without real trading:

1. Run in paper trading mode
2. Monitor for signal generation
3. Review which tokens would have been traded
4. Iterate on parameters based on results

## Troubleshooting

### No sells detected
- Check WebSocket connection is active
- Lower `MIN_SELL_LIQUIDITY_PCT` threshold
- Verify token pools have sufficient activity

### No absorptions
- Increase `ABSORPTION_WINDOW_MS`
- Lower `MIN_ABSORPTION_RATIO`
- Add known infra wallets to `KNOWN_INFRA_WALLETS`

### No stabilization
- Increase `STABILIZATION_TIMEFRAME_MS`
- Lower `MIN_HIGHER_LOWS`
- Check price data is being received

### Entries not executing
- Check `MIN_SIGNAL_STRENGTH` threshold
- Verify wallet balance
- Check Jupiter API key for live trading


# Pump.fun Token Scalper

Quick-scalp trading bot that monitors Pump.fun token launches, identifies support, and automatically trades with defined profit targets and stop losses.

## Features

- **Real-time Monitoring**: Detects new token launches on Pump.fun instantly
- **Support Analysis**: Identifies tokens with strong buyer support
- **Auto-Trading**: Automatically buys and sells based on criteria
- **Risk Management**: Built-in profit targets and stop losses
- **Position Management**: Tracks all open positions in real-time
- **Paper Trading**: Test strategies without risking capital

## Configuration

Add these variables to your `.env` file:

```bash
# Trading Configuration
SCALPER_BUY_AMOUNT_SOL=0.05        # Amount to invest per trade (in SOL)
SCALPER_PROFIT_TARGET=3             # Profit target percentage (e.g., 3 = 3%)
SCALPER_STOP_LOSS=2                 # Stop loss percentage (e.g., 2 = 2%)
SCALPER_MAX_POSITIONS=3             # Maximum concurrent positions
SCALPER_ENABLE_LIVE_TRADING=false   # Set to 'true' for live trading

# Support Criteria
SCALPER_MIN_BUYERS=10               # Minimum unique buyers required
SCALPER_TIMEFRAME=60                # Timeframe in seconds (e.g., 10 buyers in 60s)
SCALPER_MIN_VOLUME=1000             # Minimum volume in USD
SCALPER_MIN_LIQUIDITY=5000          # Minimum liquidity in USD
SCALPER_MIN_MCAP=10000              # Minimum market cap in USD
SCALPER_MAX_MCAP=500000             # Maximum market cap in USD
```

## Quick Start

1. **Install dependencies**:
   ```bash
   cd services/pump-scalper
   npm install
   ```

2. **Configure settings** in `.env`

3. **Start in paper trading mode** (recommended first):
   ```bash
   npm run dev
   ```

4. **Enable live trading** once comfortable:
   ```bash
   # Set in .env
   SCALPER_ENABLE_LIVE_TRADING=true
   ```

## How It Works

### 1. Token Detection
- Monitors Pump.fun program for new token launches
- Extracts token info (address, symbol, liquidity)
- Adds to monitoring list immediately

### 2. Support Analysis
The bot analyzes several factors to determine if a token has "support":

- **Unique Buyers**: Number of different wallets buying
- **Timing**: How quickly buyers are accumulating
- **Volume**: Trading volume in USD
- **Liquidity**: Available liquidity in the pool
- **Market Cap**: Must be within defined range

Each factor contributes to a score (0-100). Tokens scoring 70+ are considered to have support.

### 3. Auto-Buy
When a token meets support criteria:
- Places buy order via Jupiter
- Amount: Fixed SOL value (e.g., 0.05 SOL)
- Slippage: 5% max
- Records entry price and time

### 4. Position Monitoring
For each open position, monitors every 5 seconds:
- Current price
- Profit/Loss percentage
- Age of position

### 5. Auto-Sell
Sells when any condition is met:
- ✅ **Profit Target**: Price gains exceed target (e.g., +3%)
- 🛑 **Stop Loss**: Price drops exceed stop loss (e.g., -2%)
- ⏰ **Time Limit**: Position held for 10+ minutes

## Example Scenarios

### Scenario 1: Quick Profit
```
Token launched → 10 buyers in 30s → Auto-buy at $0.0001
Price rises to $0.000103 (+3%) → Auto-sell
Result: +3% gain in 2 minutes
```

### Scenario 2: Stop Loss
```
Token launched → 12 buyers in 45s → Auto-buy at $0.0002
Price drops to $0.000196 (-2%) → Auto-sell
Result: -2% loss (limited damage)
```

### Scenario 3: Time Limit
```
Token launched → Auto-buy at $0.0003
After 10 minutes, price at $0.000305 (+1.67%)
Time limit reached → Auto-sell
Result: +1.67% gain (avoiding stagnant positions)
```

## Risk Management

### Built-in Protections
- **Max Positions**: Limits concurrent trades
- **Fixed Investment**: Same SOL amount per trade
- **Stop Losses**: Automatic exit on losses
- **Time Limits**: No holding forever
- **Balance Checks**: Won't trade if balance too low

### Recommended Settings for Beginners

```bash
# Conservative settings
SCALPER_BUY_AMOUNT_SOL=0.01        # Small position size
SCALPER_PROFIT_TARGET=5             # Higher target
SCALPER_STOP_LOSS=1                 # Tight stop loss
SCALPER_MAX_POSITIONS=2             # Limited exposure
SCALPER_MIN_BUYERS=15               # Stricter criteria
```

### Aggressive Settings

```bash
# Higher risk/reward
SCALPER_BUY_AMOUNT_SOL=0.1         # Larger positions
SCALPER_PROFIT_TARGET=2             # Quick exits
SCALPER_STOP_LOSS=3                 # Wider stop
SCALPER_MAX_POSITIONS=5             # More positions
SCALPER_MIN_BUYERS=8                # Less strict
```

## Monitoring

The bot provides real-time logs:

```
[16:32:15] INFO: pump-monitor | 🆕 NEW TOKEN DETECTED
[16:32:15] INFO: pump-monitor | Symbol: PEPE2
[16:32:15] INFO: pump-monitor | Liquidity: $8,500.00

[16:32:47] INFO: pump-scalper | ✅ SUPPORT CONFIRMED - EXECUTING BUY
[16:32:47] INFO: pump-scalper | Score: 85/100
[16:32:47] INFO: pump-scalper | Unique Buyers: 12
[16:32:47] INFO: pump-scalper | 🔴 LIVE BUY EXECUTED

[16:35:12] INFO: position-manager | 🎯 PROFIT TARGET HIT - SELL SIGNAL
[16:35:12] INFO: position-manager | P&L: +$0.0015 (+3.00%)
```

## Troubleshooting

### No tokens detected
- Check Helius RPC is working
- Verify Pump.fun program ID is correct
- Try lowering support criteria

### Buys not executing
- Check wallet balance
- Verify `SCALPER_ENABLE_LIVE_TRADING=true`
- Check Jupiter API accessibility

### Positions not selling
- Position manager runs every 5 seconds
- Check logs for errors
- Verify DexScreener API access

## Safety Tips

1. **Start with paper trading** to understand the bot
2. **Use small position sizes** initially
3. **Monitor actively** during first sessions
4. **Set appropriate limits** for your risk tolerance
5. **Keep enough SOL** for transaction fees
6. **Never invest** more than you can afford to lose

## Advanced Customization

You can modify the code to:
- Change monitoring intervals
- Adjust scoring algorithm
- Add custom filters (e.g., token name patterns)
- Implement trailing stop losses
- Add Telegram notifications
- Integrate with your own analytics

## Support

For issues or questions, check the logs first. Most problems are configuration-related.

Common issues:
- Missing environment variables
- Insufficient wallet balance
- RPC rate limiting
- Network connectivity

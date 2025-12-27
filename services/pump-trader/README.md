# Pump.fun Automated Trading Bot

A production-ready, fully automated Solana trading bot that detects newly created Pump.fun tokens, evaluates them using strict criteria, executes trades via Jupiter, and automatically exits at 2x profit.

## 🎯 What This Bot Does

This bot implements a **high-conviction, low-frequency** trading strategy:

1. **Discovers** new Pump.fun tokens in real-time via Helius WebSocket
2. **Filters** tokens using strict criteria:
   - Market cap must reach ≥ $20,000 within 60 minutes
   - Token must experience ≥ 40% drawdown from ATH within 60 minutes
   - No single wallet may hold > 30% of supply
3. **Executes** buys through Jupiter (fixed 0.1 SOL per trade)
4. **Monitors** positions every second
5. **Exits** automatically at 2x profit (100% gain)

## 🏗️ Architecture

```
services/pump-trader/
├── src/
│   ├── main.ts                 # Main orchestrator
│   ├── config.ts               # Configuration management
│   ├── logger.ts               # Human-readable logging
│   ├── discovery.ts            # Helius WebSocket listener
│   ├── market-data.ts          # DexScreener API fetcher
│   ├── holder-analyzer.ts      # Token holder concentration
│   ├── token-tracker.ts        # Token lifecycle tracking
│   ├── jupiter-executor.ts     # Jupiter swap execution
│   └── position-manager.ts     # Position monitoring & exit
├── package.json
└── tsconfig.json
```

## 📋 Prerequisites

1. **Node.js** (v18 or higher)
2. **Helius API Key** (free tier works) - [Get one here](https://helius.dev)
3. **Solana wallet** with:
   - SOL for trading (start with ~1 SOL for testing)
   - SOL for transaction fees (~0.01 SOL per trade)
4. **Internet connection** (stable connection required for WebSocket)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd services/pump-trader
npm install
```

### 2. Configure Environment Variables

The bot reads from the root `.env` file. Ensure these are set:

```bash
# Required
HELIUS_API_KEY=your_helius_api_key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Your trading wallet (KEEP SECRET!)
COPY_WALLET_SEED_PHRASE=your twelve or twenty four word seed phrase here
# OR (more secure)
COPY_WALLET_PRIVATE_KEY=your_base58_encoded_private_key

# Trading parameters
FIXED_BUY_AMOUNT_SOL=0.1                    # Amount per trade
SCALPER_ENABLE_LIVE_TRADING=false           # START WITH false!
MAX_SLIPPAGE_BPS=100                        # 1% slippage

# Optional: Override defaults
PUMP_MIN_MCAP_USD=20000                     # Min market cap
PUMP_DRAWDOWN_PERCENT=40                    # Required drawdown %
PUMP_MAX_HOLDER_PERCENT=30                  # Max holder concentration
PUMP_PROFIT_TARGET_MULTIPLIER=2.0           # 2x = 100% profit
```

### 3. Start in Paper Trading Mode (RECOMMENDED)

```bash
npm run dev
```

This will:
- ✅ Connect to Helius WebSocket
- ✅ Track new tokens
- ✅ Evaluate criteria
- ❌ NOT execute real trades (paper trading)

### 4. Enable Live Trading (DANGER!)

Only after you're comfortable with the bot's behavior:

```bash
# In .env, change:
SCALPER_ENABLE_LIVE_TRADING=true
```

Then restart the bot:
```bash
npm run dev
```

## 📊 Understanding the Logs

The bot provides **detailed, human-readable logs** for every decision:

### Token Discovery
```
🆕 [2025-01-15T10:23:45.123Z] NEW TOKEN DETECTED
{
  "mint": "ABC123...",
  "signature": "xyz789...",
  "action": "Starting evaluation process..."
}
```

### Filtering Decisions

**Token Ignored - Too Old**
```
⏰ [2025-01-15T10:25:00.000Z] TOKEN IGNORED - Too Old
{
  "mint": "ABC123...",
  "age": "65.2 minutes",
  "maximum": "60 minutes",
  "reason": "Only tokens younger than 60 minutes are eligible"
}
```

**Token Ignored - Market Cap Too Low**
```
📉 [2025-01-15T10:26:00.000Z] TOKEN IGNORED - Market Cap Too Low
{
  "mint": "ABC123...",
  "currentMarketCap": "$12,345.67",
  "requiredMarketCap": "$20,000.00",
  "reason": "Market cap must reach at least $20,000 within 60 minutes"
}
```

**Token Ignored - Holder Concentration Risk**
```
🐋 [2025-01-15T10:27:00.000Z] TOKEN IGNORED - Holder Concentration Risk
{
  "mint": "ABC123...",
  "topHolder": "XYZ789...",
  "topHolderOwnership": "45.23%",
  "maxAllowed": "30.00%",
  "reason": "Single wallet holds too much supply - high rug pull risk"
}
```

### Qualification & Trading
```
✅ [2025-01-15T10:28:00.000Z] ALL CRITERIA PASSED - READY TO BUY
{
  "mint": "ABC123...",
  "marketCap": "$25,000.00",
  "drawdownFromATH": "42.50%",
  "topHolderConcentration": "18.34%",
  "nextStep": "Executing buy via Jupiter..."
}

🟢 [2025-01-15T10:28:05.000Z] BUY EXECUTED - Position Opened
{
  "mint": "ABC123...",
  "invested": "0.1 SOL",
  "tokensReceived": "1000000",
  "signature": "xyz789...",
  "nextStep": "Monitoring position every second for 2x profit..."
}
```

### Position Monitoring
```
🔍 [2025-01-15T10:28:06.000Z] Position Check
{
  "mint": "ABC123...",
  "invested": "0.1 SOL",
  "currentValue": "0.12 SOL",
  "profit": "20.00%",
  "target": "2x (100.00%)"
}
```

### Exit
```
🎯 [2025-01-15T10:35:00.000Z] PROFIT TARGET REACHED - Selling Position
{
  "mint": "ABC123...",
  "invested": "0.1 SOL",
  "currentValue": "0.2035 SOL",
  "profit": "103.50%",
  "action": "Executing sell via Jupiter..."
}

🔴 [2025-01-15T10:35:05.000Z] SELL EXECUTED - Position Closed
{
  "mint": "ABC123...",
  "tokensSold": "1000000",
  "solReceived": "0.2012 SOL",
  "invested": "0.1 SOL",
  "profit": "0.1012 SOL (101.20%)",
  "signature": "abc456...",
  "status": "✅ Trade Complete"
}
```

## ⚙️ Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `FIXED_BUY_AMOUNT_SOL` | `0.1` | SOL amount per trade |
| `PUMP_MIN_MCAP_USD` | `20000` | Minimum market cap required |
| `PUMP_DRAWDOWN_PERCENT` | `40` | Required drawdown from ATH (%) |
| `PUMP_MAX_HOLDER_PERCENT` | `30` | Max single wallet ownership (%) |
| `PUMP_TOKEN_LIFETIME_MIN` | `60` | Max token age to consider (minutes) |
| `PUMP_ATH_WINDOW_MIN` | `60` | Time window for drawdown after ATH |
| `PUMP_PROFIT_TARGET_MULTIPLIER` | `2.0` | Profit target (2.0 = 2x = 100%) |
| `PUMP_POLL_INTERVAL_MS` | `1000` | Position check frequency (ms) |
| `MAX_SLIPPAGE_BPS` | `100` | Max slippage (100 = 1%) |
| `JITO_TIP_LAMPORTS` | `100000` | Priority fee (0.0001 SOL) |
| `DEXSCREENER_TIMEOUT_MS` | `300000` | Max wait for DexScreener data (5 min) |

## 🛡️ Safety Features

### 1. Paper Trading Mode
- **Default:** `SCALPER_ENABLE_LIVE_TRADING=false`
- Bot simulates all trades without spending real SOL
- Perfect for testing and understanding behavior

### 2. Position Limits
- Maximum 3 concurrent positions
- Prevents overexposure

### 3. Holder Concentration Check
- Rejects tokens where any wallet holds > 30% supply
- Protects against rug pulls

### 4. Age Filtering
- Only considers tokens < 60 minutes old
- Avoids stale opportunities

### 5. Graceful Shutdown
- Press `Ctrl+C` to stop cleanly
- Warns about open positions
- Positions remain tracked if you restart

## 🐛 Troubleshooting

### "Missing required environment variable: HELIUS_API_KEY"
- Make sure your `.env` file is in the project root
- Verify the variable name matches exactly

### "Invalid seed phrase: must be 12 or 24 words"
- Check `COPY_WALLET_SEED_PHRASE` has correct word count
- Or provide `COPY_WALLET_PRIVATE_KEY` in base58 format

### "WebSocket disconnected - Reconnecting..."
- Normal behavior - bot auto-reconnects
- Check your internet connection if persistent

### "DexScreener Timeout"
- DexScreener may not have indexed the token yet
- Bot will skip these automatically

### No tokens detected
- Pump.fun activity is sporadic
- Bot will log when it detects new tokens
- Check Helius dashboard to verify API key is active

## 📈 Performance Expectations

### Win Rate
- This strategy is **selective** - expect to trade only 1-3 tokens per day
- High false positive rate (many tokens won't meet criteria)

### Typical Flow
1. Bot detects 50-100+ new tokens per day
2. 90%+ are filtered out (low mcap, high concentration, no drawdown)
3. 1-3 may meet all criteria
4. Of those, ~30-50% may reach 2x profit

### Capital Efficiency
- 0.1 SOL per trade × 3 max positions = 0.3 SOL at risk
- Profit target: 2x (100% gain)
- Expected profit per successful trade: 0.1 SOL

## ⚠️ Risk Warnings

### 1. This is HIGH RISK
- Pump.fun tokens are extremely volatile
- Many are scams or rug pulls
- You can lose 100% of capital per trade

### 2. No Guarantees
- Past performance ≠ future results
- Bot may miss opportunities due to network latency
- DexScreener data may be delayed or unavailable

### 3. Slippage & Fees
- Trades may execute at worse prices than quoted
- Jupiter routing fees apply
- Solana network fees (~0.000005 SOL per transaction)

### 4. MEV & Front-Running
- Bots with validator access will front-run you
- This bot is NOT competitive for first-block entries
- It trades on **secondary signals** (drawdowns after hype)

## 🔧 Development

### Build
```bash
npm run build
```

### Run Production Build
```bash
npm start
```

### Watch Mode
```bash
npm run watch
```

## 📝 Code Structure

- **`config.ts`**: Centralized configuration loading
- **`logger.ts`**: Human-readable logging system
- **`discovery.ts`**: Helius WebSocket → token creation events
- **`market-data.ts`**: DexScreener API integration
- **`holder-analyzer.ts`**: On-chain holder concentration analysis
- **`token-tracker.ts`**: Lifecycle management (discovery → qualification)
- **`jupiter-executor.ts`**: Swap execution via Jupiter
- **`position-manager.ts`**: 1-second polling loop for exits
- **`main.ts`**: Orchestrator tying everything together

## 🚀 Next Steps

### Level 1 (Current)
- ✅ Public APIs (Helius, DexScreener, Jupiter)
- ✅ Signal-based trading (drawdown detection)
- ✅ Automated execution

### Level 2 (Advanced)
- [ ] Private RPC node
- [ ] Geyser subscription (faster on-chain data)
- [ ] Local AMM simulation (better price estimates)
- [ ] Priority fee optimization (dynamic bidding)

### Level 3 (Pro)
- [ ] Jito bundle submission
- [ ] Validator-adjacent access
- [ ] Pre-confirmation transaction visibility
- [ ] Wallet rotation (avoid detection)
- [ ] Automated capital sizing (Kelly criterion)

## 📄 License

This is educational software. Use at your own risk.

---

**Built with ❤️ for automated Solana trading**

Need help? Check the logs - they explain everything! 📊

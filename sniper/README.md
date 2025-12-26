# 🎯 Strict Solana Token Sniper

A professional-grade, high-quality token sniper for Solana that implements **8 strict validation gates** to filter out rugs, scams, and low-quality launches. This bot prioritizes quality over quantity - it will touch very few launches, but the ones it does touch have strong survivability signals.

## 🌟 Features

### Strict 8-Gate Validation System

1. **Gate A - Liquidity Threshold**: Minimum 75 SOL liquidity, stable for 20+ seconds
2. **Gate B - Mint Authority**: Must be revoked (prevents infinite minting)
3. **Gate C - Freeze Authority**: Must be revoked (prevents token freezing)
4. **Gate D - Route Sanity**: Max 2 hops, ≤6% price impact, ≤3% slippage
5. **Gate E - Round-Trip Simulation**: Buy→Sell test with ≤8% loss (detects sell blocks)
6. **Gate F - Organic Flow**: ≥10 swaps, ≥7 unique wallets, no wallet >35% volume
7. **Gate G - Holder Concentration**: Top1≤20%, Top5≤45%, Top10≤60%
8. **Gate H - Launch Hygiene**: Known DEX patterns (informational)

### Smart Exit Strategy

- **Take Profit 1**: Sell 40% at +40% gain
- **Take Profit 2**: Sell 30% at +80% gain
- **Trailing Stop**: 15% trailing for remaining 30%
- **Stop Loss**: -20% hard stop
- **Time Stop**: Exit if not up 15% within 3 minutes

### Advanced Execution

- Jupiter Aggregator integration for best prices
- Priority fees (configurable: low/medium/high/veryHigh)
- **Jito bundle execution** for MEV protection & guaranteed inclusion
- Automatic retry logic with exponential backoff
- Emergency exit functionality

### 🚀 Multi-Layer Detection System (NEW!)

- **Layer 1: Account-Level Monitoring** (FASTEST) - Catches pool creation at account level
- **Layer 2: WebSocket Logs** - Uses `processed` commitment for ~200ms faster detection
- **Layer 3: Helius Enhanced API** - Monitors pending transactions
- **Layer 4: DexScreener Polling** - Backup detection method

This gives you a **~200-500ms head start** over most retail traders!

### Monitoring & Stats

- Real-time performance tracking
- Gate rejection analytics
- Win/loss tracking
- PnL monitoring
- Detailed logging of all decisions

## 📋 Prerequisites

- Node.js 18+
- Solana wallet with SOL for trading
- Helius API key (for RPC and WebSocket)
- (Optional) Jito block engine access for MEV protection

## 🚀 Installation

1. **Navigate to sniper directory**:
```bash
cd sniper
```

2. **Install dependencies**:
```bash
npm install
```

3. **Set up environment variables**:
```bash
cp .env.example .env
```

4. **Edit `.env` with your configuration**:
```env
# Required
HELIUS_API_KEY=your_helius_api_key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase"

# Trading
SNIPER_BUY_AMOUNT_SOL=0.2
ENABLE_LIVE_TRADING=false  # Set to true for live trading

# Jito Bundle Execution (RECOMMENDED for fastest execution)
ENABLE_JITO_BUNDLE=true
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=100000  # 0.0001 SOL per bundle (increase for priority)
# JITO_TIP_ACCOUNT=  # Optional: specific tip account

# Priority Fees (low/medium/high/veryHigh)
ENTRY_PRIORITY_LEVEL=veryHigh
EXIT_PRIORITY_LEVEL=high
```

## 💻 Usage

### Development Mode (Paper Trading)
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### Quick Start Script
```bash
chmod +x start.sh
./start.sh
```

## ⚙️ Configuration

### Gate Thresholds
Adjust strictness in `.env`:

```env
MIN_LIQUIDITY_SOL=75          # Higher = more strict
MIN_EARLY_SWAPS=10            # More swaps = more organic
MIN_UNIQUE_WALLETS=7          # More wallets = less manipulation
MAX_WALLET_DOMINANCE=0.35     # Lower = more distributed
MAX_TOP_HOLDER_PCT=20         # Lower = less concentrated
MAX_PRICE_IMPACT_PCT=6        # Lower = less slippage
MAX_ROUND_TRIP_LOSS_PCT=8     # Lower = stricter sell test
```

### Exit Strategy
Customize take profits and stops:

```env
TAKE_PROFIT_1_PCT=40          # Sell 40% of position
TAKE_PROFIT_1_AT=40           # When up 40%
TAKE_PROFIT_2_PCT=30          # Sell another 30%
TAKE_PROFIT_2_AT=80           # When up 80%
STOP_LOSS_PCT=20              # Exit if down 20%
TIME_STOP_MINUTES=3           # Exit after 3 min if not up enough
TIME_STOP_MIN_GAIN_PCT=15     # Min gain to avoid time stop
```

### Jito Bundle Execution (RECOMMENDED)

Jito bundles give you:
- **Guaranteed block inclusion** - Skip the transaction queue
- **MEV protection** - Prevent sandwich attacks
- **Atomic execution** - All or nothing

```env
ENABLE_JITO_BUNDLE=true
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=100000      # 0.0001 SOL (minimum recommended)
                               # 200000 = 0.0002 SOL (higher priority)
                               # 500000 = 0.0005 SOL (urgent/competitive)
```

**Tip Amount Guide:**
| Tip (SOL) | Lamports | Priority | Use Case |
|-----------|----------|----------|----------|
| 0.0001    | 100,000  | Normal   | Standard sniping |
| 0.0002    | 200,000  | High     | Competitive launches |
| 0.0005    | 500,000  | Very High| Must-get opportunities |
| 0.001     | 1,000,000| Maximum  | Time-critical trades |

## 📊 Understanding the Output

### Startup Banner
```
╔════════════════════════════════════════════════════════════════╗
║              🎯 STRICT SOLANA TOKEN SNIPER 🎯                 ║
║           High-Quality Launch Detection & Execution            ║
╚════════════════════════════════════════════════════════════════╝
```

### Gate Validation
Each token is logged with:
- ✅ Gate passed
- ❌ Gate failed (with reason)

### Performance Summary (every 5 minutes)
```
╔════════════════════════════════════════════════════════════════╗
║            SNIPER PERFORMANCE SUMMARY                          ║
╠════════════════════════════════════════════════════════════════╣
║ Launches Detected:   127
║ Touch Rate:          2.36%    (very strict is good!)
║ Win Rate:            65.00%
║ Total PnL:           +0.0842 SOL
╠════════════════════════════════════════════════════════════════╣
║ GATE REJECTION BREAKDOWN                                       ║
║ Gate E: 45 (35.4%)  ← Round-trip failures (good catches!)
║ Gate A: 38 (29.9%)  ← Low liquidity
║ Gate F: 24 (18.9%)  ← Poor early flow
╚════════════════════════════════════════════════════════════════╝
```

## 🛡️ Safety Features

1. **Paper Trading Default**: Always test with paper trading first
2. **Balance Checks**: Warns if insufficient balance
3. **Max Concurrent Positions**: Limits exposure (default: 3)
4. **Emergency Exit**: Can force sell with high slippage if needed
5. **Graceful Shutdown**: CTRL+C safely closes positions
6. **Comprehensive Logging**: Every decision is logged

## 📈 Expected Performance

With strict settings:
- **Touch Rate**: 1-5% of launches (very selective)
- **Win Rate**: Target 60-70% (quality over quantity)
- **Risk per Trade**: Fixed at buy amount (e.g., 0.2 SOL)
- **Average Hold Time**: 3-10 minutes

## ⚠️ Important Notes

### What This Bot Does
- ✅ Filters for high-quality launches with strict gates
- ✅ Detects sell blocks via round-trip simulation
- ✅ Checks mint/freeze authority revocation
- ✅ Validates holder distribution
- ✅ Monitors early organic flow
- ✅ Executes with proper slippage protection
- ✅ Manages exits with multi-level take profits

### What This Bot Doesn't Do
- ❌ Guarantee profits (trading is risky)
- ❌ Trade every launch (by design - very strict)
- ❌ Prevent all losses (some winners turn into losers)
- ❌ Handle network outages automatically

### Known Limitations

1. **Holder Concentration Check**: Currently uses mock data. Implement real holder fetching using Helius Digital Asset API or token account enumeration.

2. ~~**Jito Bundle Integration**~~: ✅ **NOW FULLY IMPLEMENTED** - Bundle execution with tip transactions, status monitoring, and automatic fallback to RPC if bundle fails.

3. ~~**WebSocket Monitoring**~~: ✅ **ENHANCED** - Now using multi-layer detection:
   - Account-level monitoring (fastest)
   - `processed` commitment WebSocket (faster than `confirmed`)
   - Helius Enhanced API for pending transactions

4. **Early Swap Tracking**: Requires external swap monitoring. Current implementation assumes swaps are recorded via separate service.

## 🔧 Troubleshooting

### No launches detected
- Check Helius API key is valid
- Verify WebSocket connection in logs
- Ensure RPC endpoint is working

### Trades not executing
- Verify `ENABLE_LIVE_TRADING=true` in `.env`
- Check wallet has sufficient SOL
- Review logs for Jupiter quote failures

### High rejection rate
- This is normal and desired for strict mode!
- Review gate rejection breakdown in stats
- Adjust thresholds if too strict (not recommended)

## 🚀 Future Enhancements

1. **Real Holder Data**: Integrate Helius Digital Asset API
2. **Jito Bundle**: Complete MEV protection implementation
3. **Multi-DEX Support**: Add Orca, Meteora detection
4. **ML Scoring**: Add machine learning risk scoring
5. **Telegram Alerts**: Real-time notifications
6. **Database Integration**: Persistent trade history
7. **Backtest Mode**: Test strategies on historical data

## 📝 License

MIT

## ⚡ Pro Tips

1. **Start with paper trading** - Test for at least 24 hours
2. **Monitor rejection breakdown** - Most rejects should be Gate E (round-trip) and Gate A (liquidity)
3. **Low touch rate is good** - 2-5% is ideal for strict mode
4. **Adjust for network conditions** - Increase priority fees during high congestion
5. **Review positions manually** - Check token contract on Solscan before trading
6. **Use Jito bundles** - Reduces MEV sandwich attacks
7. **Keep SOL balance topped up** - Bot needs SOL for fees and trades

## 🆘 Support

For issues or questions:
1. Check logs in console output
2. Review gate rejection reasons
3. Verify environment configuration
4. Test with paper trading first

---

**⚠️ DISCLAIMER**: This bot is for educational purposes. Cryptocurrency trading involves substantial risk. Never trade with money you can't afford to lose. Past performance does not guarantee future results.

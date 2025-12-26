# Post-Absorption Trading System

## 📖 What This Is

This is a **Post-Liquidity Absorption Trading Bot** that trades the equilibrium that forms after infrastructure wallets neutralize large sell pressure.

### This Is NOT:
- ❌ Copy trading
- ❌ Front-running
- ❌ Wallet mirroring
- ❌ Price prediction
- ❌ MEV (Maximal Extractable Value)
- ❌ Arbitrage
- ❌ Momentum trading

### This IS:
- ✅ **Post-Absorption Trading** - We trade AFTER liquidity stress is absorbed
- ✅ **Liquidity Defense Following** - We enter when defense wallets neutralize cascades
- ✅ **Second-Order Flow Trading** - Infrastructure wallets are first-order, we trade their effects
- ✅ **Equilibrium Trading** - We enter after new price equilibrium forms

---

## 🧠 Core Concept

### The Strategy in One Sentence

**We trade post-liquidity absorption after large sell imbalances are neutralized by infrastructure participants.**

### How It Works

```
1. Large Sell Pressure
   ↓
2. Infrastructure Wallets Absorb (buy)
   ↓
3. Price Stabilizes
   ↓
4. We Enter (second-order)
   ↓
5. Exit with Profit/Stop Loss
```

### Why This Works

1. **No Speed Competition**: We don't compete with MEV bots or front-runners
2. **Confirmed Events**: We only act after absorption is confirmed
3. **Stability First**: We wait for volatility to decrease before entering
4. **Risk-Managed**: We use proper position sizing and stop losses
5. **Retail-Friendly**: No need for specialized infrastructure

---

## 🎯 Strategy Details

### Phase 1: Detection (Absorption Detector)

We monitor infrastructure wallets for patterns where:

1. **Large sell pressure occurs** (configurable threshold, e.g., $10,000+)
2. **Infrastructure wallets step in** and buy within a time window
3. **Absorption ratio is significant** (e.g., they absorb ≥30% of sell volume)

#### Key Parameters:
- `ABSORPTION_MIN_SELL_VOLUME_USD`: Minimum sell volume to qualify as "large pressure"
- `ABSORPTION_MIN_INFRA_BUY_USD`: Minimum infra wallet buy volume
- `ABSORPTION_MIN_RATIO`: Minimum ratio of infra buy / sell volume
- `ABSORPTION_WINDOW_SEC`: Time window to look for absorption after sells

**Example Detection:**
```
Token: PUMP...
- Sell Pressure: $15,000 (10 transactions)
- Infra Absorption: $6,000 (3 buys)
- Absorption Ratio: 40%
- Status: ✅ DETECTED
```

### Phase 2: Confirmation (Stabilization Monitor)

After detecting absorption, we monitor for stabilization:

1. **Price Volatility**: Must drop below threshold (e.g., 5%)
2. **Price Recovery**: Price must not fall further from absorption level
3. **Volume Analysis**: Buy volume should exceed sell volume
4. **Liquidity Check**: Sufficient liquidity must remain
5. **Time Duration**: Monitor for minimum period (e.g., 3 minutes)

#### Key Parameters:
- `STABILIZATION_MONITOR_SEC`: How long to monitor for stability
- `STABILIZATION_MAX_VOLATILITY`: Maximum acceptable volatility (%)
- `STABILIZATION_MIN_RECOVERY`: Minimum price recovery (%)
- `STABILIZATION_MAX_DEVIATION`: Max price deviation from moving average

**Example Stabilization:**
```
Token: PUMP...
✓ Volatility OK (3.2% <= 5%)
✓ Price stable (1.8% deviation)
✓ Price recovered (2.1%)
✓ Liquidity OK ($65,000)
✓ Volume balanced (buy/sell: 1.4)

Status: ✅ STABILIZED (Score: 100)
```

### Phase 3: Entry (Trading Executor)

Once stabilization is confirmed, we enter:

1. **Risk Check**: Verify we haven't hit daily loss limits or max positions
2. **Position Sizing**: Fixed SOL amount per trade (e.g., 0.1 SOL)
3. **Execution**: Swap via Jupiter with slippage protection
4. **Tracking**: Record entry price, time, and associated absorption event

#### Key Parameters:
- `ABSORPTION_BUY_AMOUNT_SOL`: Fixed buy amount per position
- `ABSORPTION_MAX_SLIPPAGE_BPS`: Maximum acceptable slippage
- `ABSORPTION_MAX_POSITIONS`: Maximum concurrent positions
- `ABSORPTION_MIN_LIQUIDITY_USD`: Minimum liquidity to enter

**Example Entry:**
```
🎯 ENTERING POSITION: PUMP
- Amount: 0.1 SOL
- Price: $0.000524
- Absorption Event: PUMP-1735234567
- Entry Signature: 5x7Qw...
```

### Phase 4: Exit (Trading Executor)

We monitor positions and exit based on:

1. **Profit Target**: Exit at configured profit % (e.g., 20%)
2. **Stop Loss**: Exit if loss exceeds threshold (e.g., 15%)
3. **Trailing Stop**: Activate after profit threshold, trail by distance
4. **Max Hold Time**: Exit after maximum duration (e.g., 24 hours)
5. **Idle Exit**: Exit if no movement after period (e.g., 2 hours)

#### Key Parameters:
- `ABSORPTION_PROFIT_TARGET`: Profit target (%)
- `ABSORPTION_STOP_LOSS`: Stop loss (%)
- `ABSORPTION_TRAILING_ACTIVATION`: When to activate trailing stop (%)
- `ABSORPTION_TRAILING_DISTANCE`: Trailing stop distance (%)
- `ABSORPTION_MAX_HOLD_TIME_SEC`: Maximum position hold time
- `ABSORPTION_IDLE_EXIT_TIME_SEC`: Exit if idle this long

**Example Exit:**
```
🚪 EXITING POSITION: PUMP
- Reason: Profit target hit (22.5%)
- Entry Price: $0.000524
- Exit Price: $0.000642
- P&L: 22.5% (0.0225 SOL)
```

---

## 🔒 Risk Management

### Position Limits
- Maximum concurrent positions (prevents over-exposure)
- Token cooldown (prevents churning same token)
- Maximum position size (caps individual risk)

### Portfolio Limits
- Maximum total portfolio exposure
- Maximum daily loss limit (stops trading if hit)
- Maximum per-token exposure

### Exit Protection
- Hard stop losses (prevent large losses)
- Trailing stops (protect profits)
- Time-based exits (prevent dead capital)

---

## 📊 Performance Tracking

The system tracks:
- Daily P&L (in SOL and USD)
- Win rate
- Average hold time
- Number of absorption events detected
- Number of stabilizations confirmed
- Number of positions entered/exited
- Risk metrics (exposure, daily loss, etc.)

---

## 🚀 Getting Started

### Prerequisites
1. Node.js 18+
2. Solana wallet with funds
3. Helius API key (for RPC)
4. Infrastructure wallet addresses (in .env)

### Installation

```bash
cd services/post-absorption-trader
npm install
```

### Configuration

See `.env` for all parameters. Key settings:

```env
# Enable/disable live trading
ABSORPTION_ENABLE_LIVE_TRADING=false  # Start with paper trading!

# Position sizing
ABSORPTION_BUY_AMOUNT_SOL=0.1

# Risk limits
ABSORPTION_MAX_POSITIONS=5
MAX_DAILY_LOSS_USD=100

# Profit/Loss
ABSORPTION_PROFIT_TARGET=20
ABSORPTION_STOP_LOSS=15
```

### Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build
npm start
```

---

## 📈 Strategy Optimization

### Conservative Settings (Lower Risk)
- Higher `ABSORPTION_MIN_SELL_VOLUME_USD` (only trade larger events)
- Higher `ABSORPTION_MIN_RATIO` (require more absorption)
- Lower `STABILIZATION_MAX_VOLATILITY` (require more stability)
- Tighter profit targets and stop losses

### Aggressive Settings (Higher Risk/Reward)
- Lower `ABSORPTION_MIN_SELL_VOLUME_USD` (trade smaller events)
- Lower `ABSORPTION_MIN_RATIO` (less absorption required)
- Higher `STABILIZATION_MAX_VOLATILITY` (tolerate more movement)
- Wider profit targets and stop losses

---

## 🎓 Understanding the Theory

### Why "Post-Absorption" Trading Works

1. **Liquidity Imbalances Create Opportunities**: Large sells create price dislocations
2. **Infrastructure Prevents Cascades**: Infra wallets step in to prevent death spirals
3. **Equilibrium Forms**: After absorption, new price equilibrium forms
4. **Retail Can Participate**: We don't need speed because we trade AFTER events

### The Role of Infrastructure Wallets

Infrastructure wallets are:
- Market makers
- Liquidity providers
- Exchange hot wallets
- Automated trading systems

They absorb sell pressure to:
- Maintain orderly markets
- Prevent cascading liquidations
- Capture spread/fees
- Maintain token liquidity

**We're not copying them. We're trading the result of their actions.**

### Second-Order vs First-Order Trading

**First-Order Traders** (Infrastructure):
- Act on primary market signals
- Provide liquidity
- Require speed and capital
- Compete with MEV

**Second-Order Traders** (Us):
- Act on effects of first-order actions
- Take directional positions
- Don't need speed
- Don't compete with MEV

---

## ⚠️ Important Disclaimers

1. **This is experimental software**: Test thoroughly with small amounts
2. **Not financial advice**: Do your own research
3. **Risk of loss**: Only trade with funds you can afford to lose
4. **Paper trade first**: Use `ABSORPTION_ENABLE_LIVE_TRADING=false` initially
5. **Monitor closely**: Check logs and positions regularly

---

## 🔧 Troubleshooting

### No Absorption Events Detected

- Check that infrastructure wallet addresses are correct
- Lower `ABSORPTION_MIN_SELL_VOLUME_USD` threshold
- Lower `ABSORPTION_MIN_RATIO` requirement
- Verify wallets are active (check on Solscan)

### Stabilization Never Confirmed

- Increase `STABILIZATION_MAX_VOLATILITY` tolerance
- Decrease `STABILIZATION_MIN_SAMPLES` requirement
- Increase `STABILIZATION_MONITOR_SEC` duration

### No Positions Entered

- Check risk limits (daily loss, max positions)
- Verify wallet has sufficient SOL balance
- Check that `ABSORPTION_ENABLE_LIVE_TRADING=true` if needed
- Review logs for rejection reasons

---

## 📚 Additional Resources

- [STRATEGY-EXPLAINED.md](./STRATEGY-EXPLAINED.md) - Deep dive into the strategy
- [CONFIGURATION.md](./CONFIGURATION.md) - Complete parameter reference
- [EXAMPLES.md](./EXAMPLES.md) - Real-world examples and case studies

---

## 🤝 Support

For issues or questions:
1. Check the logs in `logs/post-absorption-trader.log`
2. Review configuration in `.env`
3. Read the documentation
4. Test with paper trading first

---

**Remember**: This is post-absorption trading. We enter AFTER events are confirmed. We don't predict, we don't front-run, we don't compete on speed. We trade the equilibrium.

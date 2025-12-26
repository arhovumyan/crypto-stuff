# Post-Absorption Trader - Quick Start Guide

## What Is This?

A **Post-Liquidity Absorption Trading Bot** that trades AFTER infrastructure wallets absorb large sell pressure.

**This is NOT copy trading. This is NOT front-running. This is second-order flow trading.**

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Install Dependencies

```bash
cd services/post-absorption-trader
npm install
```

### Step 2: Verify Configuration

Check that your [.env](../../.env) file has:

```env
# Infrastructure wallets (already configured)
KNOWN_INFRA_WALLET_1=eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q5YbKQ9sUf
# ... (5 more wallets)

# START IN PAPER TRADING MODE
ABSORPTION_ENABLE_LIVE_TRADING=false

# Reasonable defaults are already set
ABSORPTION_BUY_AMOUNT_SOL=0.1
ABSORPTION_PROFIT_TARGET=20
ABSORPTION_STOP_LOSS=15
```

### Step 3: Run the Bot

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

### Step 4: Watch the Logs

The bot will:
1. ✅ Subscribe to all infrastructure wallets
2. 👀 Monitor for large sell pressure
3. 🎯 Detect when infra wallets absorb sells
4. ⏳ Wait for price stabilization
5. 💰 Enter positions (paper trading, no real trades)
6. 📊 Display status updates

---

## 📖 Understanding the Output

### Absorption Detected
```
[AbsorptionDetector] 🎯 ABSORPTION DETECTED: PUMP...
  - Sell Pressure: $15,000 (10 txs)
  - Infra Absorption: $6,000 (3 buys)
  - Absorption Ratio: 40%
  - Price Impact: -8.5%
```

### Stabilization Confirmed
```
[StabilizationMonitor] ✅ PUMP... STABILIZED (score: 100)
  ✓ Volatility OK (3.2% <= 5%)
  ✓ Price stable (1.8% deviation)
  ✓ Price recovered (2.1%)
  ✓ Liquidity OK ($65,000)
  ✓ Volume balanced (buy/sell: 1.4)
```

### Position Entered
```
[TradingExecutor] 🎯 ENTERING POSITION: PUMP
  - Amount: 0.1 SOL
  - Price: $0.000524
  - Absorption Event: PUMP-1735234567
  📄 Paper trade (no real execution)
```

### Position Exited
```
[TradingExecutor] 🚪 EXITING POSITION: PUMP
  - Reason: Profit target hit (22.5%)
  - Entry Price: $0.000524
  - Exit Price: $0.000642
  - P&L: 22.5% (0.0225 SOL)
  📄 Paper exit (no real execution)
```

---

## 🎓 Next Steps

### 1. Paper Trade for 1-2 Weeks
- Let it run with `ABSORPTION_ENABLE_LIVE_TRADING=false`
- Observe absorption events
- Check stabilization accuracy
- Review hypothetical P&L

### 2. Analyze Results
- How many absorption events detected?
- What % stabilized successfully?
- What was the win rate?
- Did profit targets and stop losses work well?

### 3. Adjust Parameters
- Too many false signals? Increase `ABSORPTION_MIN_RATIO`
- Too few trades? Lower `ABSORPTION_MIN_SELL_VOLUME_USD`
- Getting stopped out too much? Widen `ABSORPTION_STOP_LOSS`
- Not capturing enough profit? Adjust `ABSORPTION_PROFIT_TARGET`

See [CONFIGURATION.md](./CONFIGURATION.md) for all parameters.

### 4. Enable Live Trading (When Ready)
```env
# Only after you're confident in the strategy
ABSORPTION_ENABLE_LIVE_TRADING=true

# Start SMALL
ABSORPTION_BUY_AMOUNT_SOL=0.01  # $1-2 per trade
```

---

## 📊 Monitoring

### View Logs
```bash
# Real-time logs
tail -f logs/post-absorption-trader.log

# Errors only
tail -f logs/post-absorption-trader-error.log
```

### Status Checks
The bot prints status updates every 30 seconds if there's activity:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Status Update]
  📊 Active Absorptions: 2
  💼 Open Positions: 3/5
  💰 Daily P&L: $12.50 (8 trades)
  📈 Portfolio Exposure: $285.00

  Open Positions:
    - PUMP: +15.2% (45m hold)
    - DEGEN: +8.3% (22m hold)
    - MOON: -3.1% (10m hold)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🔧 Common Issues

### No Absorption Events Detected

**Possible causes:**
- Infrastructure wallets not active currently
- Thresholds too strict

**Solutions:**
```env
# Lower the detection thresholds
ABSORPTION_MIN_SELL_VOLUME_USD=5000
ABSORPTION_MIN_RATIO=0.2
```

### Stabilization Never Confirmed

**Possible causes:**
- Markets too volatile
- Monitoring period too short

**Solutions:**
```env
# Be more lenient
STABILIZATION_MAX_VOLATILITY=10
STABILIZATION_MONITOR_SEC=120
```

### "Failed to load wallet" Error

**Cause:** Private key not in correct format

**Solution:**
```env
# Use base58-encoded private key
COPY_WALLET_PRIVATE_KEY=your_base58_key_here

# OR set to paper trading mode
ABSORPTION_ENABLE_LIVE_TRADING=false
```

---

## 📚 Documentation

- [README.md](./README.md) - Complete overview
- [STRATEGY-EXPLAINED.md](./STRATEGY-EXPLAINED.md) - Deep dive into the strategy
- [CONFIGURATION.md](./CONFIGURATION.md) - All parameters explained

---

## ⚠️ Important Reminders

1. **Paper trade first** - Don't enable live trading until you understand the system
2. **Start small** - Use 0.01-0.05 SOL positions when you go live
3. **Monitor daily** - Check logs and positions regularly
4. **Set strict limits** - Use `MAX_DAILY_LOSS_USD` to protect yourself
5. **This is experimental** - Only use funds you can afford to lose

---

## 💡 Strategy Reminder

**We are NOT:**
- ❌ Copying trades
- ❌ Front-running
- ❌ Predicting prices

**We ARE:**
- ✅ Trading post-absorption
- ✅ Waiting for confirmation
- ✅ Managing risk systematically

**The key is patience**: Wait for absorption → Wait for stabilization → Enter with confirmation → Exit with discipline.

---

## 🎯 Success Metrics

After 1-2 weeks of paper trading, evaluate:

- **Win Rate**: Aim for 50%+
- **Risk/Reward**: Average win should be > average loss
- **Frequency**: Getting 5-20 signals per week?
- **Stability Detection**: 70%+ of absorptions stabilize?

If metrics look good, consider small-scale live testing.

---

**Questions?** Read the full documentation in this directory.

**Ready?** Run `npm run dev` and watch the magic happen! 🚀

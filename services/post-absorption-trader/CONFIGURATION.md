# Configuration Reference

Complete guide to all configuration parameters for the Post-Absorption Trading Bot.

---

## 🔧 Core Settings

### `ABSORPTION_ENABLE_LIVE_TRADING`
- **Type**: boolean
- **Default**: `false`
- **Description**: Enable/disable live trading. When `false`, runs in paper trading mode (no real transactions).
- **Recommendation**: Start with `false` until you've validated the strategy.

```env
ABSORPTION_ENABLE_LIVE_TRADING=false  # Paper trading
ABSORPTION_ENABLE_LIVE_TRADING=true   # Live trading
```

---

## 📊 Absorption Detection Parameters

### `ABSORPTION_MIN_SELL_VOLUME_USD`
- **Type**: number (USD)
- **Default**: `10000`
- **Description**: Minimum sell volume required to qualify as "large sell pressure"
- **Impact**: Higher = fewer, larger events. Lower = more, smaller events.

```env
# Conservative (larger events only)
ABSORPTION_MIN_SELL_VOLUME_USD=20000

# Moderate
ABSORPTION_MIN_SELL_VOLUME_USD=10000

# Aggressive (more events)
ABSORPTION_MIN_SELL_VOLUME_USD=5000
```

### `ABSORPTION_MIN_INFRA_BUY_USD`
- **Type**: number (USD)
- **Default**: `5000`
- **Description**: Minimum infra wallet buy volume to consider it "absorption"
- **Impact**: Higher = require stronger absorption. Lower = accept weaker signals.

```env
# Strong absorption only
ABSORPTION_MIN_INFRA_BUY_USD=10000

# Moderate
ABSORPTION_MIN_INFRA_BUY_USD=5000

# Weaker signals accepted
ABSORPTION_MIN_INFRA_BUY_USD=2000
```

### `ABSORPTION_MIN_RATIO`
- **Type**: number (decimal, 0-1)
- **Default**: `0.3`
- **Description**: Minimum ratio of (infra buy volume / sell volume). E.g., 0.3 = absorbed 30% of sells.
- **Impact**: Higher = require more complete absorption. Lower = accept partial absorption.

```env
# High absorption required (50%+)
ABSORPTION_MIN_RATIO=0.5

# Moderate (30%+)
ABSORPTION_MIN_RATIO=0.3

# Low absorption accepted (20%+)
ABSORPTION_MIN_RATIO=0.2
```

### `ABSORPTION_SELL_WINDOW_SEC`
- **Type**: number (seconds)
- **Default**: `120`
- **Description**: Time window to look backward for sell pressure before infra wallet buy
- **Impact**: Longer = detect older sell pressure. Shorter = only recent sells.

```env
ABSORPTION_SELL_WINDOW_SEC=300  # 5 minutes
ABSORPTION_SELL_WINDOW_SEC=120  # 2 minutes
ABSORPTION_SELL_WINDOW_SEC=60   # 1 minute
```

### `ABSORPTION_WINDOW_SEC`
- **Type**: number (seconds)
- **Default**: `300`
- **Description**: Total time window after large sells to look for absorption
- **Impact**: Longer = more lenient timing. Shorter = require fast absorption.

```env
ABSORPTION_WINDOW_SEC=600  # 10 minutes
ABSORPTION_WINDOW_SEC=300  # 5 minutes
ABSORPTION_WINDOW_SEC=180  # 3 minutes
```

---

## ✅ Stabilization Parameters

### `STABILIZATION_MONITOR_SEC`
- **Type**: number (seconds)
- **Default**: `180`
- **Description**: How long to monitor for stability after absorption
- **Impact**: Longer = more confident but slower entry. Shorter = faster but less certain.

```env
STABILIZATION_MONITOR_SEC=300  # 5 minutes - very confident
STABILIZATION_MONITOR_SEC=180  # 3 minutes - balanced
STABILIZATION_MONITOR_SEC=120  # 2 minutes - aggressive
```

### `STABILIZATION_MAX_VOLATILITY`
- **Type**: number (percent)
- **Default**: `5`
- **Description**: Maximum price volatility (standard deviation %) allowed during stabilization
- **Impact**: Lower = require calmer price. Higher = tolerate more movement.

```env
STABILIZATION_MAX_VOLATILITY=3   # Very stable required
STABILIZATION_MAX_VOLATILITY=5   # Moderate stability
STABILIZATION_MAX_VOLATILITY=10  # Tolerate volatility
```

### `STABILIZATION_MIN_SAMPLES`
- **Type**: number (count)
- **Default**: `6`
- **Description**: Minimum number of price samples required (sampled every 30 seconds)
- **Impact**: Higher = more data points. Lower = faster confirmation.

```env
STABILIZATION_MIN_SAMPLES=10  # 5 minutes of samples
STABILIZATION_MIN_SAMPLES=6   # 3 minutes of samples
STABILIZATION_MIN_SAMPLES=4   # 2 minutes of samples
```

### `STABILIZATION_MIN_RECOVERY`
- **Type**: number (percent)
- **Default**: `0`
- **Description**: Minimum % price recovery from absorption price to enter. 0 = can be flat or up.
- **Impact**: Higher = require price recovery. Lower/negative = accept further drops.

```env
STABILIZATION_MIN_RECOVERY=5   # Must recover 5%
STABILIZATION_MIN_RECOVERY=0   # Can be flat
STABILIZATION_MIN_RECOVERY=-5  # Can drop 5% more
```

### `STABILIZATION_MAX_DEVIATION`
- **Type**: number (percent)
- **Default**: `3`
- **Description**: Maximum % deviation of current price from moving average
- **Impact**: Lower = require price near average. Higher = allow more deviation.

```env
STABILIZATION_MAX_DEVIATION=2   # Very tight
STABILIZATION_MAX_DEVIATION=3   # Moderate
STABILIZATION_MAX_DEVIATION=5   # Loose
```

---

## 💰 Entry Parameters

### `ABSORPTION_BUY_AMOUNT_SOL`
- **Type**: number (SOL)
- **Default**: `0.1`
- **Description**: Fixed amount of SOL to invest per position
- **Impact**: Higher = larger positions. Lower = smaller positions.

```env
ABSORPTION_BUY_AMOUNT_SOL=0.01   # $1-2 per trade (testing)
ABSORPTION_BUY_AMOUNT_SOL=0.1    # $10-20 per trade
ABSORPTION_BUY_AMOUNT_SOL=1.0    # $100-200 per trade
```

### `ABSORPTION_MAX_SLIPPAGE_BPS`
- **Type**: number (basis points, 100 = 1%)
- **Default**: `100`
- **Description**: Maximum acceptable slippage on entry
- **Impact**: Higher = accept worse fills. Lower = stricter fills but may fail.

```env
ABSORPTION_MAX_SLIPPAGE_BPS=50   # 0.5% - very tight
ABSORPTION_MAX_SLIPPAGE_BPS=100  # 1% - moderate
ABSORPTION_MAX_SLIPPAGE_BPS=200  # 2% - loose
```

### `ABSORPTION_MIN_LIQUIDITY_USD`
- **Type**: number (USD)
- **Default**: `50000`
- **Description**: Minimum liquidity required to enter position
- **Impact**: Higher = safer but fewer opportunities. Lower = more risk but more trades.

```env
ABSORPTION_MIN_LIQUIDITY_USD=100000  # Very safe
ABSORPTION_MIN_LIQUIDITY_USD=50000   # Moderate
ABSORPTION_MIN_LIQUIDITY_USD=25000   # Aggressive
```

### `ABSORPTION_MAX_POSITIONS`
- **Type**: number (count)
- **Default**: `5`
- **Description**: Maximum concurrent open positions
- **Impact**: Higher = more diversification but more capital needed. Lower = concentrated risk.

```env
ABSORPTION_MAX_POSITIONS=3   # Conservative
ABSORPTION_MAX_POSITIONS=5   # Moderate
ABSORPTION_MAX_POSITIONS=10  # Aggressive
```

### `ABSORPTION_TOKEN_COOLDOWN_SEC`
- **Type**: number (seconds)
- **Default**: `3600`
- **Description**: Cooldown period before trading same token again
- **Impact**: Longer = prevent churning. Shorter = allow faster re-entry.

```env
ABSORPTION_TOKEN_COOLDOWN_SEC=7200  # 2 hours
ABSORPTION_TOKEN_COOLDOWN_SEC=3600  # 1 hour
ABSORPTION_TOKEN_COOLDOWN_SEC=1800  # 30 minutes
```

---

## 🎯 Exit Strategy Parameters

### `ABSORPTION_PROFIT_TARGET`
- **Type**: number (percent)
- **Default**: `20`
- **Description**: Profit target % to exit position
- **Impact**: Higher = hold for bigger gains but risk reversal. Lower = take profits sooner.

```env
ABSORPTION_PROFIT_TARGET=10   # Quick profits
ABSORPTION_PROFIT_TARGET=20   # Moderate target
ABSORPTION_PROFIT_TARGET=50   # Aggressive target
```

### `ABSORPTION_STOP_LOSS`
- **Type**: number (percent)
- **Default**: `15`
- **Description**: Stop loss % (negative P&L triggers exit)
- **Impact**: Tighter = smaller losses but more stopped out. Wider = bigger potential losses.

```env
ABSORPTION_STOP_LOSS=10   # Tight stop
ABSORPTION_STOP_LOSS=15   # Moderate stop
ABSORPTION_STOP_LOSS=25   # Wide stop
```

### `ABSORPTION_TRAILING_ACTIVATION`
- **Type**: number (percent)
- **Default**: `15`
- **Description**: % profit required to activate trailing stop
- **Impact**: Lower = activate sooner. Higher = activate later.

```env
ABSORPTION_TRAILING_ACTIVATION=10  # Activate early
ABSORPTION_TRAILING_ACTIVATION=15  # Moderate
ABSORPTION_TRAILING_ACTIVATION=25  # Activate late
```

### `ABSORPTION_TRAILING_DISTANCE`
- **Type**: number (percent)
- **Default**: `8`
- **Description**: % distance of trailing stop from highest profit
- **Impact**: Tighter = lock in more profit but risk whipsaw. Wider = allow more retracement.

```env
ABSORPTION_TRAILING_DISTANCE=5   # Tight trailing
ABSORPTION_TRAILING_DISTANCE=8   # Moderate trailing
ABSORPTION_TRAILING_DISTANCE=15  # Wide trailing
```

### `ABSORPTION_MAX_HOLD_TIME_SEC`
- **Type**: number (seconds)
- **Default**: `86400` (24 hours)
- **Description**: Maximum time to hold a position
- **Impact**: Shorter = force exits sooner. Longer = allow more time.

```env
ABSORPTION_MAX_HOLD_TIME_SEC=43200   # 12 hours
ABSORPTION_MAX_HOLD_TIME_SEC=86400   # 24 hours
ABSORPTION_MAX_HOLD_TIME_SEC=172800  # 48 hours
```

### `ABSORPTION_IDLE_EXIT_TIME_SEC`
- **Type**: number (seconds)
- **Default**: `7200` (2 hours)
- **Description**: Exit if no significant movement after this time
- **Impact**: Shorter = free capital faster. Longer = give more time.

```env
ABSORPTION_IDLE_EXIT_TIME_SEC=3600   # 1 hour
ABSORPTION_IDLE_EXIT_TIME_SEC=7200   # 2 hours
ABSORPTION_IDLE_EXIT_TIME_SEC=14400  # 4 hours
```

---

## 🔒 Risk Management Parameters

### `MAX_DAILY_LOSS_USD`
- **Type**: number (USD)
- **Default**: `100`
- **Description**: Maximum daily loss before stopping trading
- **Impact**: Higher = more risk. Lower = more protection.

```env
MAX_DAILY_LOSS_USD=50    # Conservative
MAX_DAILY_LOSS_USD=100   # Moderate
MAX_DAILY_LOSS_USD=200   # Aggressive
```

### `MAX_TOKEN_EXPOSURE_USD`
- **Type**: number (USD)
- **Default**: `150`
- **Description**: Maximum exposure per single token
- **Impact**: Higher = larger single positions. Lower = more diversification.

```env
MAX_TOKEN_EXPOSURE_USD=100   # Conservative
MAX_TOKEN_EXPOSURE_USD=150   # Moderate
MAX_TOKEN_EXPOSURE_USD=300   # Aggressive
```

### `ABSORPTION_MAX_PORTFOLIO_USD`
- **Type**: number (USD)
- **Default**: `500`
- **Description**: Maximum total portfolio exposure across all positions
- **Impact**: Higher = more capital deployed. Lower = more conservative.

```env
ABSORPTION_MAX_PORTFOLIO_USD=200   # Conservative
ABSORPTION_MAX_PORTFOLIO_USD=500   # Moderate
ABSORPTION_MAX_PORTFOLIO_USD=1000  # Aggressive
```

---

## 📈 Recommended Configurations

### Conservative (Low Risk, Low Return)
```env
ABSORPTION_ENABLE_LIVE_TRADING=false
ABSORPTION_BUY_AMOUNT_SOL=0.01
ABSORPTION_MIN_SELL_VOLUME_USD=20000
ABSORPTION_MIN_RATIO=0.5
STABILIZATION_MAX_VOLATILITY=3
ABSORPTION_PROFIT_TARGET=15
ABSORPTION_STOP_LOSS=10
ABSORPTION_MAX_POSITIONS=3
MAX_DAILY_LOSS_USD=50
```

### Moderate (Balanced Risk/Return)
```env
ABSORPTION_ENABLE_LIVE_TRADING=false
ABSORPTION_BUY_AMOUNT_SOL=0.1
ABSORPTION_MIN_SELL_VOLUME_USD=10000
ABSORPTION_MIN_RATIO=0.3
STABILIZATION_MAX_VOLATILITY=5
ABSORPTION_PROFIT_TARGET=20
ABSORPTION_STOP_LOSS=15
ABSORPTION_MAX_POSITIONS=5
MAX_DAILY_LOSS_USD=100
```

### Aggressive (High Risk, High Return)
```env
ABSORPTION_ENABLE_LIVE_TRADING=true
ABSORPTION_BUY_AMOUNT_SOL=0.5
ABSORPTION_MIN_SELL_VOLUME_USD=5000
ABSORPTION_MIN_RATIO=0.2
STABILIZATION_MAX_VOLATILITY=10
ABSORPTION_PROFIT_TARGET=30
ABSORPTION_STOP_LOSS=20
ABSORPTION_MAX_POSITIONS=10
MAX_DAILY_LOSS_USD=200
```

---

## 🔍 Testing Configuration

For initial testing and validation:

```env
# Paper trading ONLY
ABSORPTION_ENABLE_LIVE_TRADING=false

# Very small positions
ABSORPTION_BUY_AMOUNT_SOL=0.01

# Moderate detection settings
ABSORPTION_MIN_SELL_VOLUME_USD=10000
ABSORPTION_MIN_RATIO=0.3

# Strict stabilization
STABILIZATION_MONITOR_SEC=180
STABILIZATION_MAX_VOLATILITY=5

# Conservative targets
ABSORPTION_PROFIT_TARGET=20
ABSORPTION_STOP_LOSS=15

# Limited positions
ABSORPTION_MAX_POSITIONS=3
MAX_DAILY_LOSS_USD=50
```

---

## ⚙️ Advanced Tuning

### High-Frequency Setup (More Trades)
- Lower `ABSORPTION_MIN_SELL_VOLUME_USD`
- Lower `ABSORPTION_MIN_RATIO`
- Shorter `STABILIZATION_MONITOR_SEC`
- Higher `STABILIZATION_MAX_VOLATILITY`
- More `ABSORPTION_MAX_POSITIONS`

### Quality-Focused Setup (Fewer, Better Trades)
- Higher `ABSORPTION_MIN_SELL_VOLUME_USD`
- Higher `ABSORPTION_MIN_RATIO`
- Longer `STABILIZATION_MONITOR_SEC`
- Lower `STABILIZATION_MAX_VOLATILITY`
- Fewer `ABSORPTION_MAX_POSITIONS`

### Scalping Setup (Quick In/Out)
- Lower `ABSORPTION_PROFIT_TARGET` (10-15%)
- Tighter `ABSORPTION_STOP_LOSS` (8-10%)
- Shorter `ABSORPTION_IDLE_EXIT_TIME_SEC`
- More aggressive stabilization parameters

### Swing Setup (Hold Longer)
- Higher `ABSORPTION_PROFIT_TARGET` (30-50%)
- Wider `ABSORPTION_STOP_LOSS` (20-25%)
- Longer `ABSORPTION_MAX_HOLD_TIME_SEC`
- Use trailing stops aggressively

---

**Recommendation**: Start with the Moderate configuration in paper trading mode. After 1-2 weeks of observation, adjust based on your results and risk tolerance.

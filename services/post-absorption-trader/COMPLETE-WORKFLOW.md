# 🎯 POST-ABSORPTION TRADING BOT - COMPLETE WORKFLOW

## 🎭 WHAT WE ARE (AND AREN'T)

**THIS IS NOT:**
- ❌ Copy trading (we don't mirror wallet trades)
- ❌ Front-running (we don't trade BEFORE events)
- ❌ Following retail (we ignore normal traders)

**THIS IS:**
- ✅ **Second-order flow trading** - We trade the equilibrium AFTER infrastructure wallets absorb sell pressure
- ✅ **Post-absorption entry** - We wait for stabilization, THEN enter
- ✅ **Smart money confirmation** - We only trade when infra wallets signal absorption

---

## 🔍 THE COMPLETE WORKFLOW

### **PHASE 1: DETECTION** 🔭

**What we're watching:**
```
4 Infrastructure Wallets (Pump.fun market makers):
1. eGkFSm9YaJ92gEUssj9SRzGwkxsLrpjq6Q5YbKQ9sUf
2. ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT
3. FSkmRPArUnFFGZuRUdZ1W7vh5Hm7KqgjDQ19UBjW2kbC
4. 7jDVmS8HBdDNdtGXSxepjcktvG6FzbPurZvYUVgY7TG5
```

**How we monitor:**
- **WebSocket subscriptions** - Real-time transaction feed
- **10-second polling** - Backup detection mechanism
- **Dual detection** - Both Token + WSOL changes tracked

⚠️ **CRITICAL LIMITATION:** This list is hardcoded and brittle. If these wallets rotate strategy, get copied by others, or stop trading, the entire edge decays. Need confidence scoring + re-validation system (see improvement section).

---

**What triggers our interest:**

Every Pump.fun swap has TWO token changes:
1. **The actual token** (e.g., NOMORE67, SOMETOKEN, etc.)
2. **WSOL** (Wrapped SOL - the medium of exchange)

Example transaction:
```
Infra Wallet: FSkmRP... 
Token: H9FzJmC2... (NOMORE67)
Change: -1,741,788.343 NOMORE67 (SELL)
WSOL:   +3.588109127 WSOL (RECEIVE)

Our Detection:
💰 WSOL change: +3.5881 WSOL
🪙 Token change: H9FzJmC2... -1741788.343
✅ Valid swap: SELL H9FzJmC2... for 3.5881 SOL
```

---

### **PHASE 2: ABSORPTION ANALYSIS** 📊

**When infra wallet BUYS a token, we check:**

#### Signal Type 1: Traditional Absorption
```
Requirements:
✓ Price recently dropped ≥3% (configurable)
✓ Infra wallet bought ≥0.3 SOL of the token (configurable)
✓ This indicates: "Price dipped, infra absorbed the dip"
```

#### Signal Type 2: Strong Accumulation
```
Requirements:
✓ Infra wallet bought ≥1.5 SOL (5x normal minimum)
✓ Even without visible price drop
✓ This indicates: "Infra is heavily accumulating"
```

#### Additional Filters:
```
✓ Liquidity ≥$5,000 USD (prevents rug pulls)
✓ Not on cooldown (5 minutes between same token)
✓ Token traded with WSOL (not native SOL only)
```

**Absorption Event Created:**
```
Status: "detected" 
Token: H9FzJmC2S1HJP81ELdGWYtiPRPLDdhFTHdyL6HXYpump
Buy Volume: 3.5881 SOL
Price at Absorption: $0.00123
Signal Type: DIP_ABSORPTION
Triggered By: FSkmRP...
```

---

### **PHASE 3: STABILIZATION CONFIRMATION** ⏳

**We DON'T trade immediately!** We wait 60+ seconds to confirm stability.

**Monitoring Period:**
- **Duration:** 60 seconds minimum (configurable)
- **Price Samples:** Collected every 15 seconds
- **Checks:** 5 critical stability checks

#### The 5 Stability Checks:

**1. Volatility Check ✓**
```
Measure: Standard deviation of price samples
Threshold: ≤10% volatility (configurable)
Pass: "Volatility OK (7.2% ≤ 10%)"
Fail: "High volatility (15.8% > 10%)"
```

**2. Price Stability Check ✓**
```
Measure: Current price vs. average price deviation
Threshold: ≤8% deviation (configurable)
Pass: "Price stable (3.4% deviation)"
Fail: "Price unstable (12.1% deviation)"
```

**3. Price Recovery Check ✓**
```
Measure: Current price vs. price at absorption
Threshold: ≥-5% (can be slightly lower, configurable)
Pass: "Price recovered (+2.3%)"
Fail: "Price not recovered (-12.5%)"
```

**4. Liquidity Check ✓**
```
Measure: Current liquidity in USD
Threshold: ≥$5,000 USD (configurable)
Pass: "Liquidity OK ($25,430)"
Fail: "Low liquidity ($3,200)"
```

⚠️ **WARNING:** This check does NOT prevent rugs. It only filters illiquid garbage.

**What liquidity ≥$5k DOES NOT protect against:**
- ❌ Freeze authority (token can be frozen)
- ❌ Mint authority (infinite supply can be minted)
- ❌ Extreme holder concentration (1 wallet owns 80%)
- ❌ Pool manipulation (fake liquidity)
- ❌ LP removal (liquidity can disappear instantly)

**What's missing:** Token safety checklist from UPGRADE-SPEC (mint/freeze checks, holder distribution, pool ownership, etc.)

**5. Volume Ratio Check ✓**
```
Measure: Recent buy volume / sell volume (infra wallets only)
Threshold: ≥0.5 (relaxed since we only see infra)
Pass: "Volume acceptable (buy/sell: 1.2)"
Fail: "Heavy selling (buy/sell: 0.3)"
```

#### ⚠️ KNOWN WEAKNESSES IN STABILIZATION:

**Problem 1: Insufficient sampling**
- Only 4-5 price samples over 60 seconds (every 15s)
- Can easily miss second leg down or distribution spikes
- Volatility math can pass while still in active dump

**Problem 2: Ignoring broader flow**
- Only tracking infra buy/sell ratio
- Ignoring retail flow, other wallets, overall market pressure
- Missing: "no new large sells during window" as hard requirement

**Problem 3: Missing defense confirmation**
- Not checking if defended level actually holds
- Not counting "higher lows" as stability signal
- Price can be "stable" while slowly bleeding

**SHOULD ADD (not implemented yet):**
- ❌ "No large sells (>0.5 SOL) during stabilization window"
- ❌ "Defended level holds" (price bounces off support)
- ❌ "Higher lows count" (at least 2 higher lows in window)
- ❌ Broader market flow analysis (not just infra wallets)

**Stabilization Score:**
```
Score = (Passed Checks / Total Checks) × 100
Result: 100 = All checks passed → STABLE ✅
Result: <100 = Some checks failed → NOT STABLE ⏳
```

**Status Update:**
```
If Stable: Status → "monitoring" → ready for entry
If Unstable: Keep monitoring (up to 180 seconds max)
If Timeout: Status → "expired" → abandon opportunity
```

---

### **PHASE 4: ENTRY EXECUTION** 🎯

**Risk Checks Before Entry:**

```
1. Position Limit Check:
   - Current Positions: 0/5 (max 5 concurrent)
   - Pass: Can open new position

2. Portfolio Exposure Check:
   - Current Exposure: $0
   - Max Exposure: $500 USD
   - Pass: Room for $10 position

3. Daily Loss Check:
   - Daily P&L: $0
   - Max Daily Loss: -$100 USD
   - Pass: No losses yet today

4. Token Cooldown Check:
   - Last Trade: Never
   - Cooldown: 5 minutes
   - Pass: Can trade this token
```

**Entry Parameters:**
```
Fixed Buy Amount: 0.1 SOL (configurable)
Max Slippage: 1% (100 basis points)
Entry Price: Current market price
Routing: Jupiter Aggregator (best route)
```

⚠️ **EXECUTION IS UNDERSPECIFIED FOR REAL CONDITIONS**

**What's missing:**

1. **Fresh Quote Requirement**
   - Current: Uses whatever Jupiter returns
   - Should: Abort if quote is >5 seconds old
   - Why: Pump tokens move 10%+ in seconds

2. **Max Price Impact Guard**
   - Current: Only checks 1% slippage
   - Should: Separate price impact limit (e.g., 3%)
   - Why: Slippage tolerance ≠ acceptable price impact

3. **Quote Staleness Check**
   - Current: No check between signal → execution
   - Should: Abort if price moved >2% since stabilization confirmed
   - Why: Can enter into a new pump/dump cycle

4. **Retry Policy**
   - Current: Single attempt → falls back to paper trade
   - Should: 2-3 retries with fresh quotes, then abort
   - Why: Transient RPC errors shouldn't kill real trades

5. **MEV Protection**
   - Current: None
   - Should: Private transaction routing or Jito bundles
   - Why: Public txs get sandwiched on Pump tokens

**These gaps cause poor fills under volatility.**

**Live Trade Execution:**
```javascript
1. Call Jupiter API:
   - Input: 0.1 SOL (100,000,000 lamports)
   - Output: H9FzJmC2... token
   - Slippage: 1%

2. Sign Transaction:
   - Wallet: 9JmeM26hgsceGwtpxiM8RZndPF3jkMDQMUtmMyi8F7WM
   - Private Key: From seed phrase in .env

3. Execute Swap:
   - Send signed transaction to Solana
   - Wait for confirmation

4. Create Position:
   Position {
     id: "H9FzJmC2...-1703644285000"
     token: H9FzJmC2S1HJP81ELdGWYtiPRPLDdhFTHdyL6HXYpump
     entryPrice: $0.00123
     entryAmountSol: 0.1
     entryAmountToken: 8,130.08
     remainingTokens: 8,130.08 (100%)
     signature: 3abc123...xyz789
     triggeredByWallet: FSkmRP...
     status: "open"
   }
```

**Trade History Saved:**
```json
{
  "id": "H9FzJmC2...-1703644285000",
  "token": "H9FzJmC2S1HJP81ELdGWYtiPRPLDdhFTHdyL6HXYpump",
  "entryTime": "2025-12-27T02:44:45.860Z",
  "entryPrice": 0.00123,
  "entryAmountSol": 0.1,
  "entryAmountToken": 8130.08,
  "entrySignature": "3abc123...xyz789",
  "triggeredByWallet": "FSkmRP...",
  "status": "open",
  "isPaperTrade": false
}
```

---

### **PHASE 5: POSITION MONITORING** 📈

**Continuous Monitoring (Every 10 seconds):**

```
For Each Open Position:
  1. Fetch Current Price (Jupiter/DexScreener)
  2. Calculate P&L
  3. Update Highest/Lowest Price
  4. Check Exit Conditions
  5. Log Status
```

**Example Monitoring Log:**
```
[Position] NOMORE67: +12.5% | $0.00138 | Hold: 5.2m | Remaining: 100%
[Position] NOMORE67: +23.8% | $0.00152 | Hold: 8.7m | Remaining: 100%
[Position] NOMORE67: +32.4% | $0.00163 | Hold: 12.1m | Remaining: 100%
```

---

### **PHASE 6: EXIT STRATEGY** 🚪

## 🎯 TIERED EXIT SYSTEM

We use a **3-level tiered exit** strategy:

### **Level 1: Partial Profit (30% gain)**
```
Trigger: Price up 30%
Action: SELL 50% of position
Keep: 50% riding for higher targets
Reason: "Lock in gains, let winners run"

Example:
Entry: $0.00123 → Price: $0.00160 (+30.1%)
Sell: 4,065 tokens (50%) → Get ~0.052 SOL
Keep: 4,065 tokens (50%) → Let it ride

Status: "partial_exit"
Remaining: 50%
```

### **Level 2: Full Profit (50% gain)**
```
Trigger: Price up 50%
Action: SELL 100% of remaining position
Keep: Nothing (fully closed)
Reason: "Hit profit target"

Example:
Entry: $0.00123 → Price: $0.00185 (+50.4%)
Sell: 4,065 tokens (remaining 50%) → Get ~0.075 SOL
Keep: 0 tokens

Status: "closed"
Remaining: 0%
Total Gain: ~0.127 SOL (+27% on original 0.1 SOL)
```

### **Level 3: Stop Loss (-20% loss)**
```
Trigger: Price down 20%
Action: SELL 100% of position IMMEDIATELY
Keep: Nothing (cut losses)
Reason: "Stop loss hit - protect capital"

Example:
Entry: $0.00123 → Price: $0.00098 (-20.3%)
Sell: 8,130 tokens (100%) → Get ~0.080 SOL
Keep: 0 tokens

Status: "closed"
Remaining: 0%
Total Loss: ~-0.020 SOL (-20% on original 0.1 SOL)
```

### **Level 4: MISSING - Distribution/Defense Stop ⚠️**

**CRITICAL EXIT NOT IMPLEMENTED:**

The entire thesis is "infra defended a level" - but we don't exit when defense disappears.

**Should exit when:**
- ❌ Infra starts selling in clusters (3+ sells within 5 minutes)
- ❌ Defense level breaks (price falls through defended support)
- ❌ Volume spike + price stall (distribution signal)
- ❌ Infra wallet activity drops to zero (defense abandoned)

**Why this matters:**
- Current exits are mechanical (TP/SL/time/idle)
- Don't react to invalidation of entry thesis
- Can hold through distribution while waiting for -20% stop
- Miss early exit signals when smart money leaves

**This is a MAJOR gap in the exit logic.**

---

## 📊 COMPLETE TRADE LIFECYCLE EXAMPLE

### **Real Trade Sequence:**

```
1. DETECTION (00:00)
   [WalletListener] 💰 WSOL change: +3.5881 WSOL
   [WalletListener] 🪙 Token change: H9FzJmC2... -1741788
   [WalletListener] ✅ Valid swap: SELL H9FzJmC2... for 3.5881 SOL

2. ABSORPTION ANALYSIS (00:01)
   [AbsorptionDetector] ✅ Signal type: DIP_ABSORPTION
   [AbsorptionDetector] Price: $0.00123, Drop: 5.2%
   [AbsorptionDetector] Buy Volume: 3.5881 SOL
   [AbsorptionDetector] Liquidity: $25,430 USD ✓
   → Status: "detected"

3. STABILIZATION MONITORING (00:02-01:02)
   [StabilizationMonitor] Started monitoring H9FzJmC2...
   [StabilizationMonitor] Sample 1: $0.00124 (00:17)
   [StabilizationMonitor] Sample 2: $0.00122 (00:32)
   [StabilizationMonitor] Sample 3: $0.00123 (00:47)
   [StabilizationMonitor] Sample 4: $0.00125 (01:02)
   
   [StabilizationMonitor] ✅ H9FzJmC2... STABILIZED (score: 100)
     ✓ Volatility OK (4.2% ≤ 10%)
     ✓ Price stable (1.8% deviation)
     ✓ Price recovered (+0.8%)
     ✓ Liquidity OK ($25,430)
     ✓ Volume acceptable (buy/sell: 1.1)
   → Status: "monitoring" → ready for entry

4. ENTRY EXECUTION (01:03)
   [TradingExecutor] 🎯 ENTERING POSITION: H9FzJmC2
   [TradingExecutor] Amount: 0.1 SOL
   [TradingExecutor] Price: $0.00123
   [Jupiter] Getting order: SOL → H9FzJmC2...
   [Jupiter] ✅ Swap successful: 3abc123...xyz789
   [TradingExecutor] Received: 8,130.08 tokens
   → Status: "entered"
   → Position: OPEN

5. MONITORING (01:03-08:00)
   [Position] H9FzJmC2: +5.2% | $0.00129 | Hold: 2.0m | Remaining: 100%
   [Position] H9FzJmC2: +12.8% | $0.00139 | Hold: 3.5m | Remaining: 100%
   [Position] H9FzJmC2: +18.9% | $0.00146 | Hold: 5.1m | Remaining: 100%
   [Position] H9FzJmC2: +25.2% | $0.00154 | Hold: 6.8m | Remaining: 100%

6. PARTIAL EXIT (08:12)
   [Position] H9FzJmC2: +30.9% | $0.00161 | Hold: 8.2m | Remaining: 100%
   [TradingExecutor] 🚪 EXITING POSITION: H9FzJmC2
   [TradingExecutor] Sell: 50% (4,065 tokens)
   [TradingExecutor] Reason: 📈 30% PROFIT - Taking 50% off
   [Jupiter] ✅ LIVE SELL EXECUTED: 7xyz987...cba321
   [TradingExecutor] Received: 0.0524 SOL
   → Status: "partial_exit"
   → Remaining: 50%

7. CONTINUED MONITORING (08:12-15:30)
   [Position] H9FzJmC2: +35.7% | $0.00167 | Hold: 10.5m | Remaining: 50%
   [Position] H9FzJmC2: +42.3% | $0.00175 | Hold: 12.8m | Remaining: 50%
   [Position] H9FzJmC2: +48.1% | $0.00182 | Hold: 14.2m | Remaining: 50%

8. FULL EXIT (15:45)
   [Position] H9FzJmC2: +51.2% | $0.00186 | Hold: 15.8m | Remaining: 50%
   [TradingExecutor] 🚪 EXITING POSITION: H9FzJmC2
   [TradingExecutor] Sell: 100% (4,065 tokens remaining)
   [TradingExecutor] Reason: 🚀 50% PROFIT TARGET HIT
   [Jupiter] ✅ LIVE SELL EXECUTED: 5def456...fed123
   [TradingExecutor] Received: 0.0756 SOL
   → Status: "closed"
   → Remaining: 0%

9. TRADE COMPLETED
   ═══════════════════════════════════════════════════
   TRADE SUMMARY
   ═══════════════════════════════════════════════════
   Token: H9FzJmC2S1HJP81ELdGWYtiPRPLDdhFTHdyL6HXYpump
   Entry: 0.1 SOL → 8,130.08 tokens @ $0.00123
   Exit 1: 4,065 tokens (50%) → 0.0524 SOL @ $0.00161 (+30.9%)
   Exit 2: 4,065 tokens (50%) → 0.0756 SOL @ $0.00186 (+51.2%)
   
   Total In:  0.1000 SOL
   Total Out: 0.1280 SOL
   Net P&L:   +0.0280 SOL (+28.0%)
   Hold Time: 15.8 minutes
   
   Daily Stats:
   Trades Today: 1
   Daily P&L: +$3.42 USD (assuming SOL = $122)
   ═══════════════════════════════════════════════════
```

---

## ⚙️ CONFIGURATION & LIMITS

### **Position Limits**
```
Max Concurrent Positions: 5
Fixed Buy Amount: 0.1 SOL per position
Max Slippage: 1% (100 bps)
Max Portfolio Exposure: $500 USD
```

⚠️ **THESE PARAMETERS ARE TOO AGGRESSIVE FOR FIRST LIVE RUNS**

**The problem:**
- 5 concurrent positions in Pump tokens = high correlation risk
- $500 total exposure with -20% stops = $100 max loss (but slippage gaps can blow past -20%)
- On fast dumps, you can lose 30-40% before fills execute
- Tail risk is much higher than the math suggests

**UPGRADE-SPEC recommends (safer defaults):**
```
Start with: 1 position max
Size: 0.05 SOL (not 0.1)
Stop loss: -15% (tighter)
Take profit: +20% / +40% (earlier exits)
Time stop: 4 hours (not 24)
```

**Scale up ONLY after proven profitable over 50+ trades.**

### **Risk Limits**
```
Max Daily Loss: -$100 USD
Max Token Exposure: $150 USD per token
Token Cooldown: 5 minutes between trades
```

### **Entry Requirements**
```
Min Infra Buy Volume: 0.3 SOL (normal signal)
Min Strong Buy Volume: 1.5 SOL (5x signal)
Min Price Drop: 3% (for dip absorption)
Min Liquidity: $5,000 USD
```

### **Stabilization Requirements**
```
Monitor Duration: 60 seconds minimum
Min Price Samples: 2 samples
Max Volatility: 10%
Max Price Deviation: 8%
Min Price Recovery: -5% (can be slightly lower)
Volume Ratio Threshold: 0.5 (buy/sell)
```

### **Exit Triggers**
```
Level 1 (Partial): +30% profit → Sell 50%
Level 2 (Full):    +50% profit → Sell 100%
Level 3 (Stop):    -20% loss   → Sell 100%
Max Hold Time: 24 hours (forced exit)
Idle Time Exit: 2 hours (if no movement)
```

---

## 🎮 RESTRICTIONS & RULES

### **What We DON'T Trade:**
- ❌ WSOL itself (it's just wrapped SOL, not a token)
- ❌ Tokens with <$5k liquidity
- ❌ Transactions <0.1 SOL value
- ❌ Tokens on cooldown (<5 min since last trade)
- ❌ When max positions reached (5/5)
- ❌ When daily loss limit hit (-$100)
- ❌ When portfolio exposure maxed ($500)

### **What We ONLY Monitor:**
- ✅ 4 specific infrastructure wallets
- ✅ Pump.fun token swaps (Token ↔ WSOL)
- ✅ Transactions ≥0.1 SOL value
- ✅ Tokens that pass liquidity check

### **When We Buy:**
```
ALL of these must be TRUE:
✓ Infra wallet bought ≥0.3 SOL of token
✓ (Price dropped ≥3% OR Buy volume ≥1.5 SOL)
✓ Liquidity ≥$5,000
✓ Stabilization confirmed (60s, all 5 checks pass)
✓ Risk limits allow trade
✓ Not on cooldown
```

### **When We Sell:**
```
ANY of these triggers IMMEDIATE sell:
× Price up 50% → Sell 100% (🚀 profit target)
× Price up 30% → Sell 50% (📈 first time only)
× Price down 20% → Sell 100% (🛑 stop loss)
× Hold time 24 hours → Sell 100% (⏰ max hold)
× No movement 2 hours → Sell 100% (💤 idle exit)
```

---

## 🧠 STRATEGY PHILOSOPHY

**Why This Works:**

1. **Infrastructure wallets are market makers** - They profit by providing liquidity and absorbing volatility
2. **When they BUY during a dip** - They're neutralizing sell pressure and signaling a bottom
3. **We wait for confirmation** - 60 seconds of stability proves the absorption worked
4. **We enter the NEW equilibrium** - Not the dump, not the pump, but the stabilized level
5. **We manage risk tightly** - Tiered exits lock gains, stop losses protect capital

**This is NOT gambling:**
- We don't chase pumps (we wait for stability)
- We don't buy falling knives (we wait for recovery)
- We don't hold losers (20% stop loss)
- We don't get greedy (50% target, sell everything)

**This IS disciplined trading:**
- Clear entry signals (absorption + stability)
- Defined risk limits (position size, stops)
- Mechanical exits (no emotion, just math)
- Risk management (daily loss limits, exposure caps)

---

## 📈 EXPECTED PERFORMANCE (HYPOTHETICAL - NOT VALIDATED)

⚠️ **WARNING: These numbers are theoretical projections, NOT verified results.**

**Hypothetical targets (unproven):**
- Win Rate: 40-60%
- Average Win: +25-35%
- Average Loss: -18-20%
- Risk:Reward: ~1.5:1

**Why these are unreliable:**
1. No backtesting has been performed
2. Slippage gaps can exceed -20% (especially on Pump tokens)
3. Distribution exits not implemented (will miss early warnings)
4. Infra wallet edge may decay over time
5. MEV/sandwich attacks will worsen fills
6. Correlation risk across positions not modeled

**Example projection (illustrative only, not expected):**
```
30 trades:
- 15 winners: +25% = +3.75 SOL
- 12 losers: -18% = -2.16 SOL
- 3 breakeven: 0 SOL
Net: +1.59 SOL (+15.9%)
```

**Reality will differ significantly. Start with 1 position and validate.**

---

## 🚨 SAFETY FEATURES

1. **Live Trading Toggle** - Can disable real trades anytime
2. **Paper Trading Mode** - Test without risking capital
3. **Daily Loss Limit** - Stops trading at -$100 loss
4. **Position Limits** - Max 5 concurrent positions
5. **Liquidity Check** - Won't trade illiquid tokens
6. **Stop Loss** - Auto-exit at -20%
7. **Max Hold Time** - Forces exit after 24 hours
8. **Trade History** - Every trade logged to JSON file
9. **WebSocket + Polling** - Redundant detection systems
10. **Error Handling** - Fails to paper trade if Jupiter errors

---

## 🎯 CURRENT STATUS

```
System: RUNNING ✅
Trading: LIVE ENABLED 🔴
Wallet: 9JmeM26hgsceGwtpxiM8RZndPF3jkMDQMUtmMyi8F7WM
Monitoring: 4 infrastructure wallets
Detection: WebSocket + 10s polling
Capital: 0.1 SOL per trade

Active Positions: 0/5
Daily P&L: $0.00
Portfolio Exposure: $0.00
```

---

## � CRITICAL IMPROVEMENTS NEEDED

### **1. Wallet Confidence Scoring + Decay**

**Problem:** 4 hardcoded wallets is brittle. Wallets rotate, change strategy, get copied.

**Solution:**
```
- Track performance of each wallet (win rate, profit factor)
- Confidence score decays over time (old edges fade)
- Re-validate wallets monthly (are they still profitable?)
- Auto-discover new infra wallets (pattern recognition)
- Weight signals by wallet confidence (not all equal)
```

**See:** SYSTEM-PHILOSOPHY.md for wallet discovery approach

---

### **2. Stronger Stabilization Requirements**

**Problem:** Current checks pass while price still dumping.

**Solution:**
```
- Increase sampling: 10-second intervals (not 15s)
- Extend window: 90 seconds minimum (not 60s)
- Add "no large sells" requirement (>0.5 SOL during window)
- Add "defended level holds" check (price bounces off support)
- Add "higher lows count" requirement (≥2 higher lows)
- Include broader flow (not just infra wallets)
```

**Why:** More data points = fewer false stabilizations

---

### **3. Token Safety Checklist**

**Problem:** $5k liquidity doesn't prevent rugs.

**Solution (from UPGRADE-SPEC):**
```
✓ Check freeze authority (must be revoked)
✓ Check mint authority (must be revoked or reasonable supply cap)
✓ Check top 10 holder concentration (<40% of supply)
✓ Check LP ownership (must be burned or time-locked)
✓ Check pool reserves on-chain (not just API)
✓ Check token age (>1 hour minimum)
✓ Check transaction count (>100 txs minimum)
```

**Without these, you'll trade scams.**

---

### **4. Distribution / Defense-Stop Exit**

**Problem:** No exit when entry thesis invalidates.

**Solution:**
```
Exit immediately if:
- Infra wallet sells ≥3 times in 5 minutes (distribution)
- Price breaks defended level by >5% (defense failed)
- Volume spike + price stall (hidden distribution)
- Infra activity drops to zero for 10+ minutes (abandoned)
- Large single sell >2 SOL by any wallet (panic signal)
```

**Why:** Thesis = "infra defended". If defense stops, exit.

**See:** SYSTEM-PHILOSOPHY.md for defense monitoring

---

### **5. No-Trade Regime Filter**

**Problem:** System trades in all conditions (chop, saturation, rotation).

**Solution:**
```
Block entries when:
- Market-wide chop (multiple failed stabilizations)
- Saturation (too many signals, quality diluted)
- Infra wallet rotation (wallets changing behavior)
- Low confidence period (recent poor performance)
- High correlation (all positions in same sector)
```

**Why:** Best trades come from selective entry, not constant activity.

---

### **6. Execution Hardening**

**Problem:** Underspecified for real fills.

**Solution:**
```
- Fresh quote requirement (<5s old)
- Max price impact limit (3% separate from slippage)
- Quote staleness check (abort if price moved >2% since signal)
- Retry policy (2-3 attempts with fresh quotes)
- MEV protection (private transactions or Jito bundles)
- Post-trade verification (did we get expected tokens?)
```

**Why:** Poor fills destroy edge faster than bad signals.

---

### **7. Risk Parameter Tightening**

**Problem:** Current params too aggressive for Pump tokens.

**Better starting defaults:**
```
Max Positions: 1 (not 5)
Position Size: 0.05 SOL (not 0.1)
Stop Loss: -15% (not -20%)
Partial Exit: +20% → sell 50% (not +30%)
Full Exit: +40% (not +50%)
Max Hold: 4 hours (not 24 hours)
Time Stop: 2 hours no movement (not idle logic)
```

**Scale up only after 50+ profitable trades.**

---

### **8. On-Chain Pool Reserves**

**Problem:** Relying on APIs (DexScreener) for liquidity is laggy and can be stale.

**Solution:**
```
- Query Raydium/Pump pool reserves directly on-chain
- Calculate real-time buy/sell pressure from pool ratios
- Detect LP removal attempts (reserves dropping fast)
- Track pool fee accumulation (measure real volume)
```

**Why:** On-chain data is source of truth, not APIs.

---

## �💡 KEY INSIGHTS

**What makes us different:**
- We're NOT copying trades (we don't mirror them)
- We're NOT front-running (we trade AFTER absorption)
- We ARE trading equilibrium (the stability after chaos)

**The edge:**
- Infrastructure wallets signal when volatility is absorbed
- We confirm stability before entering
- We trade the calm, not the storm

**The discipline:**
- Fixed position sizes (no overleveraging)
- Mechanical exits (no emotional holding)
- Risk limits (protect capital first)

---

## 🔥 THE BOTTOM LINE

We watch infrastructure wallets absorb sell pressure, wait for price to stabilize, confirm the new equilibrium, enter with defined risk, and exit mechanically at profit targets or stop losses. 

**We trade calm waters after the storm - not the storm itself.**

RAHHHHHHHH! 🚀

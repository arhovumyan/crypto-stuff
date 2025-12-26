# 🎯 Complete System Overview: Strict Solana Token Sniper

## 📋 Table of Contents
1. [Detection System](#detection-system)
2. [The 8 Validation Gates](#the-8-validation-gates)
3. [Execution System](#execution-system)
4. [Position Management & Exit Strategy](#position-management--exit-strategy)
5. [Rate Limiting & Performance](#rate-limiting--performance)
6. [Configuration Options](#configuration-options)

---

## 🔍 Detection System

### Multi-Layer Detection Architecture

The bot uses **4 detection layers** to catch token launches as early as possible:

#### **Layer 1: Account-Level Monitoring** (FASTEST - ~200-500ms head start)
- **What it does**: Directly subscribes to Raydium AMM program account changes
- **How it works**: Monitors for new pool accounts being created (752-byte accounts)
- **Speed**: Catches pool creation at the account level, before transactions are confirmed
- **Detection method**: `connection.onProgramAccountChange()` with `processed` commitment
- **Filter**: Only watches accounts matching Raydium pool size (752 bytes)

#### **Layer 2: WebSocket Log Monitoring** (FAST - ~200ms faster than confirmed)
- **What it does**: Monitors transaction logs for pool initialization events
- **How it works**: Subscribes to Raydium program logs with `processed` commitment
- **Speed**: Uses `processed` commitment instead of `confirmed` for ~200ms faster detection
- **Detection method**: WebSocket subscription to program logs
- **Filter**: Only processes transactions with "Initialize" log messages

#### **Layer 3: Helius Enhanced Transactions API** (EARLY WARNING)
- **What it does**: Polls Helius Enhanced API for pending transactions
- **How it works**: Checks for transactions involving Raydium program before they're confirmed
- **Speed**: Catches transactions in the mempool
- **Detection method**: HTTP polling every 2 seconds
- **Filter**: Only processes transactions involving Raydium AMM program

#### **Layer 4: DexScreener Polling** (BACKUP)
- **What it does**: Polls DexScreener API as a fallback detection method
- **How it works**: Scans for new SOL/token pairs every 10 seconds
- **Speed**: Slowest method, but reliable backup
- **Detection method**: HTTP polling
- **Filter**: Only SOL pairs (not token/token pairs)

### Detection Flow
```
New Token Launch
    ↓
Layer 1: Account-Level (200-500ms) ← FASTEST
    ↓ (if missed)
Layer 2: WebSocket Logs (processed commitment)
    ↓ (if missed)
Layer 3: Helius Enhanced API (pending tx)
    ↓ (if missed)
Layer 4: DexScreener (backup)
    ↓
Token Added to Queue
    ↓
Gate Validation Begins
```

---

## 🚪 The 8 Validation Gates

Each token must pass **ALL 8 gates** before the bot will trade it. This ensures only high-quality launches are touched.

### **Gate A: Liquidity Threshold** ✅

**Purpose**: Ensure the token has meaningful liquidity

**Requirements**:
- Minimum liquidity: **75 SOL** (configurable via `MIN_LIQUIDITY_SOL`)
- Liquidity must be stable for **20 seconds** (configurable via `liquidityStabilitySeconds`)
- For sniping: Accepts pools with at least **0.5 SOL** (lower threshold for early detection)

**Why it matters**:
- Low liquidity = high slippage = bad entry price
- Unstable liquidity = potential rug pull
- 75 SOL minimum ensures there's enough depth for a clean entry

**Default**: `MIN_LIQUIDITY_SOL=75`

---

### **Gate B: Mint Authority Check** ⚠️ (CONFIGURABLE)

**Purpose**: Prevent tokens that can mint infinite supply

**Requirements**:
- **Mint Authority must be NULL** (revoked)
- If mint authority exists → Token can mint infinite supply = SCAM RISK

**Why it matters**:
- Tokens with mint authority can create unlimited tokens
- This is a common rug pull mechanism
- However, some legitimate tokens keep mint authority for airdrops/tokenomics

**Configuration Options**:
1. **`strict`** (default): Rejects all tokens with mint authority
2. **`warning`**: Logs warning but allows trade
3. **`disabled`**: Skips the check entirely

**Environment Variables**:
```env
ENABLE_GATE_B=true          # Set to false to disable
GATE_B_MODE=strict          # strict | warning | disabled
```

**Default**: `strict` (rejects tokens with mint authority)

---

### **Gate C: Freeze Authority Check** ✅

**Purpose**: Prevent tokens that can freeze accounts

**Requirements**:
- **Freeze Authority must be NULL** (revoked)
- If freeze authority exists → Token can freeze your account = SCAM RISK

**Why it matters**:
- Tokens with freeze authority can lock your tokens
- This prevents you from selling
- Common rug pull mechanism

**Default**: Always enabled (cannot be disabled)

---

### **Gate D: Route Sanity** ✅

**Purpose**: Ensure the swap route is clean and efficient

**Requirements**:
- Maximum route hops: **2 hops** (configurable via `MAX_ROUTE_HOPS`)
- Maximum price impact: **6%** (configurable via `MAX_PRICE_IMPACT_PCT`)
- Maximum slippage: **3%** (300 bps, configurable via `MAX_SLIPPAGE_BPS`)

**Why it matters**:
- Too many hops = inefficient route = worse price
- High price impact = you're moving the market = bad entry
- High slippage = you get less tokens than expected

**Default Values**:
- `MAX_ROUTE_HOPS=2`
- `MAX_PRICE_IMPACT_PCT=6`
- `MAX_SLIPPAGE_BPS=300` (3%)

---

### **Gate E: Round-Trip Simulation** 🔴 (MOST IMPORTANT)

**Purpose**: Detect hidden taxes, sell blocks, and other restrictions

**How it works**:
1. Simulate buying tokens (SOL → Token)
2. Immediately simulate selling them back (Token → SOL)
3. Calculate the round-trip loss
4. If loss > 8%, reject the token

**Requirements**:
- Maximum round-trip loss: **8%** (configurable via `MAX_ROUND_TRIP_LOSS_PCT`)
- Normal fees: ~0.3% DEX fee + slippage
- Anything above 8% = likely hidden tax or sell block

**Why it matters**:
- **This is the most important gate** - catches 90% of scams
- Hidden taxes: Some tokens take 5-10% on every transaction
- Sell blocks: Some tokens prevent selling entirely
- Transfer taxes: Some tokens tax transfers between wallets

**Default**: `MAX_ROUND_TRIP_LOSS_PCT=8`

**Example**:
```
Buy: 1 SOL → 1000 tokens
Sell: 1000 tokens → 0.85 SOL
Loss: 15% → REJECTED (exceeds 8% threshold)
```

---

### **Gate F: Organic Flow** ✅

**Purpose**: Ensure early trading looks organic, not manipulated

**Requirements** (within first 30 seconds):
- Minimum swaps: **10 swaps** (configurable via `MIN_EARLY_SWAPS`)
- Minimum unique wallets: **7 wallets** (configurable via `MIN_UNIQUE_WALLETS`)
- Maximum wallet dominance: **35%** (configurable via `MAX_WALLET_DOMINANCE`)
  - No single wallet can do >35% of trading volume

**Why it matters**:
- Low swap count = no interest = likely dead token
- Few wallets = likely manipulation = pump & dump
- High wallet dominance = likely insider/whale = dangerous

**Default Values**:
- `MIN_EARLY_SWAPS=10`
- `MIN_UNIQUE_WALLETS=7`
- `MAX_WALLET_DOMINANCE=0.35` (35%)

---

### **Gate G: Holder Concentration** ✅

**Purpose**: Prevent tokens with concentrated ownership (rug risk)

**Requirements**:
- Top 1 holder: **≤20%** (configurable via `MAX_TOP_HOLDER_PCT`)
- Top 5 holders: **≤45%** (configurable via `MAX_TOP5_HOLDER_PCT`)
- Top 10 holders: **≤60%** (configurable via `MAX_TOP10_HOLDER_PCT`)

**Why it matters**:
- Concentrated ownership = whale can dump = price crash
- Top holder >20% = single point of failure
- Top 5 >45% = small group controls token = manipulation risk

**Default Values**:
- `MAX_TOP_HOLDER_PCT=20`
- `MAX_TOP5_HOLDER_PCT=45`
- `MAX_TOP10_HOLDER_PCT=60`

**Note**: Currently uses mock data. Real implementation would fetch holder data from Helius Digital Asset API.

---

### **Gate H: Launch Hygiene** ℹ️ (INFORMATIONAL)

**Purpose**: Check if launch follows known safe patterns

**Requirements**:
- Launched on known DEX (Raydium, Orca, Pump.fun)
- No suspicious patterns detected
- **Note**: This gate logs warnings but does NOT reject tokens

**Why it matters**:
- Some DEXs are safer than others
- Known patterns = more predictable behavior
- Helps identify potential issues without blocking trades

**Default**: Always passes (informational only)

---

## ⚡ Execution System

### Execution Methods

#### **1. Standard RPC Execution** (Fallback)
- Uses Solana RPC to send transactions
- Standard priority fees
- Subject to normal transaction queue
- Can be front-run or sandwiched

#### **2. Jito Bundle Execution** 🚀 (RECOMMENDED)

**What is Jito?**
- Jito is a block engine that accepts "bundles" of transactions
- Bundles are guaranteed to be included in the next block (or rejected entirely)
- Provides MEV protection and faster execution

**How it works**:
1. Create swap transaction (SOL → Token)
2. Create tip transaction (SOL → Jito tip account)
3. Bundle both transactions together
4. Send bundle to Jito block engine
5. Jito includes both transactions atomically in next block

**Benefits**:
- ✅ **Guaranteed inclusion**: Skip the transaction queue
- ✅ **MEV protection**: Transactions bundled together prevent sandwich attacks
- ✅ **Atomic execution**: Both transactions execute together or not at all
- ✅ **Faster execution**: ~200-500ms faster than standard RPC

**Configuration**:
```env
ENABLE_JITO_BUNDLE=true
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=100000  # 0.0001 SOL (minimum)
```

**Tip Amount Guide**:
| Tip (SOL) | Lamports | Priority | Use Case |
|-----------|----------|----------|----------|
| 0.0001    | 100,000  | Normal   | Standard sniping |
| 0.0002    | 200,000  | High     | Competitive launches |
| 0.0005    | 500,000  | Very High| Must-get opportunities |
| 0.001     | 1,000,000| Maximum  | Time-critical trades |

**Fallback**: If Jito bundle fails, automatically falls back to standard RPC execution.

---

### Priority Fees

Priority fees determine how quickly your transaction is processed:

**Levels**:
- **`low`**: 1,000 microlamports (slowest, cheapest)
- **`medium`**: 10,000 microlamports
- **`high`**: 50,000 microlamports
- **`veryHigh`**: 100,000 microlamports (fastest, most expensive)

**Configuration**:
```env
ENTRY_PRIORITY_LEVEL=veryHigh   # For buying (speed critical)
EXIT_PRIORITY_LEVEL=high        # For selling (still important but less critical)
```

**Recommendation**: Use `veryHigh` for entries (you want to get in fast), `high` for exits (still important but less time-sensitive).

---

### Retry Logic

- **Max retries**: 2 (configurable via `MAX_RETRIES`)
- **Exponential backoff**: Waits longer between each retry
- **Automatic fallback**: If Jito fails, falls back to RPC

---

## 📊 Position Management & Exit Strategy

### Position Tracking

Each position tracks:
- Entry price (SOL per token)
- Current price
- Total tokens purchased
- Remaining tokens (after partial sells)
- Invested SOL
- Current value in SOL
- Unrealized PnL (profit/loss)
- Entry time and signature
- Exit status

### Exit Strategy (Multi-Level Take Profits)

The bot uses a **sophisticated exit strategy** to maximize profits while protecting gains:

#### **Take Profit 1: First Profit Lock** 🎯
- **Trigger**: When position is up **+40%**
- **Action**: Sell **40%** of position
- **Purpose**: Lock in initial profits, reduce risk
- **Config**: `TAKE_PROFIT_1_AT=40`, `TAKE_PROFIT_1_PCT=40`

#### **Take Profit 2: Second Profit Lock** 🎯
- **Trigger**: When position is up **+80%**
- **Action**: Sell another **30%** of position
- **Purpose**: Lock in more profits, keep some exposure for further gains
- **Config**: `TAKE_PROFIT_2_AT=80`, `TAKE_PROFIT_2_PCT=30`

#### **Remaining Position: Trailing Stop** 📈
- **After TP2**: Remaining **30%** uses trailing stop
- **Trailing stop**: **15%** below highest price
- **Purpose**: Let winners run while protecting gains
- **Example**: If token hits +200%, trailing stop locks in +185% profit

#### **Stop Loss: Hard Exit** 🛑
- **Trigger**: When position is down **-20%**
- **Action**: Sell **100%** of position immediately
- **Purpose**: Limit losses, prevent large drawdowns
- **Config**: `STOP_LOSS_PCT=20`

#### **Time Stop: Dead Token Exit** ⏰
- **Trigger**: If position is not up **+15%** within **3 minutes**
- **Action**: Sell **100%** of position
- **Purpose**: Exit dead tokens quickly, free up capital
- **Config**: `TIME_STOP_MINUTES=3`, `TIME_STOP_MIN_GAIN_PCT=15`

### Exit Strategy Example

```
Entry: 1 SOL @ $0.10 per token = 10 tokens
    ↓
+40%: Sell 40% (4 tokens) @ $0.14 = 0.56 SOL ✅ Locked profit
    ↓
+80%: Sell 30% (3 tokens) @ $0.18 = 0.54 SOL ✅ More profit locked
    ↓
+200%: Token hits $0.30, trailing stop at +185% ($0.285)
    ↓
Price drops to $0.285: Sell remaining 30% (3 tokens) = 0.855 SOL ✅
    ↓
Total: 0.56 + 0.54 + 0.855 = 1.955 SOL
Profit: +95.5% (vs +200% if held, but much safer)
```

### Position Monitoring

- **Update frequency**: Every 5 seconds
- **Checks**: Price updates, take profit triggers, stop loss triggers, time stops
- **Logging**: All position updates are logged

---

## 🛡️ Rate Limiting & Performance

### Rate Limiting System

**Problem**: Helius RPC has rate limits (~100 requests/second). Making too many calls too fast causes 429 errors.

**Solution**: `RateLimitedConnection` wrapper

**Features**:
- **Request queuing**: Queues RPC calls and processes them sequentially
- **Throttling**: Minimum 50ms delay between calls (20 calls/second max)
- **Caching**: Caches account info for 30 seconds (reduces duplicate calls)
- **Exponential backoff**: Automatically retries with increasing delays on 429 errors
- **429 spam suppression**: Only logs 429 errors every 10 seconds (not every error)

**Benefits**:
- ✅ No more 429 errors flooding the console
- ✅ Automatic retry on rate limit errors
- ✅ Faster execution (cached responses)
- ✅ Cleaner logs

---

### Logging System

**Verbose Mode**: Disabled by default
- **Before**: Logged every transaction, every swap, every account change
- **After**: Only logs actual token launches and gate validation results

**What you see now**:
- ✅ Token launch detections
- ✅ Gate validation results (pass/fail with reasons)
- ✅ Trade executions
- ✅ Position updates
- ✅ Performance summaries

**What you DON'T see**:
- ❌ Transaction spam
- ❌ 429 error spam (only every 10 seconds)
- ❌ Non-pool initialization messages
- ❌ Token/token pairs (only SOL pairs)

**Heartbeat**: Every 2 minutes, shows:
- Loop count
- Active positions
- Monitored tokens count

---

## ⚙️ Configuration Options

### Required Configuration

```env
# RPC & API
HELIUS_API_KEY=your_helius_api_key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key

# Wallet
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase"

# Trading
SNIPER_BUY_AMOUNT_SOL=0.2
ENABLE_LIVE_TRADING=false  # Set to true for live trading
```

### Gate Configuration

```env
# Gate A: Liquidity
MIN_LIQUIDITY_SOL=75

# Gate B: Mint Authority (CONFIGURABLE)
ENABLE_GATE_B=true
GATE_B_MODE=strict  # strict | warning | disabled

# Gate D: Route Sanity
MAX_ROUTE_HOPS=2
MAX_PRICE_IMPACT_PCT=6
MAX_SLIPPAGE_BPS=300

# Gate E: Round-Trip
MAX_ROUND_TRIP_LOSS_PCT=8

# Gate F: Organic Flow
MIN_EARLY_SWAPS=10
MIN_UNIQUE_WALLETS=7
MAX_WALLET_DOMINANCE=0.35

# Gate G: Holder Concentration
MAX_TOP_HOLDER_PCT=20
MAX_TOP5_HOLDER_PCT=45
MAX_TOP10_HOLDER_PCT=60
```

### Execution Configuration

```env
# Jito Bundle (RECOMMENDED)
ENABLE_JITO_BUNDLE=true
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=100000  # 0.0001 SOL

# Priority Fees
ENTRY_PRIORITY_LEVEL=veryHigh
EXIT_PRIORITY_LEVEL=high

# Retries
MAX_RETRIES=2
```

### Exit Strategy Configuration

```env
# Take Profits
TAKE_PROFIT_1_PCT=40      # Sell 40% at +40%
TAKE_PROFIT_1_AT=40
TAKE_PROFIT_2_PCT=30      # Sell 30% at +80%
TAKE_PROFIT_2_AT=80

# Stops
STOP_LOSS_PCT=20          # Exit at -20%
TIME_STOP_MINUTES=3       # Exit after 3 min if not up 15%
TIME_STOP_MIN_GAIN_PCT=15
```

### Performance Configuration

```env
# Stats
STATS_INTERVAL_SECONDS=120  # Performance summary every 2 minutes
```

---

## 📈 Expected Performance

### Touch Rate
- **Target**: 1-5% of launches
- **Why so low?**: Strict gates filter out 95-99% of launches
- **This is GOOD**: Quality over quantity

### Win Rate
- **Target**: 60-70%
- **Why not 100%?**: Some winners turn into losers, market conditions change

### Risk Per Trade
- **Fixed**: Your buy amount (e.g., 0.2 SOL)
- **Max loss**: 100% of buy amount (if token goes to zero)
- **Typical loss**: 20% (stop loss) = 0.04 SOL per losing trade

### Average Hold Time
- **Short winners**: 30 seconds - 2 minutes (hit take profit quickly)
- **Long winners**: 3-10 minutes (let trailing stop work)
- **Losers**: 3 minutes (time stop) or until stop loss

---

## 🎯 Summary

### What This Bot Does
✅ **Detects** new token launches with 4-layer detection system  
✅ **Validates** tokens with 8 strict gates  
✅ **Executes** trades with Jito bundles and priority fees  
✅ **Manages** positions with multi-level take profits  
✅ **Protects** against scams, rugs, and low-quality launches  
✅ **Limits** rate limiting issues with smart throttling  
✅ **Logs** only important events (no spam)  

### What This Bot Doesn't Do
❌ Guarantee profits (trading is risky)  
❌ Trade every launch (by design - very strict)  
❌ Prevent all losses (some winners turn into losers)  
❌ Handle network outages automatically  

### Key Features
1. **Multi-layer detection**: 200-500ms head start over retail
2. **8 strict gates**: Only high-quality launches pass
3. **Jito bundles**: MEV protection and guaranteed inclusion
4. **Smart exits**: Multi-level take profits and trailing stops
5. **Rate limiting**: No more 429 errors
6. **Clean logs**: Only important events shown

---

**⚠️ DISCLAIMER**: This bot is for educational purposes. Cryptocurrency trading involves substantial risk. Never trade with money you can't afford to lose. Past performance does not guarantee future results.


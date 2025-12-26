# Which Tokens Does the Bot Analyze?

## Short Answer

The bot analyzes **ALL tokens** that trade on these DEX platforms:
- **PumpSwap** (PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP)
- **PumpFun** (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P)
- **Raydium AMM** (675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8)

**It doesn't filter by specific tokens** - it watches everything and only acts when large sells occur.

---

## How It Works

### 1. WebSocket Subscription
The bot subscribes to transaction logs from the DEX programs above. This means it receives **all trades** happening on these platforms in real-time.

### 2. Trade Detection
For every trade, the bot:
- Extracts the token mint address
- Determines if it's a buy or sell
- Calculates the trade size

### 3. Large Sell Filtering
The bot only acts on sells that meet these criteria:

```bash
MIN_SELL_LIQUIDITY_PCT=1    # Sell must be at least 1% of pool liquidity
MAX_SELL_LIQUIDITY_PCT=3    # Sell must be less than 3% of pool liquidity
```

**Example:**
- Token ABC has 100 SOL liquidity
- Someone sells 1.5 SOL (1.5% of pool)
- ✅ Bot detects this as a "large sell"
- Someone sells 0.5 SOL (0.5% of pool)
- ❌ Bot ignores (too small)
- Someone sells 5 SOL (5% of pool)
- ❌ Bot ignores (too large, likely panic sell)

---

## Token Types Analyzed

### ✅ Included (All tokens on these DEXs)
- **New launches** on PumpFun/PumpSwap
- **Established tokens** on Raydium
- **Any SPL token** trading on these platforms
- **No whitelist/blacklist** - everything is monitored

### ❌ Excluded
- Tokens not trading on PumpSwap, PumpFun, or Raydium AMM
- Tokens on other DEXs (Orca, Jupiter aggregator, etc.) - *unless they also trade on the monitored DEXs*

---

## Real-Time Monitoring

The bot processes trades in real-time:

```
1. Trade happens on PumpSwap → WebSocket receives it
2. Bot extracts: token mint, trade type, amount
3. If it's a SELL:
   → Check pool liquidity
   → Calculate sell as % of pool
   → If 1-3%: Mark as "large sell"
   → Wait for absorption
```

**No pre-filtering** - the bot sees everything and filters on-the-fly.

---

## Pool Liquidity Requirement

For a sell to be analyzed, the token must:
- Have a pool on one of the monitored DEXs
- Have sufficient liquidity (the bot fetches this from DexScreener API)
- The sell must be 1-3% of that pool's liquidity

**If a token has no pool data available**, the bot will skip it (logs: "No pool state for token...").

---

## Examples

### Example 1: New PumpFun Token
```
Token: ABC123... (just launched)
Pool: 50 SOL liquidity
Sell: 0.75 SOL (1.5% of pool)
→ ✅ Detected as large sell
→ Bot watches for absorption
```

### Example 2: Established Raydium Token
```
Token: XYZ789... (trading for weeks)
Pool: 1000 SOL liquidity
Sell: 15 SOL (1.5% of pool)
→ ✅ Detected as large sell
→ Bot watches for absorption
```

### Example 3: Small Sell
```
Token: DEF456...
Pool: 200 SOL liquidity
Sell: 0.5 SOL (0.25% of pool)
→ ❌ Too small, ignored
```

### Example 4: Panic Sell
```
Token: GHI789...
Pool: 100 SOL liquidity
Sell: 10 SOL (10% of pool)
→ ❌ Too large, ignored (likely panic dump)
```

---

## Configuration

You can adjust which tokens get analyzed by changing the thresholds:

```bash
# Lower threshold = more tokens analyzed (but more noise)
MIN_SELL_LIQUIDITY_PCT=0.5    # Analyze smaller sells

# Higher threshold = fewer tokens (but higher quality)
MIN_SELL_LIQUIDITY_PCT=2      # Only analyze larger sells
```

**Default: 1-3%** is a good balance between signal quality and coverage.

---

## Adding More DEXs

Currently, the bot monitors:
- PumpSwap ✅
- PumpFun ✅
- Raydium AMM ✅

To add more DEXs, you would need to modify `trade-feed.ts` and add their program IDs to the subscription list.

**Available but not currently monitored:**
- Raydium CLMM
- Orca
- Jupiter (aggregator)

---

## Summary

**The bot analyzes:**
- ✅ **ALL tokens** trading on PumpSwap, PumpFun, and Raydium AMM
- ✅ **No token whitelist** - everything is monitored
- ✅ **Real-time** - processes trades as they happen
- ✅ **Filtered by sell size** - only acts on 1-3% of pool liquidity sells

**You don't need to specify tokens** - the bot automatically monitors everything and filters based on sell size and absorption behavior.

---

## Monitoring Coverage

To see what tokens are being monitored, check the logs:

```
[trade-feed] WebSocket connected
[trade-feed] Subscribing to program: PSwapMdS...
[trade-feed] Subscribing to program: 6EF8rrec...
[trade-feed] Subscribing to program: 675kPX9M...
```

When large sells are detected:
```
[sell-detector] 🔴 LARGE SELL DETECTED | token: ABC123... | amount: 1.5 SOL | 2.1%
```

The token address will show which specific token had the large sell.


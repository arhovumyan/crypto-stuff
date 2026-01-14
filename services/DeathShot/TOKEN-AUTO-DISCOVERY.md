# Token Auto-Discovery System

## Overview

DeathShot now **automatically discovers and monitors tokens** from your `.env` file. Simply add token mint addresses to the `TOKENS` variable and the bot will:

1. ✅ **Auto-detect pool type** (Pump.fun, Raydium, Orca)
2. ✅ **Find pool addresses & vaults** automatically
3. ✅ **Start live WebSocket monitoring** (NOT polling - real-time updates)
4. ✅ **Use Jupiter** for swap execution

## Configuration

Add your token mints to `.env`:

```bash
TOKENS=5wVtfsFhLjxm27K9mN3ziYWCCpQwXXq7HWUiRMW7pump,8jvtfeVTJQsrQ3L4kjQmRcXJ1iSFQMmkjkCqPUe3pump
```

**That's it!** No need to find pool addresses manually.

## How It Works

### Live Monitoring (NOT Polling)

DeathShot uses **Solana WebSocket subscriptions** for continuous real-time price updates:

```typescript
// Subscribes to pool vault accounts
// Gets notified INSTANTLY when balances change
connection.onAccountChange(vaultAddress, (accountInfo) => {
  // Process price update in milliseconds
});
```

This is **far superior to polling** because:
- ⚡ **Sub-second latency** (vs 1-5 second polling intervals)
- 📉 **Lower RPC costs** (push vs pull)
- 🎯 **Catch every price movement** (no gaps between polls)

### Pool Discovery

The `poolDiscovery.ts` utility automatically:

**For Pump.fun tokens** (ending in "pump"):
1. Derives bonding curve PDA from mint
2. Finds token and SOL vaults
3. Sets up WebSocket subscriptions

**For Raydium tokens**:
1. Queries Raydium AMM program for pools containing the mint
2. Parses vault addresses from pool account data
3. Sets up WebSocket subscriptions

### Why We Still Use Pool Accounts (Not Just Jupiter)

**Jupiter is for EXECUTION** (swapping tokens):
- Aggregates best prices across DEXs
- Handles transaction building
- Optimizes routing

**Pool monitoring is for PRICE DISCOVERY**:
- Need real-time price data to detect 5% dips
- Jupiter's price API is polling-based (not live)
- Direct pool monitoring = millisecond latency

## Architecture

```
┌─────────────┐
│  .env       │
│  TOKENS=... │
└──────┬──────┘
       │
       v
┌─────────────────────┐
│ poolDiscovery.ts    │
│ - Detect pool type  │
│ - Find pool address │
│ - Find vaults       │
└──────┬──────────────┘
       │
       v
┌─────────────────────┐
│ MarketData Module   │
│ WebSocket Subscribe │
│ Real-time updates   │
└──────┬──────────────┘
       │
       v
┌─────────────────────┐
│ SignalEngine        │
│ Detect 5% dips      │
│ Multi-gate checks   │
└──────┬──────────────┘
       │
       v
┌─────────────────────┐
│ ExecutionEngine     │
│ Jupiter API         │
│ Execute swaps       │
└─────────────────────┘
```

## Supported DEXs

- ✅ **Pump.fun** - Auto-discovers bonding curve
- ✅ **Raydium AMM** - Finds pool via program queries
- 🚧 **Orca** - Coming soon
- 🚧 **Meteora** - Coming soon

## Running the Bot

```bash
cd services/DeathShot
npm start
```

Output will show:

```
Loading tokens from .env TOKENS variable...
Discovered pools, adding to live monitor
📡 Now monitoring token LIVE via WebSocket
🎯 DeathShot is LIVE! Monitoring for dip-buy opportunities...
```

## FAQ

### Q: Do I need Raydium pool addresses?
**A:** No! The bot auto-discovers them from token mints.

### Q: What about tokens without Raydium pools?
**A:** Works for Pump.fun, Raydium, and other DEXs. Each has its own discovery logic.

### Q: Is this polling or live monitoring?
**A:** **LIVE WebSocket monitoring** - you get price updates the instant they happen on-chain.

### Q: How does Jupiter fit in?
**A:** 
- **Pool monitoring** = Real-time price tracking (detect dips)
- **Jupiter** = Swap execution (buy the dip)
- Best of both worlds!

### Q: What if a token isn't found?
**A:** Check logs - it will show "Could not discover pool for token". Token might be:
- Too new (no liquidity yet)
- Migrated to different DEX
- Invalid mint address

## Next Steps

1. ✅ Add your token mints to `.env` TOKENS variable
2. ✅ Start DeathShot: `npm start`
3. ✅ Watch logs for "📡 Now monitoring token LIVE"
4. ✅ Bot will automatically detect dips and execute trades

**Paper trading is enabled by default** - safe to test!

Set `PAPER_MODE=false` in `.env` when ready to trade live.

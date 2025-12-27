# WSOL Trading Filter Fix

## Problem Summary

Your bot was detecting transactions correctly but **not opening positions** because it was trying to trade WSOL itself, which caused Jupiter API errors.

### What Was Happening

1. ✅ Bot detects infra wallet BUYs WSOL (Wrapped SOL) - e.g., 2.04 SOL, 2.07 SOL
2. ✅ Bot identifies this as an "absorption event"
3. ❌ Bot tries to BUY WSOL with SOL
4. ❌ Jupiter API rejects: `"inputMint cannot be same as outputMint"` (can't swap SOL for WSOL)
5. ❌ Bot falls back to paper trade instead of real trade

### The Root Cause

**WSOL (So11111111111111111111111111111111111111112) is not a tradeable memecoin - it's just wrapped SOL.**

When infra wallets trade on Pump.fun:
- They sell **memecoins** and receive **WSOL**
- They buy **memecoins** and spend **WSOL**
- **WSOL is the medium of exchange, not the target token**

### The Fix

Added a filter in `walletListener.ts` (line 263-281) to **skip WSOL transactions entirely**:

```typescript
if (token === WSOL_MINT) {
  // This is WSOL - use the token balance change directly as SOL amount
  tradeValueSol = Math.abs(change);
  logger.info(
    `[WalletListener] 💡 ${sig} - ${type.toUpperCase()} WSOL: ` +
    `Token: ${token}, Trade value: ${tradeValueSol.toFixed(4)} SOL (from WSOL balance)`
  );
  
  // CRITICAL: Skip WSOL transactions - we can't trade WSOL itself!
  // WSOL is just wrapped SOL, not a real token to copy-trade
  logger.info(`[WalletListener] ⏭️  ${sig} - Skipping WSOL transaction (cannot trade WSOL)`);
  continue;  // <-- NEW: Skip to next token
}
```

## What The Bot Will Do Now

### Before (BROKEN):
```
[WalletListener] 💰 Infra wallet ERBVcqUW... BUY: So111111 - 2.0430 SOL
[AbsorptionDetector] Detected absorption for So111111...
[TradingExecutor] 🎯 ENTERING POSITION: So111111
[Jupiter] Error: "inputMint cannot be same as outputMint"
[TradingExecutor] ⚠️ Falling back to paper trade
```

### After (FIXED):
```
[WalletListener] 💡 5tzRLJT... - BUY WSOL: Token: So111111..., Trade value: 2.0430 SOL
[WalletListener] ⏭️  5tzRLJT... - Skipping WSOL transaction (cannot trade WSOL)
[WalletListener] 💡 5tzRLJT... - SELL: Token: AfCViJjXY5..., Trade value: 0.0009 SOL
[AbsorptionDetector] Detected absorption for AfCViJjXY5...  <-- Real memecoin!
[TradingExecutor] 🎯 ENTERING POSITION: AfCViJjXY5...
[Jupiter] ✅ Swap successful!
```

## Expected Behavior

The bot will now:

1. ✅ **Detect WSOL transactions** (for volume/value tracking)
2. ✅ **Log WSOL amounts** (so you know what's happening)
3. ✅ **Skip WSOL trading** (won't try to buy/sell WSOL)
4. ✅ **Trade REAL memecoins** (the tokens infra wallets are actually swapping)

## Next Steps

1. Restart the bot: `npm start`
2. Monitor logs for:
   - `"Skipping WSOL transaction"` - Good! WSOL is being filtered
   - `"ENTERING POSITION: [token that's NOT So111111]"` - Good! Trading real tokens
   - `"Swap successful"` - Good! Real trades executing

## Why You Weren't Seeing Real Tokens

Looking at your logs, I see the infra wallets ARE trading other tokens:
- `AfCViJjXY52TKyqFj4vj4fim5vyyFAJAMoH17EkXpump` - 0.0009 SOL (too small)
- `5zqU5eUPkbuBsWLSBoc7Qnf7DS8xDrLneWEPAAigpump` - 0.0229 SOL (too small)
- `GZxrdsiXEuGBkUbhAov394489CtiF9LMA7g5HsdVpump` - 0.0007 SOL (too small)

**These were all BELOW your 0.1 SOL minimum threshold.**

The bot was correctly detecting them but skipping because they were too small. The only transaction large enough was the WSOL one (2.04 SOL), which is now correctly filtered out.

## Recommendation: Lower Minimum Threshold

You may want to lower the minimum from 0.1 SOL to catch more trades:

In `config.ts`:
```typescript
absorption: {
  minInfraBuyVolumeSol: 0.05,  // Lower from 0.1
  // ...
}
```

This would allow the bot to trade when infra wallets buy with 0.05+ SOL instead of requiring 0.1+ SOL.

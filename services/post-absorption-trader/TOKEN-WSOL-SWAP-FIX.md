# FIXED: Token + WSOL Swap Detection

## Problem

The bot was **incorrectly handling Pump.fun transactions** that involve both a token and WSOL (Wrapped SOL). 

### Example from Screenshot:
```
Swap 1,741,788.343 NOMORE67 for 3.588109127 WSOL
Token: H9FzJmC2S1HJP81ELdGWYtiPRPLDdhFTHdyL6HXYpump
Infra Wallet: FSkmRPArUnFFGZuRUdZ1W7vh5Hm7KqgjDQ19UBjW2kbC
```

The bot was detecting BOTH changes:
1. ❌ BUY WSOL (wrong - skipped this)
2. ❌ SELL AfCViJjXY... (wrong - this was below minimum 0.1 SOL)

But it should have detected:
- ✅ **SELL NOMORE67 for 3.588 SOL value** → Track this token!

## The Fix

### New Logic in `walletListener.ts`

Every Pump.fun swap has **TWO token balance changes**:
1. **The actual token** being traded (e.g., NOMORE67)
2. **WSOL** - the medium of exchange (like USD in stock trading)

The bot now:
1. Scans transaction for BOTH token changes
2. **Identifies the non-WSOL token** as the trading target
3. **Uses WSOL amount** as the trade value
4. Reports the token correctly (not WSOL)

```typescript
// Example: When infra wallet sells 1,741,788 NOMORE67 for 3.588 WSOL
// OLD (broken):
// - Detected: "BUY WSOL" → Skipped
// - Detected: "SELL NOMORE67" → Below minimum (0.003 SOL native)
// - Result: MISSED THE TRADE

// NEW (fixed):
// - Detected: "SELL NOMORE67 for 3.588 SOL value"
// - Result: TRACKED CORRECTLY ✅
```

## What This Means

### When Infra Wallet SELLS token for WSOL:
```
Token: -1,741,788 NOMORE67
WSOL:  +3.588 WSOL
```
**Bot reports:** `SELL NOMORE67 for 3.588 SOL value`
→ Absorption opportunity detected!

### When Infra Wallet BUYS token with WSOL:
```
Token: +5,000,000 SOMETOKEN  
WSOL:  -1.2 WSOL
```
**Bot reports:** `BUY SOMETOKEN for 1.2 SOL value`
→ Smart money following detected!

## Code Changes

### Before (Broken):
```typescript
// Loop through token changes individually
for (token balance change) {
  if (token === WSOL) {
    skip(); // ❌ Lost the trade value!
  } else {
    use native SOL balance; // ❌ Wrong value (just fees)!
  }
}
```

### After (Fixed):
```typescript
let tokenChange = null;
let wsolChange = 0;

// Collect BOTH changes
for (token balance change) {
  if (token === WSOL) {
    wsolChange = change; // ✅ Save WSOL value
  } else {
    tokenChange = {token, change}; // ✅ Save token info
  }
}

// If we have both, create transaction record
if (tokenChange && wsolChange) {
  return {
    token: tokenChange.mint,  // ✅ The actual token to trade
    type: tokenChange.type,   // ✅ buy or sell
    amountSol: abs(wsolChange) // ✅ The SOL value from WSOL
  };
}
```

## Expected Behavior Now

When bot sees transaction like your screenshot:
```
[WalletListener] 💰 5tzRLJ... - WSOL change: +3.5881 WSOL
[WalletListener] 🪙 5tzRLJ... - Token change: H9FzJmC2... -1741788.343
[WalletListener] ✅ 5tzRLJ... - Valid swap detected: SELL H9FzJmC2... for 3.5881 SOL
[AbsorptionDetector] 💰 Infra wallet FSkmRP... SELL: H9FzJmC2... - 3.5881 SOL
[AbsorptionDetector] 🎯 Absorption detected! Token: H9FzJmC2...
[PostAbsorptionTrader] Waiting for stabilization...
[TradingExecutor] 🎯 ENTERING POSITION: H9FzJmC2...
[Jupiter] Getting order: SOL → H9FzJmC2...
[Jupiter] ✅ Swap successful!
```

## Testing

Restart the bot and watch for transactions. You should now see:
1. Both WSOL and token changes logged
2. Valid swaps detected with correct SOL values
3. Positions opened for real tokens (not WSOL)

The bot will now correctly copy infrastructure wallet trades by tracking the **actual token** with the **correct WSOL value**.

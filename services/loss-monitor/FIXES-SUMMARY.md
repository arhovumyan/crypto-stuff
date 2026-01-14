# Fixes Summary

## 1. Loss Monitor Service (NEW)

Created a new service that automatically monitors token positions and sells when loss reaches 5%.

### Location
`services/loss-monitor/`

### Features
- Monitors all token positions every second
- Calculates loss percentage from purchase price
- Automatically sells when loss >= 5%
- Works in both paper and live trading modes
- Updates database after successful sells

### Usage
```bash
cd services/loss-monitor
npm install
npm run dev  # Development mode
# OR
npm run build && npm start  # Production mode
```

### Configuration
- Loss threshold: 5% (configurable in code)
- Check interval: 1 second
- Uses DexScreener for price data
- Uses Jupiter Ultra API for executing sells

---

## 2. Copy Executor Sell Logic Fix

Fixed the "Insufficient funds" errors when trying to sell tokens that don't exist.

### Problem
The copy-executor was trying to sell tokens even when:
- Token account doesn't exist on-chain
- Database shows 0 balance
- This caused repeated "Insufficient funds" errors

### Solution
1. **Early Exit**: If both on-chain and DB checks show 0 balance, skip the sell entirely
2. **Better Status**: Record as "skipped" (not "failed") when token was never purchased
3. **Retry Logic**: Stop retrying if balance check shows 0 during retry attempts

### Changes Made
- `services/copy-executor/src/copy-executor.ts`:
  - Lines 779-815: Improved sell logic to skip when token account doesn't exist
  - Lines 268-283: Added check to stop retrying when balance is 0

### Result
- No more "Insufficient funds" errors for tokens that don't exist
- Cleaner logs with proper skip messages
- Faster execution (no wasted retry attempts)

---

## Testing

### Test Loss Monitor
1. Start the service: `cd services/loss-monitor && npm run dev`
2. It will monitor all positions and log their loss percentages
3. When a token reaches 5% loss, it will automatically sell (or simulate in paper mode)

### Test Copy Executor Fix
1. The fix is automatic - when a sell trade comes in for a token you don't own:
   - Old behavior: 10 retry attempts with "Insufficient funds" errors
   - New behavior: Immediate skip with clear message

---

## Notes

- Both services can run simultaneously
- Loss monitor is independent and doesn't interfere with copy-executor
- Loss monitor requires positions to be tracked in the database (from copy-executor buys)


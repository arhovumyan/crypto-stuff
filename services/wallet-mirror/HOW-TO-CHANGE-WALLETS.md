# 🔄 How to Change Wallets

## Current Setup

Your mirror system now automatically reads wallets from **LEADER_WALLET_*** variables in your `.env` file.

**Currently watching:**
- `LEADER_WALLET_7=A42C7U1wT8BUoq27BE6kEYBtMaxtcsqq2fRX3kK1b6d6`
- `LEADER_WALLET_8=C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38`

## How to Change Wallets

### Method 1: Edit Existing Wallets

1. **Edit `.env` file** in the project root:
   ```env
   LEADER_WALLET_7=YourNewWalletAddress1
   LEADER_WALLET_8=YourNewWalletAddress2
   ```

2. **Restart both services**:
   - Press `Ctrl+C` in both terminals
   - Run `npm run listener` in Terminal 1
   - Run `npm run executor` in Terminal 2

3. **Verify** the new wallets are loaded:
   ```bash
   npm run test-config
   ```

### Method 2: Add More Wallets

Add more LEADER_WALLET_* variables (supports up to LEADER_WALLET_20):

```env
LEADER_WALLET_7=A42C7U1wT8BUoq27BE6kEYBtMaxtcsqq2fRX3kK1b6d6
LEADER_WALLET_8=C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38
LEADER_WALLET_9=AnotherWalletAddress
LEADER_WALLET_10=YetAnotherWallet
```

### Method 3: Use WATCH_ADDRESSES (Alternative)

You can also use the `WATCH_ADDRESSES` variable if you prefer:

```env
WATCH_ADDRESSES=wallet1,wallet2,wallet3
```

**Note:** The system will combine both `WATCH_ADDRESSES` and `LEADER_WALLET_*` variables, automatically removing duplicates.

## Quick Commands

### Test Configuration
```bash
cd services/wallet-mirror
npm run test-config
```

### Start Listener (Terminal 1)
```bash
cd services/wallet-mirror
npm run listener
```

### Start Executor (Terminal 2)
```bash
cd services/wallet-mirror
npm run executor
```

## What Happens When You Change Wallets?

### ✅ Immediately After Restart:
- New wallets are monitored for transactions
- Old wallet trades are still in the database (but won't get new ones)
- Your positions are tracked correctly

### ⚠️ Important Notes:
1. **You must restart** both services for changes to take effect
2. Changes are **not picked up automatically** while running
3. Historical trades from old wallets remain in database
4. Your token positions are preserved across restarts

## Example Workflow

Let's say you want to switch from wallet A to wallet B:

```bash
# 1. Stop both services (Ctrl+C in both terminals)

# 2. Edit .env
vim .env  # or use any editor
# Change LEADER_WALLET_7 to new address

# 3. Test configuration
cd services/wallet-mirror
npm run test-config

# 4. Restart listener (Terminal 1)
npm run listener

# 5. Restart executor (Terminal 2)
npm run executor

# 6. Watch the logs - you should see:
# "Loaded 2 wallet(s) to watch:"
# "  - YourNewWalletAddress"
```

## Verification

After changing wallets, verify the system picked them up:

```bash
# In the listener terminal, you should see:
Loaded 2 wallet(s) to watch:
  - A42C7U1wT8BUoq27BE6kEYBtMaxtcsqq2fRX3kK1b6d6
  - C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38
```

## Troubleshooting

### Wallets Not Detected
- Check .env file has the correct format
- No spaces in wallet addresses
- Wallet addresses are valid Solana addresses (usually 44 characters)
- Run `npm run test-config` to verify

### Old Wallets Still Showing
- Make sure you restarted both services
- Check you edited the correct .env file (in project root)
- Clear any cached environment variables

### Database Has Old Trades
- This is normal! Old trades stay in database
- Only new trades from new wallets will be detected
- To clear: `psql -U copytrader -d copytrader -c "DELETE FROM leader_trades;"`

## Pro Tips

1. **Keep a backup** of important wallet addresses in comments:
   ```env
   # Good performers:
   #LEADER_WALLET_1=WalletWithGoodTrades
   
   # Currently active:
   LEADER_WALLET_7=CurrentWallet
   ```

2. **Test with one wallet first** before adding multiple
3. **Use descriptive comments** to remember why you chose each wallet
4. **Monitor for 24 hours** before deciding if a wallet is good to follow

## Quick Reference

| What to Change | Where | How |
|----------------|-------|-----|
| Add/remove wallets | `.env` | Edit `LEADER_WALLET_*` variables |
| Apply changes | Both terminals | Stop (Ctrl+C) and restart services |
| Verify changes | Terminal | `npm run test-config` |
| See current wallets | Listener logs | Check startup message |

---

**Remember:** Changes to `.env` only take effect after restarting the services! 🔄

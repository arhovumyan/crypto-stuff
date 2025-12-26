# 🚀 Quick Start Guide

## Setup (5 minutes)

### 1. Install Dependencies
```bash
cd sniper
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
nano .env  # or use your favorite editor
```

**Required settings**:
```env
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
COPY_WALLET_SEED_PHRASE="your twelve word seed phrase here"
```

### 3. Paper Trade First (IMPORTANT!)
Keep `ENABLE_LIVE_TRADING=false` for testing:
```env
ENABLE_LIVE_TRADING=false
```

### 4. Run It
```bash
npm run dev
```

Or use the convenience script:
```bash
chmod +x start.sh
./start.sh
```

## What to Expect

### First Run
```
╔════════════════════════════════════════════════════════╗
║         🎯 STRICT SOLANA TOKEN SNIPER 🎯              ║
╚════════════════════════════════════════════════════════╝

Buy Amount:           0.2 SOL
Trading Mode:         📝 PAPER
Min Liquidity:        75 SOL
...

💼 Wallet initialized
💰 Wallet Balance: 5.2847 SOL
🔍 Starting token launch monitor...
✅ Token monitor started
🎯 SNIPER IS LIVE AND HUNTING!
```

### When a Launch is Detected
```
🔍 Processing launch
  mint: ABC123...
  liquiditySOL: 85.5

🚪 Starting gate validation
  ✅ Gate A passed: Liquidity sufficient
  ✅ Gate B passed: Mint authority revoked
  ✅ Gate C passed: Freeze authority revoked
  ✅ Gate D passed: Route is acceptable
  ❌ Gate E failed: Round-trip loss 15.3% > 8%
```

Most tokens will fail gates - **this is good!** You want strict filtering.

### When a Trade Executes
```
✅ ALL GATES PASSED! Executing trade...
🔵 Executing BUY order
✅ BUY SUCCESSFUL!
  signature: XyZ789...
  
📊 Position opened
  Entry Price: 0.00012 SOL
  Tokens: 1666.67
```

### Stats (every 5 min)
```
╔════════════════════════════════════════════════════════╗
║         SNIPER PERFORMANCE SUMMARY                     ║
╠════════════════════════════════════════════════════════╣
║ Uptime:           127.3 minutes
║ Launches:         142
║ Touch Rate:       2.11%  ← Very strict = good!
║ Positions:        3
║ Win Rate:         66.67%
║ Total PnL:        +0.0523 SOL
╠════════════════════════════════════════════════════════╣
║ GATE REJECTION BREAKDOWN                               ║
║ Gate E: 51 (42.1%)  ← Caught sell blocks!
║ Gate A: 32 (26.4%)  ← Low liquidity
║ Gate F: 19 (15.7%)  ← Manipulated flow
║ Gate G: 12 (9.9%)   ← Concentrated holders
╚════════════════════════════════════════════════════════╝
```

## Going Live

### Before Enabling Live Trading

✅ Run in paper mode for **at least 24 hours**
✅ Review stats - ensure reasonable win rate (>50%)
✅ Check gate rejections are catching bad launches
✅ Verify wallet has enough SOL (recommended: 5+ SOL)
✅ Understand you WILL lose some trades (it's part of the game)

### Enable Live Trading
```bash
# Edit .env
ENABLE_LIVE_TRADING=true

# Restart bot
./start.sh
```

You'll see:
```
🔴 LIVE TRADING MODE
⚠️  Real SOL will be used!
Are you sure you want to continue? (yes/no):
```

## Tuning for Your Risk Tolerance

### More Conservative (Touch Fewer, Higher Quality)
```env
MIN_LIQUIDITY_SOL=100           # Up from 75
MAX_ROUND_TRIP_LOSS_PCT=6       # Down from 8
MIN_EARLY_SWAPS=15              # Up from 10
MAX_TOP_HOLDER_PCT=15           # Down from 20
```

### Less Conservative (Touch More, Lower Quality)
```env
MIN_LIQUIDITY_SOL=50            # Down from 75
MAX_ROUND_TRIP_LOSS_PCT=10      # Up from 8
MIN_EARLY_SWAPS=7               # Down from 10
```

**⚠️ Not recommended** - the default strict settings exist for a reason!

## Common Issues

### "No launches detected"
- Wait 5-10 minutes (launches aren't constant)
- Check Helius API key is valid
- Verify RPC URL in logs

### "All launches failing Gate A"
- Market may be slow
- Most launches have <75 SOL liquidity (by design)

### "All launches failing Gate E"  
- **This is good!** Gate E catches sell-blocked tokens
- High Gate E rejection = bot is working correctly

### "Touch rate too low"
- 1-5% is normal and desired for strict mode
- If <1%, market may be exceptionally quiet
- Don't lower thresholds just to trade more

## Monitoring & Maintenance

### Watch Your Balance
```bash
# Check wallet balance regularly
solana balance YOUR_WALLET_ADDRESS
```

### Review Logs
- Green ✅ = good (gates passed, trades executed)
- Red ❌ = expected (most launches fail gates)
- Yellow ⚠️ = warnings (check these)

### Stop Safely
- Press `CTRL+C` once
- Bot will close positions gracefully
- Final stats will print

## Next Steps

1. **Run paper mode overnight** - See how it performs
2. **Review morning stats** - Check rejection breakdown
3. **Start with small size** - 0.1-0.2 SOL per trade
4. **Scale gradually** - Only after consistent wins
5. **Never risk more than you can lose**

## Pro Tips

💡 **Most important metric**: Gate E rejections should be high (30-40%)
💡 **Low touch rate is good**: 2-5% means you're being selective
💡 **Win rate target**: 60-70% is excellent for this strategy
💡 **Use Jito**: Add `JITO_BLOCK_ENGINE_URL` for MEV protection
💡 **Monitor manually**: Occasionally check token contracts yourself
💡 **Keep SOL topped up**: Bot needs fees + trade capital

## Getting Help

Check in this order:
1. Console logs (most issues show up here)
2. README.md (detailed documentation)
3. Gate rejection reasons (tells you why launches are skipped)
4. Environment configuration (verify all settings)

---

**Remember**: This bot will reject 95-98% of launches. That's the point! Quality over quantity. 🎯

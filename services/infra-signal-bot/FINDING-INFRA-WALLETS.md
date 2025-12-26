# Finding Infrastructure Wallets - Practical Guide

## Quick Answer

**You don't need to find them manually** - the bot discovers them automatically. But if you want to seed the system with known wallets or verify discovery, here's how.

---

## Method 1: Let the Bot Discover Automatically (Recommended)

The bot will automatically find infra wallets by watching for:

1. **Absorption behavior**: Wallets that buy back 50%+ of large sells within 30 seconds
2. **Repeated patterns**: Same wallet doing this 3+ times on 2+ different tokens
3. **Behavior classification**: Analyzing trading patterns over time

**Just start the bot** - it will build a database of infra wallets as it runs.

---

## Method 2: Manual Discovery (For Seeding)

If you want to seed the system with known wallets, here are practical methods:

### A. Using DexScreener / Birdeye

1. **Find tokens with large dumps that recovered**
   - Go to DexScreener.com
   - Look for tokens that dumped 10-30% then recovered
   - Check the "Trades" tab for that period

2. **Identify buyers during the dump**
   - Look for wallets that bought during/right after the dump
   - Check if they bought multiple times (accumulation pattern)
   - Note wallets that appear repeatedly across different tokens

3. **Verify behavior**
   - Check wallet on Solscan/SolanaFM
   - Look for: high buy ratio, quick responses, multiple token involvement

### B. Using On-Chain Analytics Tools

**Solscan / SolanaFM:**
```
1. Find a token that dumped and recovered
2. Look at transaction history during dump window
3. Identify wallets that:
   - Bought during the dump
   - Bought multiple times (not just once)
   - Bought within seconds/minutes of the dump
```

**Birdeye / DexScreener:**
```
1. Filter tokens by "recent volatility"
2. Look for "defended" patterns (dip → recovery)
3. Check "Top Traders" or "Smart Money" sections
4. Cross-reference wallets across multiple tokens
```

### C. Using Twitter / Discord Communities

Many trading communities track "smart money" wallets:
- Look for "whale alerts" that mention defensive buying
- Check alpha groups that share "infra wallet" lists
- Verify any shared wallets yourself before trusting

**⚠️ Warning:** Always verify wallets yourself - many shared wallets are scams or outdated.

---

## Method 3: On-Chain Analysis Script

Create a script to analyze recent trades and find absorption patterns:

```typescript
// Example: Find wallets that absorbed large sells
async function findInfraWallets(days: number = 7) {
  // 1. Get all large sells from last N days
  const largeSells = await db.query(`
    SELECT * FROM large_sell_events 
    WHERE detected_at > NOW() - INTERVAL '${days} days'
    ORDER BY detected_at DESC
  `);
  
  // 2. For each sell, find buyers within 30 seconds
  for (const sell of largeSells.rows) {
    const buybacks = await db.query(`
      SELECT trader_wallet, amount_sol, block_time
      FROM trades
      WHERE token_mint = $1
        AND type = 'buy'
        AND block_time BETWEEN $2 AND $3
      ORDER BY amount_sol DESC
    `, [
      sell.token_mint,
      sell.detected_at,
      new Date(sell.detected_at.getTime() + 30000) // 30 seconds
    ]);
    
    // 3. Check if buyback >= 50% of sell
    for (const buy of buybacks.rows) {
      const ratio = buy.amount_sol / sell.sell_amount_sol;
      if (ratio >= 0.5) {
        console.log(`Potential infra wallet: ${buy.trader_wallet}`);
        console.log(`  Absorbed ${(ratio * 100).toFixed(1)}% of ${sell.sell_amount_sol} SOL sell`);
        console.log(`  Response time: ${buy.block_time - sell.detected_at}ms`);
      }
    }
  }
}
```

---

## Method 4: Using the Bot's Discovery Logs

Once the bot is running, it will log discovered wallets:

```
[absorption-detector] ✅ ABSORPTION CONFIRMED
  token: ABC123...
  absorptionWallet: XYZ789...
  ratio: 65%

[absorption-detector] New infra wallet discovered: XYZ789...
[infra-classifier] Wallet classified: defensive (75% confidence)
```

**Check the logs** for discovered wallets, then add them to `KNOWN_INFRA_WALLETS` if you want to trust them immediately.

---

## Method 5: Database Query (After Bot Runs)

After the bot has been running, query the database:

```sql
-- Find all discovered infra wallets
SELECT 
  address,
  behavior_type,
  confidence_score,
  total_absorptions,
  total_defenses,
  avg_response_time_ms,
  win_rate,
  last_seen_at
FROM infra_wallets
WHERE is_blacklisted = false
ORDER BY total_absorptions DESC, confidence_score DESC;

-- Find wallets with best track record
SELECT 
  address,
  behavior_type,
  confidence_score,
  total_absorptions,
  win_rate,
  (total_absorptions * win_rate) as effectiveness_score
FROM infra_wallets
WHERE total_absorptions >= 3
  AND win_rate > 0.6
ORDER BY effectiveness_score DESC;
```

---

## What Makes a Wallet "Infra"?

Look for these patterns:

### ✅ Infra Characteristics:
- **Quick response**: Buys within 5-30 seconds of large sells
- **Repeated behavior**: Does this on multiple tokens (3+ times)
- **Consistent size**: Similar buy amounts (not random)
- **High buy ratio**: Buys more than sells (>60%)
- **Defensive pattern**: Defends price levels repeatedly

### ❌ NOT Infra (Whales/Random):
- **One-time buys**: Only bought once during a dump
- **Random timing**: No pattern to when they buy
- **Variable sizes**: Buy amounts vary wildly
- **High sell ratio**: Sells more than buys
- **No pattern**: Doesn't repeat behavior

---

## Verification Checklist

Before adding a wallet to `KNOWN_INFRA_WALLETS`, verify:

- [ ] Has absorbed 3+ large sells
- [ ] On 2+ different tokens
- [ ] Response time consistently <30 seconds
- [ ] Buy ratio >60%
- [ ] Not a known scam wallet (check Solscan comments)
- [ ] Active in last 7 days

---

## Adding to Bot Configuration

Once you have verified wallets, add them to `.env`:

```bash
KNOWN_INFRA_WALLETS=wallet1_address,wallet2_address,wallet3_address
```

**Example:**
```bash
KNOWN_INFRA_WALLETS=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,5TjCevDrEwCUchRo5tjJu2bS6VpTh3oP3neSTizkQdS7
```

These wallets will be:
- ✅ Trusted immediately (100% confidence)
- ✅ Watched for all trades
- ✅ Used for signal generation

---

## Quick Start: Just Run the Bot

**The easiest approach:**

1. **Start the bot** (even in paper trading mode)
2. **Let it run for 1-2 days**
3. **Check the database** for discovered wallets:
   ```sql
   SELECT address, behavior_type, total_absorptions 
   FROM infra_wallets 
   ORDER BY total_absorptions DESC;
   ```
4. **Add the best ones** to `KNOWN_INFRA_WALLETS` if desired

The bot will discover wallets automatically - you don't need to find them manually!

---

## Tools & Resources

**On-Chain Explorers:**
- Solscan.io - Transaction history, wallet analysis
- SolanaFM.com - Similar to Solscan
- Birdeye.so - Token analytics, top traders

**DEX Analytics:**
- DexScreener.com - Token charts, trade history
- Jupiter.ag - Swap aggregator (can see routes)

**Community Sources:**
- Twitter alpha accounts (verify before trusting)
- Discord trading groups (be careful of scams)
- Reddit r/solana (occasional wallet sharing)

**⚠️ Always verify wallets yourself** - don't trust shared lists blindly.

---

## Example Workflow

1. **Day 1-2**: Run bot, let it discover wallets automatically
2. **Day 3**: Query database for discovered wallets
3. **Day 4**: Manually verify top 5-10 wallets on Solscan
4. **Day 5**: Add verified wallets to `KNOWN_INFRA_WALLETS`
5. **Ongoing**: Bot continues discovering new wallets automatically

---

## Summary

**Best approach:** Just run the bot - it will discover wallets automatically.

**If you want to seed:** Use DexScreener/Birdeye to find tokens that recovered from dumps, identify buyers during the dump, verify they repeat the pattern, then add to `KNOWN_INFRA_WALLETS`.

**The bot's automatic discovery is usually better** because it:
- Finds wallets based on actual behavior
- Classifies them accurately
- Tracks their performance over time
- Updates confidence scores dynamically

You don't need to manually hunt for wallets - the bot does it for you! 🎯


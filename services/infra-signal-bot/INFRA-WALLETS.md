# How the Bot Identifies Infrastructure Wallets

The bot uses **three methods** to identify infrastructure wallets:

## Method 1: Manual List (You Provide)

You can manually specify known infra wallets in your `.env` file:

```bash
KNOWN_INFRA_WALLETS=wallet1_address,wallet2_address,wallet3_address
```

**Example:**
```bash
KNOWN_INFRA_WALLETS=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,5TjCevDrEwCUchRo5tjJu2bS6VpTh3oP3neSTizkQdS7
```

These wallets are **automatically trusted** (100% confidence) and the bot will watch for their activity.

---

## Method 2: Automatic Discovery (Behavior-Based)

The bot **automatically discovers** infra wallets by watching for wallets that:

### A. Absorb Large Sells
When a large sell happens (1-3% of pool), the bot watches for:
- **Known infra wallets** buying back (from Method 1 or database)
- **Any wallet** that buys back at least **10% of the sell size** within 30 seconds

If a wallet absorbs 50%+ of a large sell, it's automatically added to the infra wallet database.

**Example:**
```
Large sell: 5 SOL
Buyback detected: 3 SOL (60% absorption)
→ Wallet automatically marked as infra wallet
```

### B. Show Defensive Behavior
Wallets that consistently:
- Buy immediately after price drops
- Respond within 5-30 seconds to sells
- Have a high buy-to-sell ratio (>60%)
- Trade in consistent patterns

---

## Method 3: Database (Previously Discovered)

The bot loads infra wallets from the `infra_wallets` database table. These are wallets that were:
- Previously discovered by the bot
- Manually added to the database
- Classified based on historical behavior

---

## Classification Types

Once identified, wallets are classified into behavior types:

### 🛡️ **Defensive** (Best for signals)
- High buy ratio (>60%)
- Fast response time (<10 seconds)
- Consistently defends price levels
- **These give the strongest signals**

### ⚡ **Aggressive**
- High trading frequency (>10 trades/hour)
- Large trade sizes (>1 SOL average)
- Market-making behavior
- **Good for signals, but more volatile**

### 🔄 **Cyclical**
- Regular trading patterns
- Balanced buy/sell ratio (~50%)
- Predictable intervals (5-60 minutes)
- **Moderate signal quality**

### 😴 **Passive**
- Low frequency (<2 trades/hour)
- Small trade sizes (<0.5 SOL)
- **Lower signal quality**

### ❓ **Unknown**
- Not enough data yet
- **Low confidence, but still tracked**

---

## How It Works in Practice

### Scenario 1: Manual Wallet
```
You add: KNOWN_INFRA_WALLETS=ABC123...
→ Bot immediately trusts this wallet
→ Watches for its buys after large sells
→ High confidence signals when it absorbs
```

### Scenario 2: Automatic Discovery
```
1. Large sell detected: 2 SOL
2. Wallet XYZ buys 1.2 SOL within 15 seconds (60% absorption)
3. Bot automatically:
   - Adds XYZ to infra_wallets table
   - Classifies it based on behavior
   - Starts tracking it for future signals
```

### Scenario 3: Behavior Classification
```
Wallet DEF has been trading for 1 hour:
- 80% buy ratio
- Average response: 8 seconds
- 5 defense events
→ Classified as "defensive" with 75% confidence
→ Future signals from this wallet get higher strength scores
```

---

## Signal Strength Impact

The infra wallet type affects signal strength:

| Infra Type | Signal Strength Bonus |
|------------|----------------------|
| Defensive | +25 points |
| Aggressive | +20 points |
| Cyclical | +15 points |
| Passive | +10 points |
| Unknown | +10 points |
| Manual (trusted) | +25 points |

**Example:**
- Absorption detected: +30 points
- Fast response (<5s): +25 points
- **Defensive infra wallet**: +25 points
- **Total: 80/100** → Strong signal ✅

---

## Viewing Discovered Wallets

The bot logs when it discovers new infra wallets:

```
[absorption-detector] New infra wallet discovered: ABC123...
[infra-classifier] Wallet classified: defensive (75% confidence)
```

You can also query the database:

```sql
SELECT address, behavior_type, confidence_score, total_absorptions 
FROM infra_wallets 
ORDER BY total_absorptions DESC;
```

---

## Recommendations

### Start With Manual Wallets
If you know some infra wallets, add them to `KNOWN_INFRA_WALLETS`:
- They'll be trusted immediately
- Faster signal generation
- Higher confidence

### Let It Discover
The bot will automatically find new infra wallets as it runs:
- No manual work needed
- Learns from market behavior
- Builds a database over time

### Monitor Classifications
Watch the logs to see:
- Which wallets are being discovered
- How they're being classified
- Their confidence scores

---

## Blacklisting

If a wallet is misclassified or causing bad signals, you can blacklist it:

```sql
UPDATE infra_wallets 
SET is_blacklisted = true 
WHERE address = 'wallet_address_here';
```

The bot will ignore blacklisted wallets.

---

## Summary

**The bot will consider a wallet as "infra" if:**

1. ✅ You manually add it to `KNOWN_INFRA_WALLETS`
2. ✅ It absorbs 50%+ of a large sell within 30 seconds
3. ✅ It shows consistent defensive/aggressive trading patterns
4. ✅ It's in the database from previous runs

**You don't need to provide a list** - the bot will discover them automatically! But providing known wallets can improve signal quality and speed.


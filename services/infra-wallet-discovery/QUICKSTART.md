# Infrastructure Wallet Discovery - Quick Start

## What This Bot Does

**Finds infrastructure wallets that absorb sell pressure and stabilize prices.**

This is NOT a trading bot. It's a behavioral analysis system that discovers which wallets consistently:
1. Buy during large dumps (1-3% of pool)
2. Absorb meaningful sell pressure (20-80%)
3. Stabilize prices afterward
4. Do this repeatedly (3+ times minimum)

## 5-Minute Setup

### 1. Install

```bash
cd services/infra-wallet-discovery
npm install
```

### 2. Check Configuration

Open `.env` at project root. Default settings work well:

```bash
# Key settings (already configured)
DISCOVERY_MIN_SELL_PCT=1.0              # 1% of pool = large sell
SCORING_MIN_EVENTS=3                    # Require 3 events minimum
SCORING_MIN_STABILIZATION_RATE=0.6      # 60% success rate required
```

### 3. Run

```bash
npm run dev
```

### 4. Wait for Data

The bot needs time to collect behavioral evidence:
- **Minimum:** A few hours
- **Reliable results:** 24+ hours
- **High confidence:** Several days

### 5. Check Results

```bash
# View discovered wallets
cat data/infra_wallets.json

# View CSV for spreadsheets
cat data/infra_wallets.csv

# View detailed reports
ls data/reports/
```

## What You'll See

### Console Output

```
[InfraDiscovery] 🔍 INFRASTRUCTURE WALLET DISCOVERY SYSTEM
[SwapMonitor] Monitoring started successfully
[LargeSellDetector] 🔴 Large sell detected: Token 3eqzsw3f... 2.34% of pool
[AbsorptionAnalyzer] 🟢 Absorption candidate: eGkFSm9Y... absorbed 42.1% of sell
[StabilizationValidator] ✅ Stabilization confirmed (confidence: 85%)
[WalletScorer] Wallet eGkFSm9Y... updated: 3 absorptions, 80% success rate
```

Every 5 minutes, see stats:
```
📊 SYSTEM STATISTICS
Uptime: 2.5 hours
Swaps Processed: 1,234
Large Sell Events: 15
Confirmed Infrastructure Wallets: 2
```

### Output Files

**`data/infra_wallets.json`** - Complete data
```json
{
  "infraWallets": [
    {
      "wallet": "eGkFSm9Y...",
      "classification": "defensive-infra",
      "confidenceScore": 85.5,
      "stabilizationRate": 80.0,
      "totalAbsorptions": 5,
      "uniqueTokens": 3
    }
  ]
}
```

**`data/infra_wallets.csv`** - For Excel
```csv
wallet,classification,confidence,status,total_absorptions,...
eGkFSm9Y...,defensive-infra,85.50,active,5,...
```

**`data/reports/[wallet]_report.md`** - Detailed analysis
- Complete behavior breakdown
- Evidence log with all events
- Interpretation explaining why it's classified as infra

## Understanding Classifications

| Classification | Meaning | Confidence | Use Case |
|----------------|---------|------------|----------|
| `defensive-infra` | Highest quality, consistent defenders | 80+ | Most reliable |
| `aggressive-infra` | Larger positions, active defense | 70+ | High confidence |
| `cyclical` | Appears during stress, not continuous | 60+ | Situational |
| `opportunistic` | Buys dumps but inconsistent | 60+ | Lower priority |
| `noise` | No correlation with stabilization | Any | Ignore |
| `candidate` | Needs more data | <60 | Wait for more events |

## Confidence Scores

- **85-100:** Extremely high confidence, proven behavior
- **70-84:** High confidence, reliable pattern
- **60-69:** Medium confidence, emerging pattern
- **30-59:** Low confidence, candidate status
- **0-29:** Very low, likely pruned

## Troubleshooting

**Problem:** No wallets found after hours
- **Solution:** Check logs for large sell events. If none detected, market may be quiet. Lower `DISCOVERY_MIN_SELL_PCT` to 0.5

**Problem:** Many "noise" wallets
- **Solution:** Increase `SCORING_MIN_STABILIZATION_RATE` to 0.7 (70%)

**Problem:** Too few candidates
- **Solution:** Lower `SCORING_MIN_EVENTS` to 2 and `SCORING_MIN_TOKENS` to 1

**Problem:** System not processing swaps
- **Solution:** Check `HELIUS_API_KEY` and RPC connection in `.env`

## Next Steps

Once you've identified infrastructure wallets:

1. **Export to post-absorption trader**
   ```bash
   # The wallets in infra_wallets.json can be used in
   # services/post-absorption-trader
   ```

2. **Monitor wallet reports**
   ```bash
   # Check individual wallet reports for detailed behavior
   cat data/reports/[wallet_address]_report.md
   ```

3. **Track over time**
   ```bash
   # System automatically saves every 15 minutes
   # Compare snapshots to see wallet evolution
   ```

## Key Concepts

### What Makes a Wallet "Infra"?

✅ **Is Infra:**
- Buys during dumps, price stabilizes
- Does this 3+ times across 2+ tokens
- Consistent position sizing
- 60%+ stabilization success rate

❌ **Not Infra:**
- One-time lucky trade
- High PnL but no stabilization
- Erratic behavior
- Buys pumps, not dumps

### Longitudinal Analysis

The system tracks wallets over TIME, not individual trades:
- **Event 1:** Candidate identified
- **Event 2:** Still watching
- **Event 3:** Minimum threshold met, can classify
- **Event 4-5:** Confidence increases
- **Decay:** If inactive, confidence decays

### Confidence Decay

Wallets lose confidence over time if inactive:
- **7 days:** Confidence starts decaying
- **14 days:** Significant decay
- **21+ days:** May be pruned if below threshold

This ensures the system stays current with active infrastructure.

## Command Reference

```bash
# Development mode (auto-reload)
npm run dev

# Build TypeScript
npm run build

# Production mode
npm start

# View logs
tail -f logs/infra-discovery.log
tail -f logs/infra-discovery-error.log
```

## Pro Tips

1. **Let it run continuously** - Behavioral patterns emerge over days
2. **Check reports, not just JSON** - Reports explain WHY a wallet is classified
3. **Focus on "defensive-infra"** - Highest quality, most reliable
4. **Monitor confidence scores** - Scores evolve as evidence accumulates
5. **Compare with known wallets** - Validate against your manually identified infra

## Integration Example

```typescript
// Read discovered infra wallets
import { readFileSync } from 'fs';

const data = JSON.parse(
  readFileSync('data/infra_wallets.json', 'utf-8')
);

// Get high-confidence defensive infra
const topInfra = data.infraWallets
  .filter(w => 
    w.classification === 'defensive-infra' &&
    w.confidenceScore >= 80 &&
    w.status === 'active'
  )
  .map(w => w.wallet);

console.log(`Found ${topInfra.length} high-confidence infra wallets`);

// Use these in post-absorption trading or monitoring
```

## Support

- **Logs:** `logs/infra-discovery.log` and `logs/infra-discovery-error.log`
- **Stats:** Printed every 5 minutes to console
- **Documentation:** See `README.md` for full details

## Remember

This system identifies wallets that **change market structure**, not wallets that make money.

A profitable wallet that doesn't stabilize prices = NOT infra  
An unprofitable wallet that consistently stabilizes = IS infra

The goal is behavioral inference, not profit prediction.

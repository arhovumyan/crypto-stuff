# Infrastructure Wallet Discovery Bot

**Behavioral wallet discovery system that automatically identifies infrastructure / liquidity-absorbing wallets by analyzing on-chain transaction behavior.**

## ⚠️ Important Notes

- **This is NOT a trading bot** - It's a discovery and analysis system only
- **High PnL alone is NOT a valid signal** - We identify wallets that change market structure
- **Single events don't count** - Wallets must demonstrate repeatable behavior (3+ events minimum)
- **No copy trading** - This system only discovers and scores wallets based on behavior

## What is an Infrastructure Wallet?

An infrastructure wallet is defined as a wallet that:

1. **Buys during large sell pressure** (1-3% of pool liquidity)
2. **Absorbs a meaningful portion** of the sell (20-80%)
3. **Appears repeatedly** across multiple events
4. **Coincides with price stabilization**
5. **Exhibits consistent behavior** over time

## System Architecture

### 1. Data Ingestion Layer (`swapMonitor.ts`)
Monitors swaps from:
- Raydium AMM
- PumpFun
- PumpSwap

Captures for each swap:
- Slot, timestamp, token mint
- Pool address, trader wallet
- Buy/sell direction, amounts
- On-chain pool reserves
- Derived price and price impact

### 2. Large Sell Event Detector (`largeSellDetector.ts`)
Detects market stress events:
- Identifies "large sells" (1-3% of pool liquidity)
- Excludes panic sells (>3%) and noise (<1%)
- Opens observation windows for absorption analysis
- Tracks price before/after events

### 3. Absorption Analysis Engine (`absorptionAnalyzer.ts`)
During observation windows:
- Measures % of sell absorbed by each buyer
- Counts buy transactions
- Measures response latency (slots)
- Tracks price impact
- Identifies candidates (20-80% absorption)

### 4. Price Stabilization Validator (`stabilizationValidator.ts`)
After absorption, validates:
- Price stops making lower lows
- Defense level holds
- Volume contracts (30%+ decrease)
- No new large sells occur
- Calculates confidence score (0-100)

### 5. Longitudinal Wallet Scoring (`walletScorer.ts`)
**The most important component** - tracks wallets across time:

**Metrics:**
- Number of successful absorptions
- Number of unique tokens defended
- Stabilization success rate
- Average response latency
- Size consistency
- Exit behavior

**Requirements:**
- Minimum 3 valid absorption events
- Minimum 2 unique tokens
- 60%+ stabilization success rate
- Confidence score ≥30

**Classification:**
- `defensive-infra` - Highest value, consistent defenders
- `aggressive-infra` - Larger positions, active defense
- `cyclical` - Appears during stress, not continuous
- `opportunistic` - Buys dumps but not systematic
- `noise` - No correlation with stabilization
- `candidate` - Needs more data

### 6. Confidence Decay & Pruning
- Confidence decays with inactivity
- Halves every 7 days by default
- Wallets below threshold are pruned
- Infra wallets are temporary, not permanent

### 7. Output & Reporting (`outputManager.ts`)
Produces:
- `data/infra_wallets.json` - Complete data
- `data/infra_wallets.csv` - Spreadsheet format
- `data/reports/[wallet]_report.md` - Per-wallet reports with evidence

## Quick Start

### 1. Installation

```bash
cd services/infra-wallet-discovery
npm install
```

### 2. Configuration

All configuration is in `.env` at the project root. Key parameters:

```bash
# Large Sell Detection
DISCOVERY_MIN_SELL_PCT=1.0          # 1% of pool minimum
DISCOVERY_MAX_SELL_PCT=3.0          # 3% of pool maximum

# Absorption Thresholds
DISCOVERY_MIN_ABSORPTION_PCT=20     # 20% minimum absorption
DISCOVERY_MAX_ABSORPTION_PCT=80     # 80% maximum

# Scoring Requirements
SCORING_MIN_EVENTS=3                # Minimum 3 events
SCORING_MIN_TOKENS=2                # Minimum 2 tokens
SCORING_MIN_STABILIZATION_RATE=0.6  # 60% success rate
```

### 3. Running

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm run build
npm start
```

### 4. Output

Check `data/` directory:
- `infra_wallets.json` - Complete wallet data
- `infra_wallets.csv` - For Excel/spreadsheets
- `reports/` - Individual wallet behavior reports

## Understanding the Output

### JSON Structure

```json
{
  "generatedAt": "2025-12-26T...",
  "systemStats": {
    "totalSwapsProcessed": 1000,
    "totalLargeSellEvents": 50,
    "confirmedInfraWallets": 3
  },
  "infraWallets": [
    {
      "wallet": "...",
      "classification": "defensive-infra",
      "confidenceScore": 85.5,
      "status": "active",
      "totalAbsorptions": 5,
      "successfulAbsorptions": 4,
      "stabilizationRate": 80.0,
      "uniqueTokens": 3,
      "avgAbsorptionPercent": 35.2,
      "avgResponseLatency": 45,
      "firstSeen": 1234567890000,
      "lastSeen": 1234567990000
    }
  ]
}
```

### Wallet Report

Each wallet gets a markdown report explaining:
- Classification and confidence
- Summary statistics
- Timeline
- Evidence log with recent events
- Interpretation of behavior

Example: `data/reports/[wallet_address]_report.md`

## How Confidence Scoring Works

Confidence score (0-100) is calculated from:

| Factor | Max Points | Description |
|--------|-----------|-------------|
| Event Count | 30 | More events = higher confidence |
| Stabilization Rate | 25 | % of absorptions that stabilized |
| Unique Tokens | 15 | Breadth of activity |
| Size Consistency | 10 | Lower variance = higher score |
| Activity Pattern | 10 | Consistent > Cyclical > Opportunistic |
| Response Speed | 10 | Faster = better |
| **Penalty** | -20 | For failed stabilizations |

**Minimum threshold:** 30 points to be tracked  
**Infra classification:** Requires 60+ points

## Classification Criteria

### Defensive Infra
- **Stabilization rate:** ≥80%
- **Size consistency:** ≥70%
- **Pattern:** Consistent activity
- **Characteristics:** High success rate, systematic behavior

### Aggressive Infra
- **Stabilization rate:** ≥70%
- **Avg absorption:** ≥40%
- **Characteristics:** Larger positions, active defense

### Cyclical
- **Pattern:** Cyclical activity
- **Characteristics:** Appears during stress, gaps in activity

### Opportunistic
- **Confidence:** 60-79
- **Characteristics:** Buys dumps but inconsistent

### Noise
- **Stabilization rate:** <60%
- **Characteristics:** Absorptions don't correlate with stabilization

## Advanced Usage

### Monitoring Performance

The system logs statistics every 5 minutes:
- Swaps processed
- Active events (observing/analyzing)
- Wallet counts by classification
- Processing performance

### Adjusting Sensitivity

**More strict (fewer false positives):**
```bash
SCORING_MIN_EVENTS=5                # Require more events
SCORING_MIN_STABILIZATION_RATE=0.7  # Require higher success rate
DISCOVERY_MIN_ABSORPTION_PCT=30     # Higher absorption threshold
```

**More permissive (catch more wallets):**
```bash
SCORING_MIN_EVENTS=2                # Fewer events required
SCORING_MIN_STABILIZATION_RATE=0.5  # Lower success rate
DISCOVERY_MIN_ABSORPTION_PCT=15     # Lower absorption threshold
```

### Confidence Decay

Adjust decay rate:
```bash
SCORING_CONFIDENCE_DECAY_DAYS=14    # Slower decay (more persistent)
SCORING_CONFIDENCE_DECAY_DAYS=3     # Faster decay (more reactive)
```

## Interpreting Results

### Why We Believe a Wallet is Infra

For each wallet, ask:
1. **How many times** has it absorbed sell pressure? (≥3 required)
2. **Across how many tokens?** (≥2 required)
3. **What % of absorptions stabilized?** (≥60% required)
4. **How consistent is the behavior?** (size consistency score)
5. **How quickly does it respond?** (response latency)

### Red Flags (Not Infra)

- Only 1-2 events (insufficient data)
- Low stabilization rate (<60%)
- Only one token
- Erratic position sizing
- Slow response times
- Recent failures

### Green Flags (Likely Infra)

- 5+ absorption events
- 3+ unique tokens
- 80%+ stabilization rate
- Consistent position sizing
- Fast response (<50 slots)
- Recent activity

## Integration with Trading Systems

This discovery system can export wallets for use in other systems:

```typescript
// Read discovered wallets
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('data/infra_wallets.json', 'utf-8'));

// Filter for high-confidence defensive infra
const topInfra = data.infraWallets.filter(w => 
  w.classification === 'defensive-infra' &&
  w.confidenceScore >= 80 &&
  w.status === 'active'
);

// Use these wallets in post-absorption trading
// (See: services/post-absorption-trader)
```

## Limitations

- **Real-time only:** Historical backfill not implemented
- **Pool reserves:** Estimated from transactions, not queried on-chain
- **Exit behavior:** Not fully analyzed yet
- **Wallet clustering:** Not implemented
- **False positives:** Expect some, especially early on
- **Market regime:** No awareness of hostile markets

## FAQ

**Q: How long until I see results?**  
A: Depends on market activity. You need 3+ large sell events per wallet across 2+ tokens. Could be hours to days.

**Q: Why are some wallets marked as "noise"?**  
A: Their absorptions don't correlate with stabilization. They buy dumps but it doesn't help.

**Q: What's the difference between defensive and aggressive infra?**  
A: Defensive has higher success rate (80%+) and consistency. Aggressive takes larger positions (40%+).

**Q: Can I use this for copy trading?**  
A: No. This discovers infrastructure wallets. For post-absorption trading, see `services/post-absorption-trader`.

**Q: How do I know if the system is working?**  
A: Check stats every 5 minutes. You should see swaps being processed and events being detected.

**Q: What if no wallets are found?**  
A: Either:
  - Not enough time elapsed (needs hours/days)
  - No large sell events occurred
  - Thresholds too strict (try adjusting)
  - No systematic infra wallets exist in current market

**Q: Is high PnL a signal?**  
A: No. We only care about market structure impact. A wallet can be unprofitable and still be infra.

## Support

For issues, check:
1. `logs/infra-discovery.log` - Full system logs
2. `logs/infra-discovery-error.log` - Error logs only
3. System stats output every 5 minutes

## License

See project root LICENSE file.

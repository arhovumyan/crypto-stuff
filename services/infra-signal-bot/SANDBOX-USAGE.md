# Sandbox System - Usage Guide

## Quick Start

### Step 1: Record Live Swaps (5 minutes)
```bash
npm run record -- --duration 300
```

This will:
- Connect to Helius WebSocket
- Stream live swaps from PumpSwap, PumpFun, Raydium
- Record to `swaps_2025-12-26.jsonl` (or current date)
- Stop automatically after 5 minutes

**What's being recorded:**
- Transaction metadata: `slot`, `signature`, `txIndex`, `logIndex`
- Trade details: `tokenMint`, `trader`, `side` (buy/sell)
- Amounts: `amountIn`, `amountOut`, `amountInSOL`
- Pool state: `reserveSOL`, `reserveToken`, `priceSOL`, `liquidityUSD`

### Step 2: Replay the Recording
```bash
npm run replay -- --input ./swaps_2025-12-26.jsonl --speed 10x --mode realistic
```

This will:
- Load recorded swaps
- Replay in deterministic order
- Simulate trading with latency & slippage
- Track virtual positions
- Generate performance report

**Output:**
```
simulation-output/
├── run_summary.json        # Overall stats
├── trades.csv              # Per-trade details
├── wallet_performance.csv  # Infra wallet analytics
└── report.md               # Human-readable summary
```

---

## Command Reference

### Recording

```bash
npm run record -- [OPTIONS]
```

**Options:**
- `--duration SECONDS` - How long to record (default: 3600 = 1 hour)

**Examples:**
```bash
# Record for 5 minutes
npm run record -- --duration 300

# Record for 1 hour (default)
npm run record

# Stop recording early
Ctrl+C
```

### Replaying

```bash
npm run replay -- --input PATH [OPTIONS]
```

**Options:**
- `--input PATH` - Path to recorded dataset (required)
- `--speed 1x|10x|100x|max` - Replay speed (default: 10x)
- `--output DIR` - Where to save reports (default: ./simulation-output)
- `--mode idealized|realistic|stress` - Fill simulation mode (default: realistic)
- `--capital SOL` - Starting capital in SOL (default: 10)

**Examples:**
```bash
# Basic replay at 10x speed
npm run replay -- --input ./swaps_2025-12-26.jsonl --speed 10x

# Stress test with adverse fills
npm run replay -- --input ./swaps_2025-12-26.jsonl --mode stress --capital 100

# Maximum speed (no delays)
npm run replay -- --input ./swaps_2025-12-26.jsonl --speed max
```

---

## Understanding Replay Modes

### Idealized Mode (`--mode idealized`)
- Zero latency
- No slippage
- Perfect fills
- **Use for:** Testing strategy logic only

### Realistic Mode (`--mode realistic`) [DEFAULT]
- ~2 slots latency (~800ms)
- Slippage based on pool depth
- Occasional quote stale / route failures
- **Use for:** Normal backtesting

### Stress Mode (`--mode stress`)
- Higher latency (4+ slots)
- Aggressive slippage
- Frequent failures
- **Use for:** Worst-case testing

---

## Output Files Explained

### run_summary.json
```json
{
  "runId": "sim_1703620800_abc123",
  "dataset": "./swaps_2025-12-26.jsonl",
  "startTime": "2025-12-26T17:00:00Z",
  "endTime": "2025-12-26T17:05:00Z",
  "totalTrades": 5,
  "winRate": 0.6,
  "totalPnL": 1.25,
  "maxDrawdown": -0.5,
  "sharpe": 1.8
}
```

### trades.csv
| tradeId | token | entry | exit | pnl | mae | mfe | reason |
|---------|-------|-------|------|-----|-----|-----|--------|
| 1 | ABC... | 0.001 | 0.0012 | +20% | -5% | +25% | take_profit |
| 2 | DEF... | 0.002 | 0.0018 | -10% | -12% | +2% | stop_loss |

### wallet_performance.csv
| wallet | absorptions | confidence | pnl_contribution |
|--------|-------------|------------|------------------|
| eGk... | 12 | 85 | +0.5 SOL |
| Ar2... | 8 | 72 | +0.3 SOL |

---

## Typical Workflows

### Test a Strategy Change
```bash
# 1. Record fresh data
npm run record -- --duration 300

# 2. Replay with current strategy
npm run replay -- --input ./swaps_2025-12-26.jsonl --output ./before

# 3. Modify strategy code (e.g., change minSellPct)

# 4. Replay again with same data
npm run replay -- --input ./swaps_2025-12-26.jsonl --output ./after

# 5. Compare
diff before/run_summary.json after/run_summary.json
```

### Compare Execution Modes
```bash
# Same data, three modes
npm run replay -- --input ./swaps.jsonl --mode idealized --output ./ideal
npm run replay -- --input ./swaps.jsonl --mode realistic --output ./real
npm run replay -- --input ./swaps.jsonl --mode stress --output ./stress

# Compare max drawdown across modes
jq .maxDrawdown ideal/run_summary.json real/run_summary.json stress/run_summary.json
```

### Daily Regression Test
```bash
# Record overnight
npm run record -- --duration 28800  # 8 hours

# Replay next day
npm run replay -- --input ./swaps_2025-12-26.jsonl --mode realistic

# Check if strategy still profitable
cat simulation-output/report.md
```

---

## Troubleshooting

### "Missing script: record"
**Fix:** Make sure you're in the correct directory:
```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/infra-signal-bot
npm run record
```

### "WebSocket error: 401 Unauthorized"
**Fix:** Check your `.env` file has valid `HELIUS_API_KEY`:
```bash
grep HELIUS_API_KEY .env
```

### "Cannot open dataset: ENOENT"
**Fix:** Check the file path is correct:
```bash
ls -lh swaps_*.jsonl
npm run replay -- --input ./swaps_2025-12-26.jsonl  # Use correct date
```

### Replay finishes instantly with 0 trades
**Possible causes:**
1. Dataset is empty (check file size: `ls -lh swaps_*.jsonl`)
2. No large sells in the data (recording was too short)
3. Strategy thresholds too strict (check `minSellLiquidityPct` in config)

---

## Status

✅ **Working Now:**
- Recording live swaps from Helius
- Deterministic replay (slot → txIndex ordering)
- Virtual portfolio management
- Fill simulation with latency/slippage
- Basic sell detection
- CLI tools

⚠️ **Simplified (Phase 3):**
- Full detection pipeline (absorption + stabilization)
- Pool state parsers (using stubs)
- Attribution reports (partial)

⏳ **Not Yet Implemented:**
- CI check for no-signing constraint
- Invariants test suite
- Replay-vs-live parity tests

---

## Next Steps

1. **Run a quick test:**
   ```bash
   npm run record -- --duration 300
   # Wait 5 minutes, then Ctrl+C
   npm run replay -- --input ./swaps_2025-12-26.jsonl --speed 10x
   cat simulation-output/report.md
   ```

2. **If it works, record longer:**
   ```bash
   npm run record -- --duration 3600  # 1 hour
   ```

3. **Monitor progress in Phase 3:**
   - Wire real strategy modules
   - Implement pool state parsers
   - Finish attribution reports

See `PHASE-2-COMPLETE.md` for implementation details.


# Wallet Analyzer

Analyzes Solana wallet trading activity to calculate profit/loss per token.

## Features

- 📊 **Transaction Scanning** - Fetches all swap transactions from Solscan API
- 💰 **P/L Calculation** - Calculates profit/loss per token and overall
- 📈 **ROI Tracking** - Shows return on investment percentages
- 🏆 **Winners & Losers** - Highlights best and worst performing trades
- ⏳ **Unrealized Positions** - Shows tokens still being held

## Usage

```bash
# Analyze a wallet (last 30 days by default)
npm run analyze <wallet_address>

# Analyze last 7 days
npm run analyze <wallet_address> -- -d 7

# Analyze last 90 days
npm run analyze <wallet_address> -- -d 90

# Show all tokens (no limit)
npm run analyze <wallet_address> -- --all

# Show top 10 tokens only
npm run analyze <wallet_address> -- -t 10

# Output as JSON
npm run analyze <wallet_address> -- --json
```

## Example

```bash
npm run analyze 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU -- -d 30
```

## Output

```
═══════════════════════════════════════════════════════════════
                    📊 WALLET ANALYSIS REPORT                   
═══════════════════════════════════════════════════════════════

📍 Wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
📅 Period: 11/24/2025 → 12/24/2025
🔄 Total Swaps: 156
🪙 Unique Tokens: 42

───────────────────────────────────────────────────────────────
                         💰 OVERALL SUMMARY                       
───────────────────────────────────────────────────────────────

Total SOL Spent:      -50.0000 SOL
Total SOL Received:   +65.5000 SOL
Net Profit/Loss:      +15.5000 SOL
ROI:                  +31.00%

Profitable Tokens:    18
Unprofitable Tokens:  12
Unrealized (holding): 12

───────────────────────────────────────────────────────────────
  ✅ PROFITABLE! Net gain of 15.5000 SOL (31.00%)
───────────────────────────────────────────────────────────────
```

## Requirements

- Node.js 18+
- Helius RPC URL (set in `.env` as `HELIUS_RPC_URL`)

## Environment Variables

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxx
# Optional: SOLSCAN_API_KEY for enhanced token metadata (not required)
```

## How It Works

1. Fetches all transaction signatures from the wallet via Solana RPC
2. Parses each transaction to identify SOL ↔ Token swaps
3. Groups transactions by token
4. Calculates:
   - Total SOL spent buying each token
   - Total SOL received selling each token
   - Net profit/loss per token
   - Overall wallet P/L

## Limitations

- Only analyzes SOL ↔ Token swaps (not token-to-token)
- Doesn't account for tokens still held (unrealized gains/losses)
- For very active wallets (hundreds of transactions), analysis may take several minutes due to RPC rate limits
- Processes transactions sequentially to respect API rate limits


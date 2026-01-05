# Solana Transaction History Fetcher & Viewer

A modern, TypeScript-based tool to fetch and visualize Solana blockchain transaction history for any wallet address.

## Features

- ✅ **Fetch up to 10,000+ transactions** from any Solana wallet
- 📊 **CSV Export** - Clean, organized transaction data
- 🎨 **Modern Web UI** - Beautiful, responsive transaction viewer
- 🔍 **Advanced Filtering** - Search by token, status, or value
- 💎 **Swap Detection** - Identifies token swaps (Jupiter, Raydium, etc.)
- 📈 **Statistics Dashboard** - Real-time stats on your transactions
- ⚡ **Rate Limit Handling** - Smart retry logic for API limits

## Quick Start

### Prerequisites

- Node.js 20+
- Helius RPC URL (already configured in `.env`)

### Installation

Dependencies are already installed in the workspace. If needed:

```bash
npm install
```

### Usage

#### 1. Fetch Transactions

Fetch the last 10,000 transactions for a wallet:

```bash
cd /Users/aro/Documents/Trading/CopyTrader
npx tsx scripts/fetch-transactions-helius.ts <WALLET_ADDRESS> <LIMIT>
```

**Example:**
```bash
npx tsx scripts/fetch-transactions-helius.ts ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT 10000
```

This will create a CSV file: `transactions_<WALLET>_<DATE>.csv`

#### 2. View Transactions

Open the modern web viewer:

```bash
open scripts/transaction-viewer.html
```

Or drag and drop the HTML file into any web browser.

## CSV Format

The generated CSV includes:

| Column | Description |
|--------|-------------|
| **Time** | How long ago the transaction occurred (e.g., "2m", "5h", "3d") |
| **Value** | Transaction fee in USD equivalent |
| **Amount From** | Amount of tokens sent/sold |
| **Token From** | Token symbol sent (SOL, USDC, etc.) |
| **Amount To** | Amount of tokens received/bought |
| **Token To** | Token symbol received |
| **Transaction Hash** | Unique transaction identifier |
| **Status** | Success or Failed |

## Web Viewer Features

### 📊 Dashboard Statistics
- Total transactions count
- Successful vs Failed transactions
- Total transaction value

### 🔍 Advanced Filtering
- **Search by Token** - Find transactions for specific tokens
- **Filter by Status** - Show only successful or failed transactions
- **Filter by Value** - Set minimum transaction value

### ⚙️ Interactive Features
- Click transaction hash to view on Solscan
- Export filtered data to new CSV
- Responsive design for mobile/tablet/desktop
- Real-time filtering and search

## Technical Details

### Architecture

```
fetch-transactions-helius.ts
├── Uses Helius RPC via Solana Web3.js
├── Fetches transaction signatures in batches
├── Retrieves parsed transaction details
├── Extracts swap information from instructions
└── Generates formatted CSV output

transaction-viewer.html
├── Pure HTML/CSS/JavaScript (no frameworks)
├── Modern gradient UI design
├── Client-side CSV parsing
├── Real-time filtering engine
└── Export functionality
```

### Rate Limiting

The script includes intelligent rate limiting:
- 150ms delay between transactions
- 500ms delay between batches
- 2-second backoff on 429 errors
- Automatic retry logic

### Token Detection

Automatically recognizes common tokens:
- SOL, USDC, USDT, mSOL
- BONK, PYTH, JUP, POPCAT, BOME
- And more...

## Examples

### Fetch Recent 100 Transactions
```bash
npx tsx scripts/fetch-transactions-helius.ts ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT 100
```

### Fetch Maximum History (10,000)
```bash
npx tsx scripts/fetch-transactions-helius.ts ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT 10000
```

## Output Files

Generated files are saved in `/scripts/` directory:

```
scripts/
├── transactions_ERBVcqUW_2026-01-04.csv    # CSV data
├── transaction-viewer.html                  # Web viewer
└── fetch-transactions-helius.ts             # Fetcher script
```

## Performance

- **Speed**: ~50-100 transactions per minute (due to RPC rate limits)
- **10,000 transactions**: ~2-3 hours
- **Memory**: Minimal (streams data as it fetches)

## Troubleshooting

### Rate Limiting Issues

If you see "429 Too Many Requests":
- The script will automatically retry
- You can increase delays in the code if needed
- Consider using a premium RPC endpoint

### Missing Transactions

If transactions don't appear:
- Check if wallet address is correct
- Ensure RPC URL is working: check `.env` file
- Try reducing batch size if timing out

### CSV Not Loading in Viewer

- Make sure CSV is in same directory as HTML file
- Or use "📁 Load CSV" button to browse for file
- Check browser console for errors (F12)

## API Configuration

The tool uses Helius RPC configured in `.env`:

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
```

## License

MIT License - Feel free to use and modify

## Credits

Built with:
- [@solana/web3.js](https://github.com/solana-labs/solana-web3.js)
- Helius RPC API
- Modern CSS Gradients

---

**Note**: This tool is for personal use. Please respect API rate limits and terms of service.

## Support

For issues or questions:
1. Check the logs: `tail -f /tmp/tx-fetch-10k.log`
2. Verify RPC connection: `echo $HELIUS_RPC_URL`
3. Test with smaller batch first (100 transactions)

---

**Last Updated**: January 4, 2026
**Version**: 1.0.0

# Loss Monitor Service

Automatically monitors all token positions and sells any token that reaches a 5% loss threshold.

## Features

- **Real-time Monitoring**: Checks token positions every second
- **Automatic Stop-Loss**: Sells tokens when loss reaches 5% from purchase price
- **Price Tracking**: Uses DexScreener API to get current token prices
- **Database Integration**: Reads positions from the database to track cost basis
- **On-chain Verification**: Verifies actual token balances on-chain before selling

## Setup

1. Install dependencies:
```bash
npm install
```

2. Ensure your `.env` file has:
- `COPY_WALLET_SEED_PHRASE` - Your wallet seed phrase
- `HELIUS_RPC_URL` - Solana RPC endpoint
- `DATABASE_URL` - PostgreSQL connection string
- `JUPITER_API_KEY` - Jupiter API key (for executing sells)
- `ENABLE_LIVE_TRADING` - Set to `true` for live trading, `false` for paper trading

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## How It Works

1. **Position Tracking**: Reads all positions from the database that have a balance > 0
2. **Balance Verification**: Checks on-chain token balances to ensure positions are real
3. **Price Monitoring**: Fetches current token prices from DexScreener every second
4. **Loss Calculation**: Calculates loss percentage: `(purchasePrice - currentPrice) / purchasePrice * 100`
5. **Auto-Sell**: When loss >= 5%, automatically executes a sell order via Jupiter
6. **Database Update**: Updates position size to 0 after successful sell

## Configuration

The loss threshold is currently set to **5%** in the code. To change it, edit:
```typescript
const LOSS_THRESHOLD_PERCENT = 5.0; // Change this value
```

## Logs

The service logs:
- Token positions being monitored
- Loss percentages (when safe)
- Warning when loss threshold is reached
- Sell execution details (signature, amounts, etc.)

## Notes

- Runs independently from the copy-executor service
- Can run in paper trading mode (simulates sells without executing)
- Automatically stops monitoring tokens that are sold or removed from wallet


# Solana Automated Trading System

## Overview

This is a fully automated Solana trading system consisting of three independent services:

1. **Service 1 - Token Discovery**: Discovers newly created Solana tokens (0-24 hours old)
2. **Service 2 - Token Validator**: Validates tokens against trading criteria
3. **Service 3 - Trading Executor**: Executes trades and monitors positions for 2x exit

## Trading Criteria

The system only trades tokens that meet ALL of these requirements:

1. ✓ Market cap reached above $20,000 within 60 minutes of launch
2. ✓ Market cap dropped by 50% from its all-time high
3. ✓ No more than 30% of liquidity held by one wallet
4. ✓ Has sufficient liquidity (100% bonding curve progress)

## Exit Strategy

- **Target**: 2x (100% profit)
- **Monitoring**: Checks positions every 1 second
- **Action**: Automatically sells entire position when 2x is reached

## Installation

```bash
# Install MongoDB (if not already installed)
brew install mongodb-community@7.0
brew services start mongodb-community@7.0

# Install dependencies
cd services/solana-auto-trader
npm install
```

## Running the Services

You need to run each service in a **separate terminal**:

### Terminal 1 - Token Discovery
```bash
cd services/solana-auto-trader
npm run discovery
```

### Terminal 2 - Token Validator
```bash
cd services/solana-auto-trader
npm run validator
```

### Terminal 3 - Trading Executor
```bash
cd services/solana-auto-trader
npm run executor
```

## Environment Variables

All required API keys and configuration are in the root `.env` file:

- `HELIUS_API_KEY` - For Solana RPC access
- `HELIUS_RPC_URL` - Helius RPC endpoint
- `JUPITER_API_URL` - Jupiter aggregator for swaps
- `COPY_WALLET_SEED_PHRASE` - Your trading wallet
- `MONGODB_URI` - MongoDB connection (default: mongodb://localhost:27017)

## Database

The system uses MongoDB with two collections:

- `tokens` - Stores discovered and validated tokens
- `positions` - Stores active and closed trading positions

## Logging

All services log with timestamps in `HH:MM:SS` format:

- All discovered tokens are logged
- All validation checks are logged with pass/fail reasons
- All trades are logged with entry/exit details
- Position monitoring shows real-time profit percentages

## Safety Features

- Maximum 3 concurrent positions
- Fixed buy amount (0.1 SOL per trade)
- Automatic validation before trading
- Real-time position monitoring
- Graceful shutdown handling

## Monitoring

Watch the logs to see:
- New tokens being discovered
- Validation results (why tokens pass or fail)
- Trade executions (buy/sell)
- Position monitoring (profit % updates)
- Exit signals (when 2x is reached)

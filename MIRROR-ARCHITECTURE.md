# Mirror Trading System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     LEADER WALLETS                          │
│  (WATCH_ADDRESSES from .env)                               │
│                                                             │
│  • 5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6         │
│  • C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ On-chain transactions
                         │ (monitored via Helius)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  SOLANA BLOCKCHAIN                          │
│                  (via Helius RPC)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Poll every 2 minutes
                         │ getSignaturesForAddress()
                         ▼
╔══════════════════════════════════════════════════════════════╗
║              TERMINAL 1: WALLET WATCH LISTENER               ║
║  📂 services/wallet-mirror/src/wallet-watch-listener.ts      ║
╚══════════════════════════════════════════════════════════════╝
        │
        │ What it does:
        │ • Fetches recent signatures for each watch address
        │ • Parses transactions with Helius Enhanced API
        │ • Identifies BUY/SELL swaps (SOL ↔ Token)
        │ • Filters out non-swap transactions
        │ • Checks blacklist
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                     PostgreSQL DATABASE                      │
│                                                              │
│  Table: leader_trades                                       │
│  ┌────┬─────────┬──────────┬─────────┬──────────┐         │
│  │ id │ wallet  │ token_in │ amount  │ block_time│         │
│  ├────┼─────────┼──────────┼─────────┼──────────┤         │
│  │ 1  │ 5XvR... │ SOL      │ 0.5     │ 2024...  │         │
│  │ 2  │ 5XvR... │ BONK     │ 15000   │ 2024...  │         │
│  └────┴─────────┴──────────┴─────────┴──────────┘         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Poll every 2 minutes
                         │ SELECT * WHERE id > last_processed
                         ▼
╔══════════════════════════════════════════════════════════════╗
║              TERMINAL 2: MIRROR EXECUTOR                     ║
║  📂 services/wallet-mirror/src/mirror-executor.ts            ║
╚══════════════════════════════════════════════════════════════╝
        │
        │ Decision logic:
        │
        ├─ Is it a BUY (SOL → Token)?
        │  │
        │  ├─ Is token blacklisted? → Skip
        │  │
        │  ├─ Calculate: $0.10 / SOL_price = SOL amount
        │  │
        │  └─ Execute buy via Jupiter ────────────┐
        │                                          │
        └─ Is it a SELL (Token → SOL)?            │
           │                                       │
           ├─ Do we have a position? → No: Skip   │
           │                         → Yes:        │
           │                                       │
           └─ Sell entire position via Jupiter ───┤
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   JUPITER AGGREGATOR                         │
│              (Best route across all DEXs)                   │
│                                                              │
│  1. Get quote (getQuote)                                    │
│  2. Build swap transaction (swap)                           │
│  3. Return serialized transaction                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Sign & send transaction
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    YOUR WALLET                               │
│   9JmeM26hgsceGwtpxiM8RZndPF3jkMDQMUtmMyi8F7WM             │
│                                                              │
│   Holdings:                                                 │
│   • SOL balance                                             │
│   • Token positions (tracked by executor)                   │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ Record result
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     PostgreSQL DATABASE                      │
│                                                              │
│  Table: copy_attempts                                       │
│  ┌────┬──────────────┬─────────┬───────────┬──────────┐   │
│  │ id │ trade_id     │ status  │ signature │ amount   │   │
│  ├────┼──────────────┼─────────┼───────────┼──────────┤   │
│  │ 1  │ 1            │ success │ 3Hj8x...  │ 0.0005   │   │
│  │ 2  │ 2            │ success │ 5Mn9z...  │ 750 BONK │   │
│  └────┴──────────────┴─────────┴───────────┴──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### BUY Flow
```
Leader buys 5 SOL of BONK
       ↓
Listener detects transaction
       ↓
Stores in database:
  - token_in: SOL
  - amount_in: 5.0
  - token_out: BONK
  - amount_out: 150,000
       ↓
Executor reads from database
       ↓
Calculates: $0.10 / $200 = 0.0005 SOL
       ↓
Gets Jupiter quote:
  - Input: 0.0005 SOL
  - Output: ~750 BONK
       ↓
Signs & sends transaction
       ↓
Records success in copy_attempts
       ↓
Updates position tracking:
  - BONK: 750 tokens
```

### SELL Flow
```
Leader sells 150,000 BONK
       ↓
Listener detects transaction
       ↓
Stores in database:
  - token_in: BONK
  - amount_in: 150,000
  - token_out: SOL
  - amount_out: 6.2
       ↓
Executor reads from database
       ↓
Checks position: 750 BONK
       ↓
Gets Jupiter quote:
  - Input: 750 BONK
  - Output: ~0.0062 SOL (~$1.24)
       ↓
Signs & sends transaction
       ↓
Records success in copy_attempts
       ↓
Clears position tracking:
  - BONK: 0 tokens (sold all)
```

## Timing

```
Time: 00:00 → Leader buys BONK
Time: 00:30 → No detection yet (waiting for next poll)
Time: 02:00 → Listener polls, detects transaction
Time: 02:01 → Stores in database
Time: 02:30 → No execution yet (waiting for next poll)
Time: 04:00 → Executor polls, finds new trade
Time: 04:01 → Gets Jupiter quote
Time: 04:02 → Executes swap
Time: 04:03 → Confirms transaction
Time: 04:04 → Records result

Total delay: ~4 minutes from leader's trade to your copy
```

## Configuration Files

```
.env (project root)
├── WATCH_ADDRESSES=wallet1,wallet2          ← Who to mirror
├── COPY_WALLET_SEED_PHRASE=twelve words     ← Your wallet
├── ENABLE_LIVE_TRADING=true                 ← Paper/Live mode
├── BLACKLIST_TOKENS=token1,token2           ← Skip these
├── HELIUS_API_KEY=xxx                       ← For parsing txs
├── HELIUS_RPC_URL=https://...               ← RPC endpoint
└── DATABASE_URL=postgresql://...            ← Storage
```

## Key Components

### 1. Wallet Watch Listener
- **Purpose**: Detect leader trades
- **Frequency**: Every 2 minutes
- **Input**: WATCH_ADDRESSES from .env
- **Output**: Records in `leader_trades` table
- **Dependencies**: Helius API, PostgreSQL

### 2. Mirror Executor
- **Purpose**: Copy trades with fixed $0.10 buys
- **Frequency**: Every 2 minutes
- **Input**: `leader_trades` table
- **Output**: Executed swaps via Jupiter
- **Dependencies**: Jupiter API, Your wallet, PostgreSQL

### 3. PostgreSQL Database
- **Tables**: 
  - `leader_trades`: Detected trades from leaders
  - `copy_attempts`: Your copy trade results
  - `followed_wallets`: Optional configuration
- **Purpose**: Coordinate between listener and executor

### 4. Jupiter Aggregator
- **Purpose**: Best swap routes across all Solana DEXs
- **APIs**:
  - `/quote` - Get swap quote
  - `/swap` - Build transaction
- **Features**: Auto slippage, multi-hop routing

## Safety Features

1. **Blacklist Check**
   - Before executing any buy
   - Skips blacklisted tokens
   - Configurable in .env

2. **Position Tracking**
   - Knows what tokens you own
   - Won't sell what you don't have
   - Updates after each trade

3. **Fixed Buy Amount**
   - Always $0.10 worth
   - Can't accidentally spend more
   - Protects from large trades

4. **Paper Trading Mode**
   - Test without real money
   - Logs what it would do
   - No blockchain transactions

5. **Error Handling**
   - Logs all errors
   - Continues running
   - Records failures in database

## File Structure

```
services/wallet-mirror/
├── src/
│   ├── wallet-watch-listener.ts    ← Terminal 1
│   ├── mirror-executor.ts          ← Terminal 2
│   ├── test-config.ts              ← Configuration test
│   └── index.ts                    ← Legacy
├── package.json                     ← Scripts & dependencies
├── start-listener.sh               ← Helper script
├── start-executor.sh               ← Helper script
├── MIRROR-README.md                ← Detailed docs
└── tsconfig.json                   ← TypeScript config
```

## Environment Variables

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `WATCH_ADDRESSES` | ✅ Yes | Wallets to mirror | `wallet1,wallet2` |
| `COPY_WALLET_SEED_PHRASE` | ⚠️ Live only | Your wallet | `twelve words...` |
| `ENABLE_LIVE_TRADING` | ✅ Yes | Paper/Live mode | `true` or `false` |
| `BLACKLIST_TOKENS` | ❌ No | Skip these tokens | `token1,token2` |
| `HELIUS_API_KEY` | ✅ Yes | Transaction parsing | `abc123...` |
| `HELIUS_RPC_URL` | ✅ Yes | RPC endpoint | `https://...` |
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection | `postgresql://...` |

## Commands

```bash
# Test configuration
npm run test-config

# Start listener (Terminal 1)
npm run listener

# Start executor (Terminal 2)
npm run executor

# Or use helper scripts
./start-listener.sh
./start-executor.sh
```

## Success Indicators

✅ Listener running:
```
✅ Database connected
✅ Listener is running. Checking every 2 minutes...
```

✅ Executor running:
```
✅ Database connected
💰 Wallet Balance: 0.1234 SOL
✅ Executor is running. Checking for new trades every 2 minutes...
```

✅ Trade detected:
```
🟢 BUY DETECTED
Token: BONK (DezXAZ8z7...)
Amount: 0.5000 SOL ↔ 15000.00 BONK
```

✅ Trade executed:
```
🎯 Processing BUY: BONK
💰 Buying 0.000500 SOL (~$0.10) worth of BONK
✅ BUY executed! Signature: 3Hj8x...
```

---

**Ready to start? Run the configuration test first:**

```bash
cd services/wallet-mirror
npm run test-config
```

Then start both terminals! 🚀

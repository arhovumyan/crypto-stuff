# Wallet Mirror Service

Continuously monitors specific wallet addresses and mirrors ALL their trades (both buys and sells) with a fixed 0.1 SOL amount.

## Features

- 🔄 **Continuous Mirroring**: Runs indefinitely, copying all trades
- 💰 **Fixed Amount**: Always trades 0.1 SOL on buys
- 📤 **Full Sells**: When leader sells, sells ALL your holdings of that token
- 👀 **Direct Monitoring**: Checks blockchain every 10 seconds
- 🚫 **Blacklist Support**: Respects BLACKLIST_TOKENS from .env
- 🔒 **Same Wallet**: Uses COPY_WALLET_SEED_PHRASE
- 📊 **Database Tracking**: Records all mirror attempts

## Difference from Other Services

| Service | Purpose | Buy Amount | Sell Strategy | Lifetime |
|---------|---------|------------|---------------|----------|
| **wallet-mirror** | Mirror all trades | 0.1 SOL | Sell ALL holdings | Continuous |
| copy-executor | Copy from database | 0.1 SOL or % | 100% of position | Continuous |
| 10DollarMonster | Snipe first trade | 10 SOL | No sells | One trade |

## Setup

1. **Install dependencies:**
```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/wallet-mirror
npm install
```

2. **Configuration** (uses project root `.env`):
```env
# Required - Comma-separated wallet addresses to monitor
WATCH_ADDRESSES=5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6,C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38

# Required - Your trading wallet
COPY_WALLET_SEED_PHRASE=your seed phrase here

# Required - Jupiter API
JUPITER_API_KEY=your-api-key-here

# Required - RPC
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-key

# Required - Database
DATABASE_URL=postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader

# Optional - Blacklist tokens to skip
BLACKLIST_TOKENS=token1,token2,token3

# Trading mode
ENABLE_LIVE_TRADING=false  # Set to 'true' for real trades
```

3. **Database** (auto-creates table on first run):
The service creates `wallet_mirror_trades` table to track all mirror attempts.

## Running

**Development mode:**
```bash
cd /Users/aro/Documents/Trading/CopyTrader/services/wallet-mirror
npm run dev
```

**Production:**
```bash
npm start
```

## How It Works

1. **Initialization**
   - Loads WATCH_ADDRESSES from .env (same as 10DollarMonster)
   - Initializes wallet from COPY_WALLET_SEED_PHRASE
   - Creates database table if needed

2. **Monitoring Loop** (every 10 seconds)
   - Fetches last 10 transactions for each watched wallet
   - Tracks last checked signature to avoid duplicates
   - Parses transactions to detect:
     - **BUY**: SOL decreased + token increased = SOL → Token
     - **SELL**: SOL increased + token decreased = Token → SOL

3. **Mirroring Logic**
   - **On BUY**: Swap 0.1 SOL → same token
   - **On SELL**: Swap ALL holdings → SOL
   - Checks blacklist before trading
   - Validates sufficient balance (0.15 SOL minimum)
   - Uses Jupiter Ultra API for swaps

4. **Database Recording**
   - Saves every mirror attempt (success/failed)
   - Tracks which leader wallet triggered it
   - Records both leader and our signatures

## Example Output

```
[20:30:15 UTC] INFO: WalletMirror initialized | tradeAmount: 0.1 SOL | watchAddresses: 2 | blacklistedTokens: 3
[20:30:16 UTC] INFO: Wallet ready | address: 9JmeM26hgsceGwtpxiM8RZndPF3jkMDQMUtmMyi8F7WM | balance: 2.3754 SOL
[20:30:16 UTC] INFO: Monitoring wallets | count: 2 | checkInterval: 10 seconds
[20:30:25 UTC] INFO: 🎯 Detected swap from monitored wallet | type: BUY | token: PEPE | tokenMint: abc123...
[20:30:26 UTC] INFO: Mirroring BUY | token: PEPE | amount: 0.1 SOL
[20:30:28 UTC] INFO: ✅ LIVE TRADE EXECUTED | type: BUY | token: PEPE | amount: 0.1 SOL | signature: xyz789...
[20:31:45 UTC] INFO: 🎯 Detected swap from monitored wallet | type: SELL | token: PEPE
[20:31:46 UTC] INFO: Mirroring SELL | token: PEPE | balance: 50000
[20:31:48 UTC] INFO: ✅ LIVE TRADE EXECUTED | type: SELL | token: PEPE | amount: ALL | signature: def456...
```

## Safety Features

- ✅ Blacklist support (won't trade blacklisted tokens)
- ✅ Balance checks (requires 0.15 SOL minimum)
- ✅ Paper trading mode (test without real trades)
- ✅ Database logging (audit trail of all trades)
- ✅ Graceful shutdown (CTRL+C stops cleanly)

## Monitoring Multiple Wallets

The service monitors ALL wallets in WATCH_ADDRESSES simultaneously. When ANY wallet makes a trade, it mirrors it immediately. No priority or selection needed.

## Database Query Examples

```sql
-- View all mirror trades
SELECT * FROM wallet_mirror_trades ORDER BY created_at DESC LIMIT 20;

-- Count successful trades
SELECT COUNT(*) FROM wallet_mirror_trades WHERE status = 'success';

-- Trades by specific wallet
SELECT * FROM wallet_mirror_trades 
WHERE leader_wallet = '5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6' 
ORDER BY created_at DESC;

-- Buys vs Sells
SELECT is_buy, COUNT(*), SUM(sol_amount) as total_sol
FROM wallet_mirror_trades 
WHERE status = 'success'
GROUP BY is_buy;
```

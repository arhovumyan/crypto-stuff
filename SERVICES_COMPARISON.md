# Service Comparison Guide

## Three Trading Services Overview

### 1. **wallet-mirror** (NEW - Continuous Mirroring)
**Purpose**: Mirror ALL trades from watched wallets with fixed 0.1 SOL amounts

**Key Features**:
- ✅ Monitors WATCH_ADDRESSES directly (blockchain polling)
- ✅ Copies BOTH buys AND sells
- ✅ Always buys 0.1 SOL worth
- ✅ Sells ALL holdings when leader sells
- ✅ Runs continuously (doesn't stop)
- ✅ 10-second check interval

**When to Use**: When you want to fully mirror a whale's trading activity with fixed risk per trade

**Configuration** (.env):
```env
WATCH_ADDRESSES=wallet1,wallet2  # Required
FIXED_BUY_AMOUNT_SOL=0.1        # Not used (hardcoded to 0.1)
ENABLE_LIVE_TRADING=false       # true for real trades
BLACKLIST_TOKENS=token1,token2  # Optional
```

**Run**:
```bash
cd services/wallet-mirror
npm run dev
```

---

### 2. **copy-executor** (Original Copy Trading)
**Purpose**: Copy trades from database (populated by listener service)

**Key Features**:
- ✅ Uses listener + database (not direct monitoring)
- ✅ Copies buys AND sells
- ✅ Configurable amount (0.1 SOL or percentage)
- ✅ Time-filtered (only copies trades <10 minutes old)
- ✅ Pump detection (skips tokens in uptrend)
- ✅ 5-second polling interval

**When to Use**: When you want database-backed copy trading with advanced filters

**Configuration** (.env):
```env
LEADER_WALLET_7=A42C7U1wT8BUoq27BE6kEYBtMaxtcsqq2fRX3kK1b6d6
FIXED_BUY_AMOUNT_SOL=0.1
COPY_PERCENTAGE=100
ENABLE_LIVE_TRADING=false
BLACKLIST_TOKENS=token1,token2
```

**Run** (requires listener running first):
```bash
# Terminal 1
cd services/listener
npm run dev

# Terminal 2
cd services/copy-executor
npm run dev
```

---

### 3. **10DollarMonster** (One-Shot Sniper)
**Purpose**: Buy first token any watched wallet touches, then shutdown

**Key Features**:
- ✅ Monitors WATCH_ADDRESSES directly
- ✅ Only buys (NO sells)
- ✅ Fixed 10 SOL amount
- ✅ Executes ONCE then shuts down
- ✅ Duplicate protection (won't buy same token twice)
- ✅ 60-second check interval

**When to Use**: When you want to snipe the FIRST trade from multiple whales

**Configuration** (.env):
```env
WATCH_ADDRESSES=wallet1,wallet2  # Required
ENABLE_LIVE_TRADING=false
```

**Run**:
```bash
cd services/10DollarMonster
npm run dev
```

---

## Quick Comparison Table

| Feature | wallet-mirror | copy-executor | 10DollarMonster |
|---------|--------------|---------------|-----------------|
| **Data Source** | Blockchain direct | Database/Listener | Blockchain direct |
| **Buy Amount** | 0.1 SOL (fixed) | 0.1 SOL or % | 10 SOL (fixed) |
| **Sells** | ✅ Yes (ALL holdings) | ✅ Yes (100%) | ❌ No |
| **Lifetime** | ♾️ Continuous | ♾️ Continuous | ⚡ One trade |
| **Check Interval** | 10 sec | 5 sec | 60 sec |
| **Pump Detection** | ❌ No | ✅ Yes | ❌ No |
| **Time Filter** | ❌ No | ✅ Yes (10 min) | ❌ No |
| **Wallet Config** | WATCH_ADDRESSES | LEADER_WALLET_X | WATCH_ADDRESSES |
| **Dependencies** | None | Needs listener | None |
| **Use Case** | Full mirroring | Smart copying | First-trade sniping |

---

## Configuration: WATCH_ADDRESSES vs LEADER_WALLET_X

### WATCH_ADDRESSES (for wallet-mirror & 10DollarMonster)
```env
# Comma-separated, direct blockchain monitoring
WATCH_ADDRESSES=5XvRrfXa7SYxc9NKpRojTKuqRTEaQgE76Xp7WEHtDmK6,C2gngYLHSAQHmmfU3RnTmgb9eoDX7SJcpCpACkDpa38
```

### LEADER_WALLET_X (for listener + copy-executor)
```env
# Separate variables, stored in database
LEADER_WALLET_1=BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM
LEADER_WALLET_2=5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG
LEADER_WALLET_7=A42C7U1wT8BUoq27BE6kEYBtMaxtcsqq2fRX3kK1b6d6
```

---

## Recommended Workflow

### For Full Mirroring (Most Common)
Use **wallet-mirror** for simple, direct mirroring:
```bash
cd services/wallet-mirror
npm run dev
```

### For Smart Copy Trading
Use **listener + copy-executor** for filtered copying:
```bash
# Terminal 1
cd services/listener && npm run dev

# Terminal 2
cd services/copy-executor && npm run dev
```

### For Sniper Trading
Use **10DollarMonster** to catch first trades only:
```bash
cd services/10DollarMonster
npm run dev
```

---

## All Services Use Same Wallet

All three services use **COPY_WALLET_SEED_PHRASE** from .env:
```env
COPY_WALLET_SEED_PHRASE=your twelve word seed phrase here...
```

Current wallet: `9JmeM26hgsceGwtpxiM8RZndPF3jkMDQMUtmMyi8F7WM`

# 📁 Project Structure

```
CopyTrader/
│
├── 📋 Configuration Files
│   ├── package.json              # Root dependencies & workspace config
│   ├── tsconfig.json             # TypeScript configuration
│   ├── docker-compose.yml        # PostgreSQL + Redis containers
│   ├── .env                      # Your configuration (5 wallets + settings)
│   ├── .env.example              # Template for new setups
│   ├── .gitignore                # Git ignore rules
│   ├── README.md                 # Technical documentation
│   └── GETTING_STARTED.md        # Step-by-step setup guide ⭐
│
├── 📦 packages/
│   └── shared/                   # Shared utilities package
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── config.ts         # Environment validation (Zod)
│           ├── logger.ts         # Pino structured logging
│           ├── types.ts          # TypeScript interfaces
│           ├── database.ts       # PostgreSQL connection pool
│           ├── redis.ts          # Redis client + helpers
│           └── index.ts          # Package exports
│
├── 🎧 services/
│   └── listener/                 # Phase 1: Transaction listener
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── websocket-manager.ts     # Helius WebSocket w/ reconnection
│           ├── transaction-parser.ts    # Parse txs & compute token deltas
│           ├── trade-recorder.ts        # Save trades to PostgreSQL
│           ├── listener-service.ts      # Main orchestrator
│           └── index.ts                 # Entry point (npm run dev)
│
├── 🗄️ database/
│   └── schema.sql                # PostgreSQL schema
│       ├── followed_wallets      # Your 5 leader wallets
│       ├── leader_trades         # Detected swaps
│       ├── copy_attempts         # (Phase 3) Your copy trades
│       ├── positions             # (Phase 3) Token holdings
│       └── risk_events           # (Phase 2+) Risk triggers
│
└── 📊 Future (Phase 2 & 3)
    ├── services/risk-engine/     # Token safety, limits, scoring
    ├── services/executor/        # Jupiter integration, trade execution
    └── services/api/             # Optional dashboard API
```

---

## 🔑 Key Files to Know

### **Configuration**
- **`.env`** - Your API keys and wallet addresses (EDIT THIS!)
- **`GETTING_STARTED.md`** - Read this first! ⭐

### **Core Logic**
- **`services/listener/src/transaction-parser.ts`**
  - 💡 Delta-based detection (the magic)
  - Works across ALL DEXs

- **`services/listener/src/websocket-manager.ts`**
  - Real-time WebSocket connection
  - Auto-reconnection logic

- **`packages/shared/src/config.ts`**
  - Environment validation
  - Safe configuration loading

### **Database**
- **`database/schema.sql`**
  - All table definitions
  - Your 5 wallets pre-seeded

---

## 📦 What's Installed

### Dependencies (in node_modules)
```
@solana/web3.js      # Solana blockchain SDK
pg                   # PostgreSQL client
redis                # Redis client
pino                 # Fast structured logger
pino-pretty          # Pretty logs for development
zod                  # Schema validation
dotenv               # Environment variables
ws                   # WebSocket client
axios                # HTTP client (for Jupiter later)
```

### Dev Dependencies
```
typescript           # TypeScript compiler
tsx                  # TypeScript executor
@types/*             # TypeScript type definitions
eslint               # Code linter
vitest               # Testing framework (Phase 2)
```

---

## 🎯 How Data Flows

### 1. WebSocket Subscription
```typescript
// websocket-manager.ts subscribes to each wallet
logsSubscribe({ mentions: [walletAddress] })
```

### 2. Transaction Detection
```typescript
// listener-service.ts receives notifications
logsNotification → signature detected
```

### 3. Parse & Compute Deltas
```typescript
// transaction-parser.ts
1. Fetch full parsed transaction
2. Compare pre/post token balances
3. Calculate deltas (what changed)
4. Classify: is it a swap?
```

### 4. Save to Database
```typescript
// trade-recorder.ts
INSERT INTO leader_trades (
  signature,
  token_in,
  token_out,
  amounts...
)
```

### 5. Idempotency Check
```typescript
// redis.ts
Key: processed:{signature}
→ Prevents duplicate processing
```

---

## 🧪 Testing the System

### Manual Test
```bash
# Terminal 1: Run the listener
npm run dev

# Terminal 2: Query database
docker exec -it copytrader-postgres psql -U copytrader -d copytrader
SELECT COUNT(*) FROM leader_trades;
```

### Check Logs
```bash
# Logs show:
✅ Connected events
📨 New transactions
🔄 Detected swaps
💾 Database saves
```

---

## 🛠️ Development Workflow

### Making Changes
```bash
# Edit files in services/listener/src/
# tsx watch automatically reloads

# Or manually rebuild
npm run build
npm run dev
```

### Database Queries
```bash
# View recent trades
docker exec -it copytrader-postgres psql -U copytrader -d copytrader

SELECT 
  leader_wallet,
  token_in_symbol,
  amount_in,
  token_out_symbol,
  amount_out,
  detected_at
FROM leader_trades
ORDER BY detected_at DESC
LIMIT 5;
```

### Redis Inspection
```bash
docker exec -it copytrader-redis redis-cli

# See processed transaction keys
KEYS processed:*

# Check a specific one
GET processed:5XyZ1234abcd...
```

---

## 🚀 Phase Progression

### ✅ Phase 1 (Current)
- Detect trades
- Store in database
- No execution

### 🔜 Phase 2 (Next)
**Add to `services/`:**
- `risk-engine/` - Token safety checks
- `paper-trader/` - Simulate trades
- Jupiter API integration

### 🔜 Phase 3 (Later)
**Add to `services/`:**
- `executor/` - Real trade execution
- Wallet key management
- Jito priority fees

---

## 📝 Environment Variables

### Required Now (Phase 1)
```bash
HELIUS_API_KEY         # Get from helius.dev
HELIUS_RPC_URL         # Mainnet RPC endpoint
HELIUS_WS_URL          # WebSocket endpoint
DATABASE_URL           # Postgres connection
REDIS_URL              # Redis connection
LEADER_WALLET_1-5      # ✅ Already configured!
```

### Optional Now
```bash
LOG_LEVEL              # info, debug, warn, error
NODE_ENV               # development, production
```

### Needed Later (Phase 3)
```bash
ENCRYPTED_PRIVATE_KEY  # Your trading wallet key
MAX_TRADE_SIZE_USD     # $25 default
MAX_DAILY_LOSS_USD     # $100 default
```

---

## 🎨 Code Style

### TypeScript
- Strict mode enabled
- Full type safety
- No `any` types

### Error Handling
- Try/catch everywhere
- Structured logging
- Graceful degradation

### Async/Await
- No callbacks
- Clean promise chains
- Proper error propagation

---

## 💾 Database Schema Highlights

```sql
-- Idempotency
signature TEXT UNIQUE NOT NULL

-- Timestamps
detected_at TIMESTAMPTZ DEFAULT NOW()

-- JSONB for flexibility
raw_transaction JSONB
config JSONB

-- Indexes for performance
CREATE INDEX idx_leader_trades_detected_at ON leader_trades(detected_at DESC);
```

---

## 🔒 Security Notes

### Phase 1 (Current)
- ✅ No private keys needed
- ✅ Read-only operations
- ✅ Local database only

### Phase 3 (Future)
- Encrypted key storage
- Environment-based secrets
- Optional: AWS KMS, Vault

---

## 📚 Additional Resources

- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)
- [Helius API Docs](https://docs.helius.dev/)
- [Jupiter API Docs](https://station.jup.ag/docs/apis/swap-api) (Phase 2)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)

---

**Ready to run?** → See [GETTING_STARTED.md](./GETTING_STARTED.md)

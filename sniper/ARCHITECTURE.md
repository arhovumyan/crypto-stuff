# 🏗️ Sniper Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SNIPER BOT (Main)                       │
│  - Orchestrates all components                             │
│  - Manages lifecycle and shutdown                          │
│  - Coordinates processing pipeline                         │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    TOKEN     │    │     GATE     │    │  EXECUTION   │
│   MONITOR    │───▶│  VALIDATOR   │───▶│    ENGINE    │
│              │    │              │    │              │
│ - Detects    │    │ - 8 Gates    │    │ - Jupiter    │
│   launches   │    │ - Strict     │    │ - Jito       │
│ - WebSocket  │    │   filtering  │    │ - Priority   │
│ - Real-time  │    │ - Round-trip │    │   fees       │
└──────────────┘    └──────────────┘    └──────────────┘
                                                │
                                                ▼
                                        ┌──────────────┐
                                        │   POSITION   │
                                        │   MANAGER    │
                                        │              │
                                        │ - Multi-TP   │
                                        │ - Trailing   │
                                        │ - Stops      │
                                        └──────────────┘
                                                │
                                                ▼
                                        ┌──────────────┐
                                        │    STATS     │
                                        │   TRACKER    │
                                        │              │
                                        │ - Metrics    │
                                        │ - Reporting  │
                                        └──────────────┘
```

## Component Details

### 1. Token Monitor (`token-monitor.ts`)

**Purpose**: Detect new token launches in real-time

**Key Features**:
- WebSocket connection to Helius
- Monitors DEX program logs (Raydium, Orca, Pump.fun)
- Extracts pool initialization events
- Tracks early swap activity
- Calculates swap statistics

**Data Flow**:
```
WebSocket Event → Parse Transaction → Extract Pool Info → Store Launch
                                                              ↓
                                                    Track Early Swaps
```

**Key Methods**:
- `start()`: Begin monitoring
- `processNewPool()`: Handle new pool detection
- `recordSwap()`: Track swap events
- `getEarlySwapStats()`: Calculate organic flow metrics

### 2. Gate Validator (`gate-validator.ts`)

**Purpose**: Filter launches through 8 strict validation gates

**Gate Pipeline**:
```
Launch → [A: Liquidity] → [B: Mint Auth] → [C: Freeze Auth] → [D: Route]
           ↓ Pass              ↓ Pass          ↓ Pass          ↓ Pass
      [E: Round-trip] → [F: Early Flow] → [G: Holders] → [H: Hygiene]
           ↓ Pass              ↓ Pass          ↓ Pass          ↓ Info
       ✅ APPROVED
```

**Gate Details**:

| Gate | Check | Threshold | Rejects |
|------|-------|-----------|---------|
| A | SOL Liquidity | ≥75 SOL | Low liquidity rugs |
| B | Mint Authority | Must be null | Infinite mint |
| C | Freeze Authority | Must be null | Token freezing |
| D | Route Quality | ≤2 hops, ≤6% impact | Bad pricing |
| E | Round-trip | ≤8% loss | Sell blocks |
| F | Organic Flow | 10 swaps, 7 wallets | Bot manipulation |
| G | Holder Distribution | Top holders limits | Concentrated supply |
| H | Launch Source | Known DEX | Unknown sources |

**Critical Gate: E (Round-Trip)**
```typescript
// Most important gate - catches sell blocks
1. Simulate: SOL → Token (buy)
2. Get token amount received
3. Simulate: Token → SOL (sell)
4. Calculate loss percentage
5. Reject if loss > 8%
```

### 3. Execution Engine (`execution-engine.ts`)

**Purpose**: Execute trades with optimal parameters

**Features**:
- Jupiter swap integration
- Priority fee management
- Jito bundle support (MEV protection)
- Retry logic with exponential backoff
- Emergency sell capability

**Priority Fee Levels**:
```typescript
{
  low:      1,000 microlamports
  medium:  10,000 microlamports
  high:    50,000 microlamports
  veryHigh: 100,000 microlamports
}
```

**Execution Flow**:
```
Get Quote → Build Transaction → Add Priority Fees → Sign
    ↓
Send via Jito Bundle (if enabled) OR Standard RPC
    ↓
Confirm → Return Result
```

### 4. Position Manager (`position-manager.ts`)

**Purpose**: Track positions and execute exit strategy

**Position Lifecycle**:
```
Entry (Buy) → Monitor Price → Check Conditions → Execute Exits
                    ↓
              Update Stats
              Track High
              Calculate PnL
```

**Exit Conditions** (checked every 2 seconds):

1. **Stop Loss**: Price down 20%
2. **Time Stop**: 3 minutes elapsed + not up 15%
3. **Take Profit 1**: Up 40% → Sell 40%
4. **Take Profit 2**: Up 80% → Sell 30%
5. **Trailing Stop**: After both TPs, 15% trail on remaining 30%

**Exit Logic**:
```typescript
if (gainPct <= -20%) → Exit 100% (stop loss)
if (elapsed >= 3min && gain < 15%) → Exit 100% (time stop)
if (gainPct >= 40% && !tp1Hit) → Exit 40% (TP1)
if (gainPct >= 80% && !tp2Hit) → Exit 30% (TP2)
if (trailing >= 15% && tpsHit) → Exit 100% (trailing)
```

### 5. Sniper Stats (`sniper-stats.ts`)

**Purpose**: Track performance metrics and generate reports

**Metrics Tracked**:
- Launches detected
- Gate rejections (by gate)
- Trades executed (buy/sell)
- Positions (active/closed)
- Win/loss ratio
- Total PnL
- Touch rate (% of launches traded)

**Reports**:
```
Every 5 minutes:
  - Performance summary
  - Gate rejection breakdown
  - Current positions
  - PnL tracking
```

### 6. Sniper Bot (`sniper-bot.ts`)

**Purpose**: Main orchestrator, ties everything together

**Initialization Sequence**:
```
1. Load configuration from env
2. Print banner and config
3. Initialize wallet from seed
4. Check SOL balance
5. Start token monitor
6. Start main processing loop
7. Start position monitoring
8. Start stats reporting
```

**Main Loop**:
```typescript
while (running) {
  // Get new launches
  const tokens = monitor.getAllTokens()
  
  for each token:
    if (already processed) continue
    if (max positions reached) continue
    
    // Run validation
    const result = validator.validate(token)
    
    if (failed):
      log rejection reason
      stats.recordRejection()
      continue
    
    // Execute trade
    const trade = executor.executeBuy(token)
    
    if (success):
      positionManager.openPosition()
      stats.recordTrade()
}
```

## Data Structures

### TokenLaunch
```typescript
{
  mint: string              // Token address
  poolAddress?: string      // DEX pool
  liquiditySOL: number      // SOL in pool
  timestamp: number         // When detected
  slot: number             // Blockchain slot
  signature: string        // Transaction sig
  firstSwapTime?: number   // First trade time
}
```

### Position
```typescript
{
  tokenMint: string
  entryPrice: number        // SOL per token
  currentPrice: number
  totalTokens: number
  remainingTokens: number
  investedSOL: number
  currentValueSOL: number
  unrealizedPnL: number
  unrealizedPnLPct: number
  takeProfitsHit: Set<number>
  highestPrice: number      // For trailing
  isActive: boolean
}
```

### GateResult
```typescript
{
  passed: boolean
  gate: string             // A-H
  reason?: string          // Why failed
  data?: any              // Gate-specific data
}
```

## Configuration System

### Environment Variables → Config Objects

```
.env file
    ↓
loadConfig()
    ↓
SniperConfig {
  gates: GateConfig
  execution: ExecutionConfig
  positions: PositionConfig
}
    ↓
Pass to components
```

### Configuration Hierarchy

```
High Level: SniperConfig
    ├── RPC settings
    ├── Trading settings
    │
    ├── GateConfig
    │   ├── Liquidity thresholds
    │   ├── Route constraints
    │   ├── Flow requirements
    │   └── Holder limits
    │
    ├── ExecutionConfig
    │   ├── Jito settings
    │   ├── Priority fees
    │   └── Retry logic
    │
    └── PositionConfig
        ├── Take profit levels
        ├── Stop losses
        └── Time stops
```

## Error Handling

### Levels of Errors

1. **Critical** (shutdown):
   - Missing wallet seed
   - Invalid configuration
   - RPC connection failure

2. **Warning** (log and continue):
   - Gate validation failures
   - Quote fetch failures
   - Balance warnings

3. **Recoverable** (retry):
   - Transaction send failures
   - WebSocket disconnections
   - Temporary RPC errors

### Error Flow

```
Error occurs
    ↓
Is it critical? ─Yes→ Log and shutdown
    │
    No
    ↓
Is it recoverable? ─Yes→ Retry with backoff
    │
    No
    ↓
Log warning and continue
```

## Performance Considerations

### Bottlenecks

1. **RPC Calls**: Gate validation makes multiple RPC calls
   - Mitigation: Use fast RPC (Helius/QuickNode)
   - Future: Cache token metadata

2. **Quote Fetching**: Jupiter API calls for each token
   - Mitigation: Timeout at 10s
   - Skip if API is slow

3. **WebSocket**: May miss events under high load
   - Mitigation: Use Helius enhanced transactions
   - Future: Geyser plugin

### Optimization Strategies

- Parallel gate checks where possible
- Cache mint/freeze authority lookups
- Batch position updates
- Lazy load expensive checks (holder data)

## Security

### Private Key Handling
```
Seed phrase in .env → Never logged
    ↓
Derived in memory only
    ↓
Used for signing → Immediately discarded
```

### Transaction Security
- Priority fees prevent frontrunning
- Jito bundles hide from public mempool
- Slippage protection prevents sandwich attacks
- Round-trip simulation catches scams

## Monitoring & Debugging

### Log Levels
```
ERROR:   Critical failures
WARN:    Rejected launches, failed trades
INFO:    Normal operation, gate passes, trades
DEBUG:   Detailed internal state (if enabled)
```

### Key Metrics to Watch
- **Touch Rate**: Should be 1-5% (very strict)
- **Gate E Rejects**: Should be 30-50% (catching scams)
- **Win Rate**: Target 60-70%
- **Average Hold Time**: 3-10 minutes

## Extending the System

### Adding a New Gate
```typescript
1. Add to GateConfig interface
2. Create private gateX_Name() method
3. Add to validate() pipeline
4. Update rejection stats
5. Document threshold in README
```

### Adding a New DEX
```typescript
1. Add program ID to token-monitor
2. Create parser for DEX-specific pools
3. Test pool extraction
4. Add to launch source hygiene
```

### Custom Exit Strategy
```typescript
1. Add to PositionConfig
2. Implement in checkExitConditions()
3. Add exit reason tracking
4. Update stats reporting
```

## Testing Strategy

### Unit Tests (TODO)
- Gate validation logic
- Position PnL calculations
- Exit condition triggers
- Config parsing

### Integration Tests (TODO)
- Jupiter API mocking
- RPC response simulation
- Full pipeline with test data

### Manual Testing
1. Paper trade for 24+ hours
2. Review all gate rejections
3. Verify exit triggers
4. Check stats accuracy
5. Test graceful shutdown

## Deployment Checklist

- [ ] `.env` configured with real values
- [ ] Wallet funded with SOL
- [ ] Paper trading tested (24h minimum)
- [ ] Gate thresholds validated
- [ ] Exit strategy confirmed
- [ ] Monitoring setup
- [ ] Backup plan for failures

---

**Last Updated**: December 2024
**Version**: 1.0.0

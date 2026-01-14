Technical Deep-Dive: Solana Dip-Buying System Architecture
I'm going to architect this system with production-grade precision. This will be exhaustive.

I. CORE TECHNOLOGY STACK
Runtime & Language

Primary Language: Rust

Zero-cost abstractions for performance-critical paths
Memory safety without garbage collection pauses
Fearless concurrency with tokio async runtime
Native Solana SDK support (solana-client, solana-sdk, anchor-lang)


Alternative (Faster MVP): TypeScript with Bun runtime

Bun for near-native performance (faster than Node by 3-4x on I/O)
@solana/web3.js and @coral-xyz/anchor for Solana interaction
Trade-off: slower than Rust but 10x faster iteration during development



Recommendation: Start with TypeScript/Bun for the MVP to validate signal logic quickly, then rewrite hot paths (MarketData, SignalEngine) in Rust once proven. Use Rust's FFI to create hybrid architecture if needed.
WebSocket Infrastructure

Solana RPC WebSocket Providers:

Primary: Helius (dedicated WebSocket endpoints, 1000 req/s on paid tiers)
Failover 1: Triton RPC (low-latency Solana RPC with WebSocket support)
Failover 2: QuickNode (multi-region presence)
Local: Self-hosted Solana validator (Geyser plugin for account streaming)


WebSocket Client Libraries:

Rust: tokio-tungstenite with automatic reconnection wrapper
TypeScript: ws library with custom reconnection logic and exponential backoff


Connection Architecture:

Subscription Connection: Dedicated persistent WebSocket for account subscriptions
Transaction Connection: Separate WebSocket for transaction confirmation tracking
Health Check: Ping/pong every 30s, reconnect on 3 consecutive failures
Backpressure Handling: If message queue depth exceeds threshold, trigger circuit breaker



Database Layer

Development/MVP: SQLite with WAL mode

Single-file simplicity
ACID guarantees
50k+ inserts/sec with proper indexing


Production: PostgreSQL 16+ with TimescaleDB extension

TimescaleDB for time-series market data (automatic partitioning)
Connection pooling via PgBouncer (transaction mode, 100 connections)
Write-ahead log (WAL) tuning for low-latency commits
Separate read replicas for analytics queries


Schema Design:

sql-- Market snapshots (hypertable in TimescaleDB)
CREATE TABLE market_snapshots (
    time TIMESTAMPTZ NOT NULL,
    market_id TEXT NOT NULL,
    price NUMERIC(20,10),
    base_reserve BIGINT,
    quote_reserve BIGINT,
    liquidity_estimate NUMERIC(20,10),
    volume_proxy NUMERIC(20,10),
    PRIMARY KEY (time, market_id)
);

-- Trade intents
CREATE TABLE trade_intents (
    intent_id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    market_id TEXT NOT NULL,
    side TEXT NOT NULL,
    size_sol NUMERIC(20,10),
    reference_price NUMERIC(20,10),
    current_price NUMERIC(20,10),
    price_drop_pct NUMERIC(5,2),
    liquidity NUMERIC(20,10),
    estimated_slippage NUMERIC(5,2),
    reason_codes JSONB,
    risk_decision TEXT, -- APPROVED, REJECTED
    rejection_reason TEXT
);

-- Positions (state machine)
CREATE TABLE positions (
    position_id UUID PRIMARY KEY,
    intent_id UUID REFERENCES trade_intents(intent_id),
    market_id TEXT NOT NULL,
    state TEXT NOT NULL, -- PENDING_OPEN, OPEN, PENDING_CLOSE, CLOSED, FAILED
    entry_tx_sig TEXT,
    entry_price NUMERIC(20,10),
    entry_amount NUMERIC(20,10),
    entry_time TIMESTAMPTZ,
    exit_tx_sig TEXT,
    exit_price NUMERIC(20,10),
    exit_time TIMESTAMPTZ,
    realized_pnl_sol NUMERIC(20,10),
    exit_reason TEXT, -- TAKE_PROFIT, STOP_LOSS, TIME_STOP
    metadata JSONB
);
```

### **Message Queue (Internal)**
- **For MVP:** In-memory bounded channels
  - Rust: `tokio::sync::mpsc` with capacity limits
  - TypeScript: Custom `AsyncQueue` class with backpressure
  
- **For Scale:** Redis Streams
  - Persistent message buffer between modules
  - Consumer groups for horizontal scaling
  - TTL on messages to prevent memory bloat

### **Observability Stack**
- **Logging:** Structured JSON logs
  - Rust: `tracing` + `tracing-subscriber` with JSON formatter
  - TypeScript: `pino` (fastest Node.js logger)
  - Fields: `timestamp`, `level`, `module`, `market_id`, `intent_id`, `position_id`, `latency_ms`
  
- **Metrics:** Prometheus + Grafana
  - Custom metrics:
    - `market_data_lag_ms` (per market)
    - `signal_triggers_total` (counter)
    - `risk_rejections_total` (counter by reason)
    - `execution_latency_ms` (histogram: quote → confirm)
    - `position_pnl_sol` (gauge per position)
    - `rpc_errors_total` (counter by provider)
  
- **Alerting:** Grafana alerts → PagerDuty/Discord webhook
  - Market data stale > 5s
  - Execution failure rate > 10%
  - Daily loss exceeds threshold

---

## **II. SYSTEM ARCHITECTURE**

### **Module Breakdown**
```
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY LAYER                      │
│         (Structured Logs, Metrics, Traces, Alerts)          │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────┐
│                      MAIN ORCHESTRATOR                       │
│  - Lifecycle management (startup, shutdown, graceful stop)  │
│  - Module initialization & health monitoring                │
│  - Global state coordination                                │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  MARKET DATA │ │    SIGNAL    │ │     RISK     │ │  EXECUTION   │
│    MODULE    │ │    ENGINE    │ │   MANAGER    │ │    ENGINE    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
         │              │              │              │
         └──────────────┴──────────────┴──────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │ POSITION TRACKER │
                   └──────────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │   PERSISTENCE    │
                   │  (SQLite/Postgres)│
                   └──────────────────┘
Data Flow

MarketData streams account updates → updates rolling windows → emits MarketUpdate events
SignalEngine consumes MarketUpdate → evaluates dip conditions → emits TradeIntent
RiskManager consumes TradeIntent → applies risk rules → emits ApprovedIntent or RejectedIntent
ExecutionEngine consumes ApprovedIntent → quotes, simulates, submits → emits FillEvent or ExecutionFailure
PositionTracker consumes FillEvent → updates position state machine → monitors exit conditions → emits ExitIntent
ExitIntent flows through RiskManager → ExecutionEngine (same as entry)


III. MODULE IMPLEMENTATION DETAILS
A. MarketData Module
Responsibilities:

Subscribe to on-chain pool account state
Derive spot price from reserves in real-time
Maintain rolling 60-second window of price/liquidity/volume
Detect data staleness and subscription failures
Emit market update events

Technical Design:
1. Account Subscription Strategy
For Raydium CLMM, Orca Whirlpool, or generic AMMs:
typescript// Accounts to monitor per market
interface MarketAccounts {
  poolAddress: PublicKey;
  baseVault: PublicKey;    // Token A vault
  quoteVault: PublicKey;   // Token B vault (usually SOL/USDC)
  poolState: PublicKey;    // Pool configuration account
}

// Subscribe using accountSubscribe WebSocket method
connection.onAccountChange(
  baseVault,
  (accountInfo, context) => {
    const baseReserve = parseTokenAccount(accountInfo.data);
    handleReserveUpdate('base', baseReserve, context.slot);
  },
  'confirmed' // commitment level
);
For Pump.fun bonding curve (more specific):
rust// Pump uses a bonding curve, not traditional AMM
// Account structure (simplified):
pub struct BondingCurve {
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,
    // ... other fields
}

// Price = virtual_sol_reserves / virtual_token_reserves
// Subscribe to the bonding curve account directly
2. Rolling Window Implementation
rustuse std::collections::VecDeque;

struct PriceWindow {
    capacity: usize,
    data: VecDeque<PricePoint>,
}

#[derive(Clone)]
struct PricePoint {
    timestamp: i64,        // Unix timestamp in microseconds
    price: f64,
    base_reserve: u64,
    quote_reserve: u64,
    slot: u64,             // Solana slot number for ordering
}

impl PriceWindow {
    fn push(&mut self, point: PricePoint) {
        // Maintain time-ordered window
        if self.data.len() >= self.capacity {
            self.data.pop_front();
        }
        self.data.push_back(point);
    }
    
    fn get_reference_price(&self) -> Option<f64> {
        // Get price from 60s ago, or oldest available
        let now = current_timestamp_micros();
        let cutoff = now - 60_000_000; // 60 seconds
        
        self.data.iter()
            .find(|p| p.timestamp <= cutoff)
            .or_else(|| self.data.front())
            .map(|p| p.price)
    }
    
    fn current_price(&self) -> Option<f64> {
        self.data.back().map(|p| p.price)
    }
    
    fn compute_volatility(&self) -> f64 {
        // Standard deviation of price changes
        if self.data.len() < 2 { return 0.0; }
        
        let returns: Vec<f64> = self.data.windows(2)
            .map(|w| (w[1].price / w[0].price).ln())
            .collect();
            
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance = returns.iter()
            .map(|r| (r - mean).powi(2))
            .sum::<f64>() / returns.len() as f64;
            
        variance.sqrt()
    }
}
3. Staleness Detection
ruststruct MarketHealth {
    last_update: Instant,
    consecutive_failures: u32,
    is_healthy: bool,
}

impl MarketHealth {
    fn check(&mut self) -> bool {
        let staleness = self.last_update.elapsed();
        
        if staleness > Duration::from_secs(5) {
            warn!("Market data stale: {:?}", staleness);
            self.is_healthy = false;
            return false;
        }
        
        self.is_healthy = true;
        true
    }
    
    fn record_failure(&mut self) {
        self.consecutive_failures += 1;
        if self.consecutive_failures > 3 {
            error!("Too many consecutive failures, circuit breaking");
            self.is_healthy = false;
        }
    }
}
4. WebSocket Reconnection Logic
typescriptclass RobustWebSocketSubscriber {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseBackoffMs = 1000;
  
  async connect() {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        this.ws = new WebSocket(this.rpcUrl);
        
        this.ws.on('open', () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.resubscribeAll(); // Re-subscribe to all accounts
        });
        
        this.ws.on('close', () => {
          this.handleDisconnect();
        });
        
        this.ws.on('error', (err) => {
          console.error('WebSocket error:', err);
        });
        
        break;
      } catch (err) {
        const backoff = Math.min(
          this.baseBackoffMs * Math.pow(2, this.reconnectAttempts),
          30000 // max 30s
        );
        
        console.log(`Reconnect attempt ${this.reconnectAttempts + 1}, waiting ${backoff}ms`);
        await sleep(backoff);
        this.reconnectAttempts++;
      }
    }
  }
  
  private handleDisconnect() {
    console.warn('WebSocket disconnected, reconnecting...');
    setTimeout(() => this.connect(), 1000);
  }
}
Performance Optimizations:

Use confirmed commitment for subscriptions (balance between latency and finality)
Batch multiple account subscriptions in single WebSocket connection
Pre-allocate rolling window capacity to avoid reallocations
Use lock-free data structures for concurrent reads (e.g., Arc<RwLock<PriceWindow>> in Rust)
Implement circular buffer to avoid shifting operations


B. SignalEngine Module
Responsibilities:

Consume market updates
Detect dip conditions with multi-gate validation
Compute order size dynamically
Emit trade intents with full context

Technical Design:
1. Dip Detection Logic
ruststruct DipDetector {
    threshold_pct: f64,          // e.g., 5.0 for 5%
    min_liquidity_sol: f64,      // Minimum pool depth
    max_slippage_pct: f64,       // Maximum acceptable slippage
    min_volume_proxy: f64,       // Minimum recent activity
    cooldown_duration: Duration, // Time since last trade in this market
    last_trade_time: HashMap<String, Instant>,
}

impl DipDetector {
    fn evaluate(&mut self, market: &MarketUpdate) -> Option<TradeIntent> {
        // Gate 1: Check cooldown
        if let Some(last_trade) = self.last_trade_time.get(&market.id) {
            if last_trade.elapsed() < self.cooldown_duration {
                return None; // Too soon since last trade
            }
        }
        
        // Gate 2: Price drop threshold
        let reference_price = market.window.get_reference_price()?;
        let current_price = market.window.current_price()?;
        let drop_pct = ((reference_price - current_price) / reference_price) * 100.0;
        
        if drop_pct < self.threshold_pct {
            return None; // Not a big enough dip
        }
        
        // Gate 3: Liquidity check
        let liquidity_sol = market.compute_liquidity_sol();
        if liquidity_sol < self.min_liquidity_sol {
            warn!("Insufficient liquidity: {}", liquidity_sol);
            return None;
        }
        
        // Gate 4: Slippage estimation
        let intended_size_sol = self.compute_order_size(liquidity_sol);
        let estimated_slippage = self.estimate_slippage(
            current_price,
            intended_size_sol,
            market.base_reserve,
            market.quote_reserve
        );
        
        if estimated_slippage > self.max_slippage_pct {
            warn!("Slippage too high: {}%", estimated_slippage);
            return None;
        }
        
        // Gate 5: Volume proxy (avoid dead pools)
        let volume_proxy = market.compute_volume_proxy();
        if volume_proxy < self.min_volume_proxy {
            return None;
        }
        
        // All gates passed, create intent
        Some(TradeIntent {
            intent_id: Uuid::new_v4(),
            timestamp: Utc::now(),
            market_id: market.id.clone(),
            side: Side::Buy,
            size_sol: intended_size_sol,
            reference_price,
            current_price,
            drop_pct,
            liquidity_sol,
            estimated_slippage,
            reason_codes: vec![
                "PRICE_DROP_THRESHOLD_MET",
                "LIQUIDITY_SUFFICIENT",
                "SLIPPAGE_ACCEPTABLE",
            ],
        })
    }
    
    fn estimate_slippage(
        &self,
        price: f64,
        size_sol: f64,
        base_reserve: u64,
        quote_reserve: u64
    ) -> f64 {
        // Constant product formula: x * y = k
        // After swap: (x + dx) * (y - dy) = k
        // dy = y - k / (x + dx)
        // Price impact = (dy / dx - price) / price * 100
        
        let k = (base_reserve as f64) * (quote_reserve as f64);
        let dx = size_sol;
        let dy = (quote_reserve as f64) - k / ((quote_reserve as f64) + dx);
        let effective_price = dy / dx;
        
        ((effective_price - price) / price * 100.0).abs()
    }
    
    fn compute_order_size(&self, liquidity_sol: f64) -> f64 {
        // Dynamic sizing: use 1% of pool liquidity, capped at max
        const MAX_SIZE_SOL: f64 = 5.0;
        const POOL_SIZE_PCT: f64 = 0.01;
        
        (liquidity_sol * POOL_SIZE_PCT).min(MAX_SIZE_SOL)
    }
}
2. Volume Proxy Calculation
Since we're not tracking every swap event (too expensive), we approximate recent volume:
rustimpl MarketUpdate {
    fn compute_volume_proxy(&self) -> f64 {
        // Sum absolute reserve changes over window
        if self.window.data.len() < 2 {
            return 0.0;
        }
        
        self.window.data.windows(2)
            .map(|w| {
                let base_change = (w[1].base_reserve as i64 - w[0].base_reserve as i64).abs();
                let quote_change = (w[1].quote_reserve as i64 - w[0].quote_reserve as i64).abs();
                
                // Convert to SOL equivalent using current price
                (base_change as f64 * w[1].price + quote_change as f64) / 1e9
            })
            .sum()
    }
}
Performance Optimizations:

Cache slippage calculations for similar order sizes
Use SIMD for rolling window statistics where possible
Pre-filter markets with insufficient liquidity before full evaluation
Implement early exit in gate checks (fail-fast)


C. RiskManager Module
Responsibilities:

Enforce position limits
Enforce loss limits
Validate system health before approving trades
Implement circuit breakers
Log all decisions with full reasoning
Technical Design:
ruststruct RiskManager {
    config: RiskConfig,
    state: RiskState,
    db: Database,
}

struct RiskConfig {
    max_sol_per_trade: f64,
    max_concurrent_positions: usize,
    max_exposure_per_token: f64,
    max_daily_loss_sol: f64,
    max_hourly_trades: usize,
}

struct RiskState {
    open_positions: HashMap<String, Position>,
    daily_pnl_sol: f64,
    daily_pnl_reset_time: DateTime<Utc>,
    hourly_trade_count: VecDeque<DateTime<Utc>>,
}

impl RiskManager {
    async fn evaluate(&mut self, intent: TradeIntent) -> RiskDecision {
        let mut rejection_reasons = Vec::new();
        
        // Check 1: Trade size limit
        if intent.size_sol > self.config.max_sol_per_trade {
            rejection_reasons.push(format!(
                "Trade size {} exceeds max {}",
                intent.size_sol,
                self.config.max_sol_per_trade
            ));
        }
        
        // Check 2: Concurrent position limit
        if self.state.open_positions.len() >= self.config.max_concurrent_positions {
            rejection_reasons.push(format!(
                "Already at max concurrent positions: {}",
                self.state.open_positions.len()
            ));
        }
        
        // Check 3: Per-token exposure
        let current_exposure = self.state.open_positions
            .values()
            .filter(|p| p.market_id == intent.market_id)
            .map(|p| p.entry_amount)
            .sum::<f64>();
            
        if current_exposure + intent.size_sol > self.config.max_exposure_per_token {
            rejection_reasons.push(format!(
                "Token exposure would exceed limit: {} + {} > {}",
                current_exposure,
                intent.size_sol,
                self.config.max_exposure_per_token
            ));
        }
        
        // Check 4: Daily loss limit
        self.update_daily_pnl();
        if self.state.daily_pnl_sol < -self.config.max_daily_loss_sol {
            rejection_reasons.push(format!(
                "Daily loss limit breached: {}",
                self.state.daily_pnl_sol
            ));
        }
        
        // Check 5: Rate limiting
        self.prune_hourly_trades();
        if self.state.hourly_trade_count.len() >= self.config.max_hourly_trades {
            rejection_reasons.push(format!(
                "Hourly trade limit reached: {}",
                self.state.hourly_trade_count.len()
            ));
        }
        
        // Check 6: System health
        if !self.is_system_healthy().await {
            rejection_reasons.push("System unhealthy (stale data or RPC degraded)".to_string());
        }
        
        // Decision
        if rejection_reasons.is_empty() {
            self.state.hourly_trade_count.push_back(Utc::now());
            
            RiskDecision::Approved(intent)
        } else {
            warn!("Intent rejected: {:?}", rejection_reasons);
            
            self.db.log_rejection(&intent, &rejection_reasons).await;
            
            RiskDecision::Rejected {
                intent,
                reasons: rejection_reasons,
            }
        }
    }
    
    async fn is_system_healthy(&self) -> bool {
        // Check market data freshness
        // Check RPC connection health
        // Check recent execution success rate
        true // Placeholder
    }
    
    fn update_daily_pnl(&mut self) {
        let now = Utc::now();
        
        // Reset daily PnL at midnight UTC
        if now.date_naive() != self.state.daily_pnl_reset_time.date_naive() {
            self.state.daily_pnl_sol = 0.0;
            self.state.daily_pnl_reset_time = now;
        }
    }
    
    fn prune_hourly_trades(&mut self) {
        let cutoff = Utc::now() - chrono::Duration::hours(1);
        
        while let Some(front) = self.state.hourly_trade_count.front() {
            if *front < cutoff {
                self.state.hourly_trade_count.pop_front();
            } else {
                break;
            }
        }
    }
}
Advanced Risk Features:

Drawdown monitoring: Track peak equity and stop trading if drawdown exceeds threshold
Correlation limits: Don't open multiple positions in highly correlated tokens
Volatility scaling: Reduce position sizes during high volatility regimes
Token blacklist: Automatically blacklist tokens that caused losses


D. ExecutionEngine Module
Responsibilities:

Quote fresh swap routes via Jupiter API
Build and simulate transactions
Submit with priority fees and retry logic
Track transaction confirmation
Handle failures gracefully
Implement RPC failover

Technical Design:
1. Jupiter Integration (MVP)
typescriptimport { Jupiter, RouteInfo } from '@jup-ag/core';
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';

class JupiterExecutor {
  private jupiter: Jupiter;
  private connections: Connection[]; // Multiple RPCs for failover
  private currentRpcIndex = 0;
  
  async executeSwap(intent: ApprovedIntent): Promise<ExecutionResult> {
    const executionId = uuidv4();
    
    try {
      // Step 1: Get fresh quote
      const routes = await this.jupiter.computeRoutes({
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
        amount: intent.amountLamports,
        slippageBps: this.computeSlippageBps(intent.estimatedSlippage),
      });
      
      if (routes.routesInfos.length === 0) {
        return { status: 'FAILED', reason: 'No routes found' };
      }
      
      const bestRoute = routes.routesInfos[0];
      
      // Step 2: Compute min output with safety margin
      const minOutAmount = this.computeMinOut(bestRoute, intent.slippageTolerance);
      
      // Step 3: Build transaction
      const { execute } = await this.jupiter.exchange({
        routeInfo: bestRoute,
        userPublicKey: this.wallet.publicKey,
      });
      
      // Step 4: Add compute budget and priority fee
      const swapTx = await execute();
      const enrichedTx = this.addComputeBudget(swapTx, intent.priorityFee);
      
      // Step 5: Simulate before sending
      const simulation = await this.simulate(enrichedTx);
      if (simulation.err) {
        error('Simulation failed:', simulation.err);
        return { status: 'FAILED', reason: 'Simulation failed', details: simulation };
      }
      
      // Step 6: Sign and submit with retry
      const signature = await this.submitWithRetry(enrichedTx, executionId);
      
      // Step 7: Confirm
      const confirmation = await this.confirmTransaction(signature);
      
      if (confirmation.value.err) {
        return { status: 'FAILED', reason: 'Transaction failed on-chain', signature };
      }
      
      // Step 8: Parse fill details from logs
      const fillDetails = this.parseFillFromLogs(confirmation);
      
      return {
        status: 'SUCCESS',
        signature,
        fillPrice: fillDetails.price,
        fillAmount: fillDetails.amount,
        executionLatencyMs: Date.now() - intent.timestamp,
      };
      
    } catch (err) {
      error('Execution error:', err);
      return { status: 'FAILED', reason: err.message };
    }
  }
  
  private addComputeBudget(tx: Transaction, priorityFee: number): Transaction {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000, // Increase if swaps are complex
    });
    
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee, // Dynamic based on network congestion
    });
    
    tx.add(modifyComputeUnits, addPriorityFee);
    return tx;
  }
  
  private async simulate(tx: Transaction): Promise<SimulationResult> {
    const connection = this.getCurrentConnection();
    
    return await connection.simulateTransaction(tx, {
      commitment: 'processed',
      replaceRecentBlockhash: true,
    });
  }
  
  private async submitWithRetry(
    tx: Transaction,
    executionId: string,
    maxAttempts = 3
  ): Promise<string> {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const connection = this.getCurrentConnection();
        
        const signature = await connection.sendRawTransaction(
          tx.serialize(),
          {
            skipPreflight: true, // We already simulated
            maxRetries: 0, // We handle retries ourselves
          }
        );
        
        info(`Transaction submitted (attempt ${attempt}): ${signature}`);
        return signature;
        
      } catch (err) {
        lastError = err;
        warn(`Submit attempt ${attempt} failed:`, err);
        
        // Failover to next RPC
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.connections.length;
        
        if (attempt < maxAttempts) {
          await sleep(500 * attempt); // Exponential backoff
        }
      }
    }
    
    throw new Error(`Failed to submit after ${maxAttempts} attempts: ${lastError}`);
  }
  
  private async confirmTransaction(signature: string): Promise<ConfirmationResult> {
    const connection = this.getCurrentConnection();
    
    // Use confirmTransaction with timeout
    const result = await Promise.race([
      connection.confirmTransaction(signature, 'confirmed'),
      sleep(30000).then(() => { throw new Error('Confirmation timeout'); }),
    ]);
    
    return result;
  }
  
  private computeSlippageBps(estimatedSlippage: number): number {
    // Add safety margin: if estimated is 2%, allow 3%
    const safetyMargin = 1.5;
    return Math.ceil(estimatedSlippage * 100 * safetyMargin);
  }
}
2. Direct Pump AMM Execution (Future)
rust// When you're ready to optimize for Pump.fun specifically
use anchor_lang::prelude::*;

pub struct PumpAMMExecutor {
    program_id: Pubkey,
    wallet: Keypair,
}

impl PumpContinue1:49 PMAMMExecutor {
pub async fn swap(
&self,
bonding_curve: Pubkey,
amount_in: u64,
min_amount_out: u64,
) -> Result<Signature> {
// Fetch bonding curve state
let curve_data = self.fetch_bonding_curve(bonding_curve).await?;
    // Compute expected output using bonding curve formula
    let expected_out = self.compute_output(
        curve_data.virtual_token_reserves,
        curve_data.virtual_sol_reserves,
        amount_in,
    );
    
    // Build swap instruction
    let ix = self.build_swap_instruction(
        bonding_curve,
        amount_in,
        min_amount_out.max(expected_out * 97 / 100), // 3% slippage
    )?;
    
    // Add compute budget
    let compute_ix = ComputeBudgetInstruction::set_compute_unit_limit(200_000);
    let priority_ix = ComputeBudgetInstruction::set_compute_unit_price(50_000);
    
    // Build and send transaction
    let mut tx = Transaction::new_with_payer(
        &[compute_ix, priority_ix, ix],
        Some(&self.wallet.pubkey()),
    );
    
    let recent_blockhash = self.rpc_client.get_latest_blockhash().await?;
    tx.sign(&[&self.wallet], recent_blockhash);
    
    let signature = self.rpc_client.send_and_confirm_transaction(&tx).await?;
    
    Ok(signature)
}

fn compute_output(&self, token_reserves: u64, sol_reserves: u64, sol_in: u64) -> u64 {
    // Bonding curve formula: tokens_out = token_reserves - (k / (sol_reserves + sol_in))
    let k = (token_reserves as u128) * (sol_reserves as u128);
    let new_sol_reserves = sol_reserves as u128 + sol_in as u128;
    let new_token_reserves = k / new_sol_reserves;
    
    (token_reserves as u128 - new_token_reserves) as u64
}
}

**3. RPC Failover Strategy**
```typescript
class RPCFailoverManager {
  private providers = [
    { url: 'https://mainnet.helius-rpc.com/?api-key=XXX', priority: 1, healthy: true },
    { url: 'https://rpc.triton.one/XXX', priority: 2, healthy: true },
    { url: 'https://api.mainnet-beta.solana.com', priority: 3, healthy: true },
  ];
  
  private healthCheckInterval = setInterval(() => this.checkHealth(), 10000);
  
  getCurrentConnection(): Connection {
    const healthy = this.providers
      .filter(p => p.healthy)
      .sort((a, b) => a.priority - b.priority);
    
    if (healthy.length === 0) {
      throw new Error('No healthy RPC providers');
    }
    
    return new Connection(healthy[0].url, 'confirmed');
  }
  
  private async checkHealth() {
    for (const provider of this.providers) {
      try {
        const conn = new Connection(provider.url, 'confirmed');
        const slot = await Promise.race([
          conn.getSlot(),
          sleep(2000).then(() => { throw new Error('timeout'); }),
        ]);
        
        provider.healthy = true;
      } catch (err) {
        warn(`Provider ${provider.url} unhealthy:`, err.message);
        provider.healthy = false;
      }
    }
  }
}
```

**Performance Optimizations:**
- **Connection pooling:** Maintain persistent HTTP/2 connections to RPC providers
- **Parallel simulation:** Simulate on multiple RPCs and use fastest result
- **Mempool monitoring:** Subscribe to pending transactions to estimate priority fee needed
- **Pre-signed transactions:** Pre-build transaction templates to reduce latency
- **Batching:** If multiple intents fire simultaneously, consider batching (Jupiter supports multi-swap)

---

### **E. PositionTracker Module**

**Responsibilities:**
- Maintain position state machines
- Monitor unrealized PnL
- Trigger exit conditions
- Emit exit intents

**Technical Design:**
```rust
#[derive(Debug, Clone, PartialEq)]
enum PositionState {
    PendingOpen { tx_signature: String },
    Open {
        entry_price: f64,
        entry_amount: f64,
        entry_time: DateTime<Utc>,
    },
    PendingClose { tx_signature: String },
    Closed {
        exit_price: f64,
        realized_pnl_sol: f64,
        exit_reason: ExitReason,
    },
    Failed { reason: String },
}

#[derive(Debug, Clone)]
enum ExitReason {
    TakeProfit,
    StopLoss,
    TimeStop,
    LiquidityCollapse,
    EmergencyExit,
}

struct Position {
    id: Uuid,
    intent_id: Uuid,
    market_id: String,
    state: PositionState,
    metadata: serde_json::Value,
}

struct PositionTracker {
    positions: HashMap<Uuid, Position>,
    exit_config: ExitConfig,
    market_data: Arc<RwLock<HashMap<String, MarketUpdate>>>,
}

struct ExitConfig {
    take_profit_pct: f64,      // e.g., 3.0 for 3% profit
    stop_loss_pct: f64,        // e.g., 2.0 for 2% loss
    time_stop_seconds: i64,    // e.g., 300 for 5 minutes
    trailing_stop_pct: Option<f64>, // Optional trailing stop
}

impl PositionTracker {
    async fn on_fill_event(&mut self, fill: FillEvent) {
        if let Some(position) = self.positions.get_mut(&fill.position_id) {
            match &position.state {
                PositionState::PendingOpen { .. } => {
                    position.state = PositionState::Open {
                        entry_price: fill.price,
                        entry_amount: fill.amount,
                        entry_time: Utc::now(),
                    };
                    
                    info!("Position {} now OPEN at price {}", position.id, fill.price);
                }
                
                PositionState::PendingClose { .. } => {
                    let realized_pnl = self.compute_realized_pnl(position, fill.price);
                    
                    position.state = PositionState::Closed {
                        exit_price: fill.price,
                        realized_pnl_sol: realized_pnl,
                        exit_reason: fill.exit_reason,
                    };
                    
                    info!("Position {} CLOSED: PnL = {} SOL", position.id, realized_pnl);
                    
                    // Persist to database
                    self.db.record_closed_position(position).await;
                }
                
                _ => {}
            }
        }
    }
    
    async fn monitor_exits(&mut self) {
        let market_data = self.market_data.read().await;
        let mut exit_intents = Vec::new();
        
        for (id, position) in &self.positions {
            if let PositionState::Open { entry_price, entry_amount, entry_time } = &position.state {
                let market = match market_data.get(&position.market_id) {
                    Some(m) => m,
                    None => continue, // No data, skip
                };
                
                let current_price = match market.window.current_price() {
                    Some(p) => p,
                    None => continue,
                };
                
                let unrealized_pnl_pct = ((current_price - entry_price) / entry_price) * 100.0;
                let time_held = Utc::now() - *entry_time;
                
                // Check exit conditions
                let exit_reason = if unrealized_pnl_pct >= self.exit_config.take_profit_pct {
                    Some(ExitReason::TakeProfit)
                } else if unrealized_pnl_pct <= -self.exit_config.stop_loss_pct {
                    Some(ExitReason::StopLoss)
                } else if time_held.num_seconds() > self.exit_config.time_stop_seconds {
                    Some(ExitReason::TimeStop)
                } else if market.compute_liquidity_sol() < MIN_EXIT_LIQUIDITY {
                    Some(ExitReason::LiquidityCollapse)
                } else {
                    None
                };
                
                if let Some(reason) = exit_reason {
                    exit_intents.push(ExitIntent {
                        position_id: *id,
                        market_id: position.market_id.clone(),
                        exit_reason: reason,
                        current_price,
                    });
                }
            }
        }
        
        // Emit exit intents (will flow through RiskManager → ExecutionEngine)
        for intent in exit_intents {
            self.exit_intent_tx.send(intent).await.ok();
        }
    }
    
    fn compute_realized_pnl(&self, position: &Position, exit_price: f64) -> f64 {
        if let PositionState::Open { entry_price, entry_amount, .. } = position.state {
            let value_in = entry_amount;
            let value_out = entry_amount * (exit_price / entry_price);
            
            value_out - value_in
        } else {
            0.0
        }
    }
}
```

**Advanced Exit Features:**
- **Trailing stop:** Lock in profits as price moves favorably
- **Momentum reversal detection:** Exit if price velocity flips negative
- **Liquidity-aware exits:** Exit early if liquidity drops below threshold
- **Partial exits:** Take profit on 50% of position, let rest run

---

## **IV. DEVELOPMENT ROADMAP**

### **Phase 0: Foundation (Week 1-2)**
1. Set up project structure (monorepo with `pnpm` or Cargo workspace)
2. Configure logging (JSON structured logs)
3. Set up database schema (SQLite for dev)
4. Implement WebSocket connection manager with reconnection
5. Build basic MarketData module (subscribe to 1 market, log price changes)
6. **Validation:** Verify price updates match on-chain state manually

### **Phase 1: Data Pipeline (Week 3-4)**
1. Implement rolling window data structure
2. Add volatility and liquidity computation
3. Build staleness detection
4. Add multi-market support
5. **Validation:** Run for 24+ hours, verify no data loss or crashes

### **Phase 2: Signal Logic (Week 5)**
1. Implement DipDetector with all gates
2. Build simulation mode (log what it would trade)
3. Run historical backtests using recorded market data
4. **Validation:** Ensure signals trigger at expected times, no false positives

### **Phase 3: Risk Framework (Week 6)**
1. Build RiskManager with all checks
2. Add circuit breaker logic
3. Test edge cases (simultaneous intents, loss limits)
4. **Validation:** Intentionally trigger all rejection reasons

### **Phase 4: Paper Trading (Week 7-8)**
1. Build paper-trading executor (simulates fills without real txs)
2. Track hypothetical PnL
3. Run for 1+ week on mainnet
4. **Validation:** Compare simulated slippage vs actual market conditions

### **Phase 5: Live Execution (Week 9-10)**
1. Integrate Jupiter API
2. Build transaction submission pipeline
3. Test with **0.01 SOL** trades only
4. Gradually increase to 0.1, then 0.5 SOL
5. **Validation:** Achieve 90%+ execution success rate

### **Phase 6: Position Management (Week 11-12)**
1. Build PositionTracker state machine
2. Implement exit monitoring
3. Test full entry → exit lifecycle
4. **Validation:** Ensure no orphaned positions

### **Phase 7: Observability & Production (Week 13-14)**
1. Add Prometheus metrics
2. Build Grafana dashboards
3. Set up alerting
4. Deploy to production server (DigitalOcean/AWS)
5. Implement automated restart on crash
6. **Validation:** Run for 1 week with full monitoring

### **Phase 8: Optimization (Week 15+)**
1. Profile hot paths (use `perf` or `flamegraph`)
2. Consider Rust rewrite of critical modules
3. Add direct Pump AMM execution
4. Implement advanced features (trailing stops, partial exits)

---

## **V. PERFORMANCE TARGETS**

- **Latency (market update → trade submission):** < 500ms p99
- **Market data lag:** < 100ms p99
- **Execution success rate:** > 90%
- **System uptime:** > 99.5%
- **Max concurrent positions:** 10
- **Trades per hour:** 20-50 (depending on volatility)

---

## **VI. FAILURE MODES & MITIGATIONS**

| Failure Mode | Impact | Mitigation |
|---|---|---|
| WebSocket disconnect | No market data | Auto-reconnect with backoff, circuit breaker on prolonged outage |
| RPC rate limit | Cannot submit txs | Multi-RPC failover, exponential backoff |
| Transaction fails simulation | Lost gas fee | Pre-flight simulation, reject before sending |
| Double-buy due to retry | Excessive exposure | Idempotency keys, track pending intents |
| Market data stale | Wrong entry price | Staleness detection, refuse trades if lag > 5s |
| Rug pull / liquidity removal | Position value → 0 | Liquidity monitoring, emergency exit on collapse |
| Daily loss limit breached | No more trades that day | Hard circuit breaker, manual override required |

---

## **VII. ESTIMATED COSTS**

- **RPC costs:** $50-200/month (Helius paid tier)
- **Server:** $20-100/month (DigitalOcean droplet or AWS t3.medium)
- **Database:** Free (SQLite) or $15/month (managed Postgres)
- **Monitoring:** Free (self-hosted Grafana) or $20/month (Grafana Cloud)
- **Transaction fees:** Variable (SOL priority fees + Jupiter platform fees)
  - Priority fees: ~0.0001-0.001 SOL per tx
  - Jupiter fee: 0.05-0.1% of swap value

**Total monthly cost:** $90-320 + transaction fees

---

This is the complete technical architecture. You now have a buildable, production-grade system specification with concrete technology choices, performance targets, and a phased implementation plan. Let me know if you want me to drill deeper into any specific module or if you want the actual code scaffolding for any component.
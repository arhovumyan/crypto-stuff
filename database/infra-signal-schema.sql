-- Infrastructure Signal Bot Database Schema Extension
-- Adds tables for infra wallet tracking and signal detection

-- ============================================================================
-- Infra Wallets - Known infrastructure/market maker wallets
-- ============================================================================
CREATE TABLE IF NOT EXISTS infra_wallets (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  
  -- Classification
  behavior_type TEXT NOT NULL DEFAULT 'unknown', -- 'defensive', 'cyclical', 'aggressive', 'passive', 'unknown'
  confidence_score NUMERIC DEFAULT 0, -- 0-100 confidence in classification
  
  -- Behavior metrics
  total_defenses INT DEFAULT 0, -- How many times they defended a level
  total_absorptions INT DEFAULT 0, -- How many times they absorbed sells
  avg_defense_size_sol NUMERIC DEFAULT 0, -- Average size of defense buys
  avg_response_time_ms INT DEFAULT 0, -- Average time to respond to sells
  win_rate NUMERIC DEFAULT 0, -- % of defenses that held
  
  -- Distribution behavior
  distribution_frequency NUMERIC DEFAULT 0, -- How often they sell (sells per hour)
  avg_distribution_size_pct NUMERIC DEFAULT 0, -- Average sell size as % of position
  
  -- Activity
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  total_trades INT DEFAULT 0,
  
  -- Metadata
  notes TEXT,
  is_blacklisted BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_infra_wallets_address ON infra_wallets(address);
CREATE INDEX idx_infra_wallets_behavior ON infra_wallets(behavior_type);
CREATE INDEX idx_infra_wallets_active ON infra_wallets(last_seen_at DESC);

-- ============================================================================
-- Pool Liquidity Snapshots - Track pool state for sell size calculations
-- ============================================================================
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id SERIAL PRIMARY KEY,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  
  -- Liquidity data
  liquidity_sol NUMERIC NOT NULL,
  liquidity_token NUMERIC NOT NULL,
  liquidity_usd NUMERIC,
  price_usd NUMERIC,
  
  -- Snapshot time
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pool_snapshots_pool ON pool_snapshots(pool_address);
CREATE INDEX idx_pool_snapshots_token ON pool_snapshots(token_mint);
CREATE INDEX idx_pool_snapshots_time ON pool_snapshots(captured_at DESC);

-- ============================================================================
-- Large Sell Events - Detected sell events exceeding threshold
-- ============================================================================
CREATE TABLE IF NOT EXISTS large_sell_events (
  id SERIAL PRIMARY KEY,
  signature TEXT UNIQUE NOT NULL,
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  
  -- Sell details
  sell_amount_token NUMERIC NOT NULL,
  sell_amount_sol NUMERIC NOT NULL,
  sell_amount_usd NUMERIC,
  liquidity_pct NUMERIC NOT NULL, -- % of pool liquidity this sell represents
  
  -- Price impact
  price_before NUMERIC,
  price_after NUMERIC,
  price_impact_pct NUMERIC,
  
  -- Absorption tracking
  was_absorbed BOOLEAN DEFAULT false,
  absorption_amount_sol NUMERIC DEFAULT 0,
  absorption_wallet TEXT,
  absorption_delay_ms INT,
  
  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'absorbed', 'not_absorbed', 'expired'
  
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_large_sells_token ON large_sell_events(token_mint);
CREATE INDEX idx_large_sells_pool ON large_sell_events(pool_address);
CREATE INDEX idx_large_sells_status ON large_sell_events(status);
CREATE INDEX idx_large_sells_time ON large_sell_events(detected_at DESC);

-- ============================================================================
-- Infra Signals - Generated trading signals
-- ============================================================================
CREATE TABLE IF NOT EXISTS infra_signals (
  id SERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  
  -- Signal type and strength
  signal_type TEXT NOT NULL, -- 'absorption', 'defense', 'accumulation', 'distribution_pause'
  strength NUMERIC NOT NULL, -- 0-100 signal strength score
  
  -- Related events
  sell_event_id INT REFERENCES large_sell_events(id),
  infra_wallet TEXT,
  infra_wallet_type TEXT, -- behavior type at time of signal
  
  -- Price context
  price_at_signal NUMERIC,
  defended_level NUMERIC,
  
  -- Stabilization metrics
  stabilization_confirmed BOOLEAN DEFAULT false,
  stabilization_time_ms INT,
  higher_low_formed BOOLEAN DEFAULT false,
  
  -- Outcome
  signal_status TEXT DEFAULT 'active', -- 'active', 'confirmed', 'invalidated', 'expired'
  entry_price NUMERIC,
  exit_price NUMERIC,
  pnl_pct NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX idx_infra_signals_token ON infra_signals(token_mint);
CREATE INDEX idx_infra_signals_status ON infra_signals(signal_status);
CREATE INDEX idx_infra_signals_type ON infra_signals(signal_type);
CREATE INDEX idx_infra_signals_time ON infra_signals(created_at DESC);

-- ============================================================================
-- Infra Bot Trades - Our trades based on infra signals
-- ============================================================================
CREATE TABLE IF NOT EXISTS infra_trades (
  id SERIAL PRIMARY KEY,
  signal_id INT REFERENCES infra_signals(id),
  token_mint TEXT NOT NULL,
  
  -- Trade type
  action TEXT NOT NULL, -- 'buy', 'sell'
  reason TEXT, -- Why we entered/exited
  
  -- Execution
  signature TEXT,
  amount_sol NUMERIC,
  amount_token NUMERIC,
  price NUMERIC,
  slippage_pct NUMERIC,
  
  -- Status
  status TEXT DEFAULT 'pending', -- 'pending', 'success', 'failed', 'simulated'
  error_message TEXT,
  
  -- P&L (for sells)
  entry_price NUMERIC,
  realized_pnl_sol NUMERIC,
  realized_pnl_pct NUMERIC,
  
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_infra_trades_signal ON infra_trades(signal_id);
CREATE INDEX idx_infra_trades_token ON infra_trades(token_mint);
CREATE INDEX idx_infra_trades_status ON infra_trades(status);
CREATE INDEX idx_infra_trades_time ON infra_trades(executed_at DESC);

-- ============================================================================
-- Price Candles - Track price for stabilization detection
-- ============================================================================
CREATE TABLE IF NOT EXISTS price_candles (
  id SERIAL PRIMARY KEY,
  token_mint TEXT NOT NULL,
  timeframe TEXT NOT NULL, -- '1m', '5m'
  
  open_price NUMERIC NOT NULL,
  high_price NUMERIC NOT NULL,
  low_price NUMERIC NOT NULL,
  close_price NUMERIC NOT NULL,
  volume_sol NUMERIC DEFAULT 0,
  trade_count INT DEFAULT 0,
  
  candle_start TIMESTAMPTZ NOT NULL,
  candle_end TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_price_candles_token ON price_candles(token_mint);
CREATE INDEX idx_price_candles_timeframe ON price_candles(token_mint, timeframe);
CREATE INDEX idx_price_candles_time ON price_candles(candle_start DESC);

-- Unique constraint for token + timeframe + candle_start
CREATE UNIQUE INDEX idx_price_candles_unique ON price_candles(token_mint, timeframe, candle_start);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update updated_at for infra_wallets
CREATE TRIGGER update_infra_wallets_updated_at 
  BEFORE UPDATE ON infra_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


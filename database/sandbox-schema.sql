-- Sandbox/Simulation Database Schema
-- Tables for recording historical swaps and replay runs

-- ============================================================================
-- Historical Swap Events (from recorder)
-- ============================================================================

CREATE TABLE IF NOT EXISTS swap_events (
  id SERIAL PRIMARY KEY,
  
  -- Transaction metadata
  slot BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  block_time TIMESTAMPTZ NOT NULL,
  program_id TEXT NOT NULL,
  
  -- Pool & token info
  pool_address TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  base_mint TEXT NOT NULL,
  
  -- Trade details
  trader TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  amount_in NUMERIC NOT NULL,
  amount_out NUMERIC NOT NULL,
  amount_in_sol NUMERIC NOT NULL,
  amount_out_sol NUMERIC NOT NULL,
  
  -- Pool state snapshot (from on-chain)
  pool_slot BIGINT NOT NULL,
  pool_reserve_sol NUMERIC NOT NULL,
  pool_reserve_token NUMERIC NOT NULL,
  pool_price_sol NUMERIC NOT NULL,
  pool_liquidity_usd NUMERIC,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_swap_events_slot (slot),
  INDEX idx_swap_events_token_mint (token_mint),
  INDEX idx_swap_events_trader (trader),
  INDEX idx_swap_events_block_time (block_time),
  INDEX idx_swap_events_pool (pool_address)
);

-- ============================================================================
-- Replay Runs (simulation metadata)
-- ============================================================================

CREATE TABLE IF NOT EXISTS replay_runs (
  id SERIAL PRIMARY KEY,
  
  -- Run identification
  run_id TEXT UNIQUE NOT NULL,
  
  -- Dataset info
  dataset_path TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  
  -- Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_ms BIGINT,
  
  -- Slots covered
  start_slot BIGINT,
  end_slot BIGINT,
  
  -- Status
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message TEXT,
  
  -- Configuration
  config JSONB NOT NULL,
  
  -- Summary
  summary JSONB,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Trade Attributions (from replay)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_attributions (
  id SERIAL PRIMARY KEY,
  
  -- Run reference
  run_id TEXT NOT NULL REFERENCES replay_runs(run_id),
  
  -- Trade identification
  trade_id TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  
  -- Entry
  entry_slot BIGINT NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC NOT NULL,
  entry_amount_sol NUMERIC NOT NULL,
  entry_amount_tokens NUMERIC NOT NULL,
  entry_slippage_bps INTEGER NOT NULL,
  entry_fees_sol NUMERIC NOT NULL,
  
  -- Context (JSONB for flexibility)
  infra_wallets TEXT[] NOT NULL,
  absorption_event JSONB,
  stabilization_metrics JSONB,
  signal_strength INTEGER NOT NULL,
  regime_state TEXT NOT NULL,
  
  -- Exit
  exit_slot BIGINT,
  exit_time TIMESTAMPTZ,
  exit_price NUMERIC,
  exit_reason TEXT,
  exit_slippage_bps INTEGER,
  exit_fees_sol NUMERIC,
  
  -- Performance
  pnl_sol NUMERIC NOT NULL,
  pnl_pct NUMERIC NOT NULL,
  net_pnl_sol NUMERIC NOT NULL,
  mae NUMERIC NOT NULL,
  mfe NUMERIC NOT NULL,
  mae_pct NUMERIC NOT NULL,
  mfe_pct NUMERIC NOT NULL,
  holding_time_slots BIGINT NOT NULL,
  holding_time_ms BIGINT NOT NULL,
  
  -- Execution
  total_fees_sol NUMERIC NOT NULL,
  fill_success BOOLEAN NOT NULL,
  fill_failure_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_trade_attributions_run_id (run_id),
  INDEX idx_trade_attributions_token (token_mint),
  INDEX idx_trade_attributions_entry_slot (entry_slot),
  INDEX idx_trade_attributions_pnl (pnl_sol)
);

-- ============================================================================
-- Wallet Analytics (from replay)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_analytics (
  id SERIAL PRIMARY KEY,
  
  -- Run reference
  run_id TEXT NOT NULL REFERENCES replay_runs(run_id),
  
  -- Wallet identification
  address TEXT NOT NULL,
  behavior_type TEXT NOT NULL,
  
  -- Discovery
  discovered_at TIMESTAMPTZ NOT NULL,
  discovery_method TEXT NOT NULL CHECK (discovery_method IN ('manual', 'automatic')),
  
  -- Activity
  total_absorptions INTEGER NOT NULL DEFAULT 0,
  total_defenses INTEGER NOT NULL DEFAULT 0,
  successful_defenses INTEGER NOT NULL DEFAULT 0,
  defense_success_rate NUMERIC NOT NULL DEFAULT 0,
  average_response_time_slots NUMERIC NOT NULL DEFAULT 0,
  
  -- Confidence
  initial_confidence NUMERIC NOT NULL,
  final_confidence NUMERIC NOT NULL,
  confidence_history JSONB NOT NULL,
  confidence_decay_events INTEGER NOT NULL DEFAULT 0,
  
  -- Performance
  trades_involved INTEGER NOT NULL DEFAULT 0,
  total_pnl_contribution NUMERIC NOT NULL DEFAULT 0,
  average_pnl_per_trade NUMERIC NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  
  -- Status
  is_blacklisted BOOLEAN NOT NULL DEFAULT false,
  blacklisted_at TIMESTAMPTZ,
  blacklist_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_wallet_analytics_run_id (run_id),
  INDEX idx_wallet_analytics_address (address),
  INDEX idx_wallet_analytics_pnl (total_pnl_contribution)
);

-- ============================================================================
-- Equity Curve (for charts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS equity_curve (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES replay_runs(run_id),
  slot BIGINT NOT NULL,
  time TIMESTAMPTZ NOT NULL,
  capital_sol NUMERIC NOT NULL,
  realized_pnl_sol NUMERIC NOT NULL,
  unrealized_pnl_sol NUMERIC NOT NULL,
  drawdown_pct NUMERIC NOT NULL,
  open_positions INTEGER NOT NULL,
  
  INDEX idx_equity_curve_run_id (run_id),
  INDEX idx_equity_curve_slot (slot)
);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_replay_runs_updated_at
    BEFORE UPDATE ON replay_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_swap_events_token_slot ON swap_events(token_mint, slot);
CREATE INDEX IF NOT EXISTS idx_trade_attributions_run_token ON trade_attributions(run_id, token_mint);
CREATE INDEX IF NOT EXISTS idx_wallet_analytics_run_address ON wallet_analytics(run_id, address);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE swap_events IS 'Historical on-chain swap events recorded for replay';
COMMENT ON TABLE replay_runs IS 'Simulation replay run metadata and results';
COMMENT ON TABLE trade_attributions IS 'Detailed attribution for each simulated trade';
COMMENT ON TABLE wallet_analytics IS 'Per-wallet performance analytics from replay';
COMMENT ON TABLE equity_curve IS 'Capital/equity over time for charting';

COMMENT ON COLUMN swap_events.pool_reserve_sol IS 'On-chain reserve reading at slot (not from API)';
COMMENT ON COLUMN swap_events.pool_reserve_token IS 'On-chain reserve reading at slot (not from API)';
COMMENT ON COLUMN trade_attributions.mae IS 'Maximum Adverse Excursion (worst drawdown during hold)';
COMMENT ON COLUMN trade_attributions.mfe IS 'Maximum Favorable Excursion (best profit during hold)';


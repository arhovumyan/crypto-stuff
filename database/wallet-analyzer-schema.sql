-- Wallet Behavior Analysis System - Database Schema
-- Version: 1.0
-- Purpose: Store and analyze Solana wallet trading behavior

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Tracked wallets we're analyzing
CREATE TABLE IF NOT EXISTS tracked_wallets (
  id SERIAL PRIMARY KEY,
  address VARCHAR(44) UNIQUE NOT NULL,
  label VARCHAR(100),
  discovered_at TIMESTAMP DEFAULT NOW(),
  last_analyzed_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tracked_wallets_address ON tracked_wallets(address);
CREATE INDEX idx_tracked_wallets_active ON tracked_wallets(is_active);

-- Raw transaction data from blockchain
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id) ON DELETE CASCADE,
  signature VARCHAR(88) UNIQUE NOT NULL,
  block_time TIMESTAMP NOT NULL,
  slot BIGINT NOT NULL,
  
  -- Transaction classification
  transaction_type VARCHAR(20), -- 'BUY', 'SELL', 'TRANSFER', 'FAILED', 'SWAP'
  
  -- Token details
  token_mint VARCHAR(44),
  token_symbol VARCHAR(20),
  token_name VARCHAR(100),
  token_decimals INTEGER,
  
  -- Trade details
  sol_amount DECIMAL(20, 9),
  token_amount DECIMAL(30, 9),
  price_per_token_sol DECIMAL(20, 12),
  price_per_token_usd DECIMAL(20, 12),
  
  -- Transaction metadata
  dex_program VARCHAR(44),
  dex_name VARCHAR(50),
  fee_lamports BIGINT,
  success BOOLEAN DEFAULT TRUE,
  
  -- Market context reference
  market_context_id INTEGER,
  
  -- Raw data for debugging
  raw_transaction JSONB,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_transactions_wallet_time ON wallet_transactions(wallet_id, block_time DESC);
CREATE INDEX idx_wallet_transactions_token ON wallet_transactions(token_mint);
CREATE INDEX idx_wallet_transactions_type ON wallet_transactions(transaction_type);
CREATE INDEX idx_wallet_transactions_signature ON wallet_transactions(signature);
CREATE INDEX idx_wallet_transactions_slot ON wallet_transactions(slot);

-- Market conditions at specific times
CREATE TABLE IF NOT EXISTS market_contexts (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  day_of_week VARCHAR(10),
  hour_of_day INTEGER CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  
  -- SOL price
  sol_price_usd DECIMAL(10, 2),
  
  -- Market-wide metrics
  total_volume_24h DECIMAL(20, 2),
  market_sentiment VARCHAR(20),
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_market_contexts_timestamp ON market_contexts(timestamp);

-- Token state at specific moments in time
CREATE TABLE IF NOT EXISTS token_snapshots (
  id SERIAL PRIMARY KEY,
  token_mint VARCHAR(44) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  
  -- Basic info
  symbol VARCHAR(20),
  name VARCHAR(100),
  decimals INTEGER,
  
  -- Price data
  price_usd DECIMAL(20, 12),
  price_sol DECIMAL(20, 12),
  market_cap_usd DECIMAL(20, 2),
  fdv_usd DECIMAL(20, 2),
  
  -- Liquidity & Volume
  liquidity_usd DECIMAL(20, 2),
  volume_24h_usd DECIMAL(20, 2),
  volume_change_24h DECIMAL(10, 4),
  price_change_24h DECIMAL(10, 4),
  price_change_1h DECIMAL(10, 4),
  
  -- Security metrics
  holder_count INTEGER,
  top_10_holders_pct DECIMAL(5, 2),
  
  -- DEX info
  pool_address VARCHAR(44),
  dex_name VARCHAR(50),
  
  -- Age of token
  token_age_seconds INTEGER,
  
  -- Raw API response
  raw_data JSONB,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_token_snapshots_mint_time ON token_snapshots(token_mint, timestamp DESC);
CREATE INDEX idx_token_snapshots_mint ON token_snapshots(token_mint);

-- ============================================================================
-- ANALYSIS TABLES
-- ============================================================================

-- Matched buy-sell pairs for performance analysis
CREATE TABLE IF NOT EXISTS matched_trades (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id) ON DELETE CASCADE,
  
  buy_transaction_id INTEGER REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  sell_transaction_id INTEGER REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  
  token_mint VARCHAR(44) NOT NULL,
  
  -- Entry details
  entry_time TIMESTAMP NOT NULL,
  entry_price_sol DECIMAL(20, 12),
  entry_price_usd DECIMAL(20, 12),
  entry_amount_sol DECIMAL(20, 9),
  entry_mcap_usd DECIMAL(20, 2),
  entry_liquidity_usd DECIMAL(20, 2),
  entry_volume_24h_usd DECIMAL(20, 2),
  
  -- Exit details
  exit_time TIMESTAMP,
  exit_price_sol DECIMAL(20, 12),
  exit_price_usd DECIMAL(20, 12),
  exit_amount_sol DECIMAL(20, 9),
  exit_mcap_usd DECIMAL(20, 2),
  
  -- Performance metrics
  hold_time_seconds INTEGER,
  profit_loss_sol DECIMAL(20, 9),
  profit_loss_usd DECIMAL(20, 2),
  return_percentage DECIMAL(10, 4),
  fees_paid_sol DECIMAL(20, 9),
  net_profit_sol DECIMAL(20, 9),
  net_return_percentage DECIMAL(10, 4),
  
  -- Market conditions
  entry_day_of_week VARCHAR(10),
  entry_hour_of_day INTEGER,
  
  -- Classification
  is_winner BOOLEAN,
  trade_category VARCHAR(20), -- 'scalp', 'day-trade', 'swing', 'position'
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_matched_trades_wallet ON matched_trades(wallet_id);
CREATE INDEX idx_matched_trades_token ON matched_trades(token_mint);
CREATE INDEX idx_matched_trades_entry_time ON matched_trades(entry_time DESC);
CREATE INDEX idx_matched_trades_is_winner ON matched_trades(is_winner);
CREATE INDEX idx_matched_trades_wallet_entry ON matched_trades(wallet_id, entry_time DESC);

-- Discovered behavioral patterns
CREATE TABLE IF NOT EXISTS wallet_patterns (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id) ON DELETE CASCADE,
  
  pattern_type VARCHAR(50), -- 'entry_timing', 'exit_strategy', 'token_selection', etc.
  pattern_name VARCHAR(100),
  description TEXT,
  
  confidence_score DECIMAL(5, 4) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  frequency INTEGER DEFAULT 1,
  success_rate DECIMAL(5, 4),
  
  -- Pattern-specific parameters
  parameters JSONB,
  
  first_observed_at TIMESTAMP,
  last_observed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_patterns_wallet ON wallet_patterns(wallet_id);
CREATE INDEX idx_wallet_patterns_type ON wallet_patterns(pattern_type);
CREATE INDEX idx_wallet_patterns_confidence ON wallet_patterns(confidence_score DESC);

-- Aggregated performance metrics by time period
CREATE TABLE IF NOT EXISTS wallet_performance (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id) ON DELETE CASCADE,
  
  -- Time period
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  period_type VARCHAR(20), -- 'all-time', 'daily', 'weekly', 'monthly'
  
  -- Trade metrics
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 4),
  
  -- Financial metrics
  total_profit_sol DECIMAL(20, 9),
  total_profit_usd DECIMAL(20, 2),
  total_loss_sol DECIMAL(20, 9),
  total_loss_usd DECIMAL(20, 2),
  net_profit_sol DECIMAL(20, 9),
  net_profit_usd DECIMAL(20, 2),
  average_return_pct DECIMAL(10, 4),
  median_return_pct DECIMAL(10, 4),
  largest_win_pct DECIMAL(10, 4),
  largest_loss_pct DECIMAL(10, 4),
  profit_factor DECIMAL(10, 4), -- totalProfit / totalLoss
  
  -- Timing metrics
  avg_hold_time_seconds INTEGER,
  median_hold_time_seconds INTEGER,
  min_hold_time_seconds INTEGER,
  max_hold_time_seconds INTEGER,
  
  -- Risk metrics
  max_drawdown_pct DECIMAL(10, 4),
  sharpe_ratio DECIMAL(10, 4),
  
  -- Trading activity
  total_volume_sol DECIMAL(20, 9),
  total_volume_usd DECIMAL(20, 2),
  total_fees_paid_sol DECIMAL(20, 9),
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(wallet_id, period_start, period_end, period_type)
);

CREATE INDEX idx_wallet_performance_wallet ON wallet_performance(wallet_id);
CREATE INDEX idx_wallet_performance_period ON wallet_performance(period_start, period_end);

-- Generated analysis reports
CREATE TABLE IF NOT EXISTS analysis_reports (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id) ON DELETE CASCADE,
  
  report_type VARCHAR(50), -- 'full_analysis', 'pattern_summary', 'performance_snapshot'
  
  title VARCHAR(200),
  
  -- Structured findings
  findings JSONB,
  
  -- Strategy recommendations
  recommendations JSONB,
  
  -- Report metadata
  report_version VARCHAR(10),
  
  -- File path if saved to disk
  file_path TEXT,
  
  generated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_analysis_reports_wallet ON analysis_reports(wallet_id);
CREATE INDEX idx_analysis_reports_type ON analysis_reports(report_type);
CREATE INDEX idx_analysis_reports_generated ON analysis_reports(generated_at DESC);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Quick wallet performance summary
CREATE OR REPLACE VIEW v_wallet_summary AS
SELECT 
  tw.id,
  tw.address,
  tw.label,
  COUNT(DISTINCT wt.id) as total_transactions,
  COUNT(DISTINCT mt.id) as total_matched_trades,
  COUNT(DISTINCT CASE WHEN mt.is_winner THEN mt.id END) as winning_trades,
  COALESCE(AVG(CASE WHEN mt.is_winner THEN 1.0 ELSE 0.0 END), 0) as win_rate,
  COALESCE(SUM(mt.profit_loss_sol), 0) as total_profit_sol,
  COALESCE(AVG(mt.return_percentage), 0) as avg_return_pct,
  COALESCE(AVG(mt.hold_time_seconds), 0) as avg_hold_time_seconds,
  tw.last_analyzed_at
FROM tracked_wallets tw
LEFT JOIN wallet_transactions wt ON tw.id = wt.wallet_id
LEFT JOIN matched_trades mt ON tw.id = mt.wallet_id
WHERE tw.is_active = true
GROUP BY tw.id, tw.address, tw.label, tw.last_analyzed_at;

-- View: Recent trading activity
CREATE OR REPLACE VIEW v_recent_activity AS
SELECT 
  tw.address,
  tw.label,
  wt.block_time,
  wt.transaction_type,
  wt.token_symbol,
  wt.sol_amount,
  wt.token_amount,
  wt.dex_name,
  wt.signature
FROM wallet_transactions wt
JOIN tracked_wallets tw ON wt.wallet_id = tw.id
WHERE wt.block_time > NOW() - INTERVAL '7 days'
ORDER BY wt.block_time DESC;

-- View: Top performing trades
CREATE OR REPLACE VIEW v_top_trades AS
SELECT 
  tw.address,
  tw.label,
  mt.token_mint,
  ts.symbol,
  mt.entry_time,
  mt.exit_time,
  mt.hold_time_seconds,
  mt.return_percentage,
  mt.profit_loss_sol,
  mt.entry_price_usd,
  mt.exit_price_usd
FROM matched_trades mt
JOIN tracked_wallets tw ON mt.wallet_id = tw.id
LEFT JOIN token_snapshots ts ON mt.token_mint = ts.token_mint 
  AND ts.timestamp <= mt.entry_time
WHERE mt.is_winner = true
ORDER BY mt.return_percentage DESC;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to calculate wallet win rate
CREATE OR REPLACE FUNCTION calculate_win_rate(p_wallet_id INTEGER)
RETURNS DECIMAL(5, 4) AS $$
DECLARE
  v_win_rate DECIMAL(5, 4);
BEGIN
  SELECT 
    CASE 
      WHEN COUNT(*) = 0 THEN 0
      ELSE COUNT(CASE WHEN is_winner THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL
    END
  INTO v_win_rate
  FROM matched_trades
  WHERE wallet_id = p_wallet_id;
  
  RETURN COALESCE(v_win_rate, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to get wallet total profit
CREATE OR REPLACE FUNCTION get_wallet_profit_sol(p_wallet_id INTEGER)
RETURNS DECIMAL(20, 9) AS $$
DECLARE
  v_total_profit DECIMAL(20, 9);
BEGIN
  SELECT COALESCE(SUM(profit_loss_sol), 0)
  INTO v_total_profit
  FROM matched_trades
  WHERE wallet_id = p_wallet_id;
  
  RETURN v_total_profit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Insert tracked wallets from environment variables
-- This will be done programmatically by the application

COMMENT ON TABLE tracked_wallets IS 'Solana wallet addresses being analyzed for trading behavior';
COMMENT ON TABLE wallet_transactions IS 'Raw transaction data from blockchain with classification';
COMMENT ON TABLE token_snapshots IS 'Point-in-time snapshots of token market data';
COMMENT ON TABLE matched_trades IS 'Buy-sell pairs with performance calculations';
COMMENT ON TABLE wallet_patterns IS 'Discovered behavioral patterns for each wallet';
COMMENT ON TABLE wallet_performance IS 'Aggregated performance metrics by time period';
COMMENT ON TABLE analysis_reports IS 'Generated analysis reports and recommendations';

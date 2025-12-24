-- Solana Copy Trader Database Schema
-- PostgreSQL 15+

-- Drop tables if they exist (for development)
DROP TABLE IF EXISTS risk_events CASCADE;
DROP TABLE IF EXISTS copy_attempts CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS leader_trades CASCADE;
DROP TABLE IF EXISTS followed_wallets CASCADE;

-- Followed wallets (leaders we copy)
CREATE TABLE followed_wallets (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}', -- custom limits per wallet
  score NUMERIC DEFAULT 0, -- wallet quality score (for future)
  last_trade_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX idx_followed_wallets_address ON followed_wallets(address);
CREATE INDEX idx_followed_wallets_enabled ON followed_wallets(enabled) WHERE enabled = true;

-- Leader trades (detected swaps from followed wallets)
CREATE TABLE leader_trades (
  id SERIAL PRIMARY KEY,
  leader_wallet TEXT NOT NULL,
  signature TEXT UNIQUE NOT NULL, -- Solana tx signature (idempotency)
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  
  -- Trade details
  token_in_mint TEXT NOT NULL,
  token_in_symbol TEXT,
  token_out_mint TEXT NOT NULL,
  token_out_symbol TEXT,
  amount_in NUMERIC NOT NULL,
  amount_out NUMERIC NOT NULL,
  
  -- Metadata
  dex_program TEXT, -- Raydium, Orca, Jupiter, etc
  raw_transaction JSONB, -- full parsed tx for debugging
  
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (leader_wallet) REFERENCES followed_wallets(address) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_leader_trades_signature ON leader_trades(signature);
CREATE INDEX idx_leader_trades_leader_wallet ON leader_trades(leader_wallet);
CREATE INDEX idx_leader_trades_detected_at ON leader_trades(detected_at DESC);
CREATE INDEX idx_leader_trades_slot ON leader_trades(slot DESC);

-- Copy attempts (our trades copying the leaders)
CREATE TABLE copy_attempts (
  id SERIAL PRIMARY KEY,
  leader_trade_id INT NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL, -- 'pending', 'success', 'failed', 'skipped'
  reason TEXT, -- why skipped/failed
  
  -- Pre-execution (risk engine)
  risk_checks JSONB, -- results of all risk checks
  
  -- Execution details
  quote_json JSONB, -- Jupiter quote
  our_signature TEXT, -- our swap tx signature
  
  -- Results
  amount_in NUMERIC,
  amount_out NUMERIC,
  expected_out NUMERIC, -- from quote
  slippage NUMERIC, -- actual vs expected
  fees NUMERIC, -- SOL fees paid
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  
  FOREIGN KEY (leader_trade_id) REFERENCES leader_trades(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_copy_attempts_leader_trade ON copy_attempts(leader_trade_id);
CREATE INDEX idx_copy_attempts_status ON copy_attempts(status);
CREATE INDEX idx_copy_attempts_created_at ON copy_attempts(created_at DESC);

-- Positions (current token holdings)
CREATE TABLE positions (
  token_mint TEXT PRIMARY KEY,
  token_symbol TEXT,
  
  -- Position tracking
  size NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC, -- average entry price
  
  -- PnL
  realized_pnl NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  
  -- Metadata
  first_trade_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  trade_count INT DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_positions_size ON positions(size) WHERE size > 0;

-- Risk events (auto-pause triggers, limits hit, etc)
CREATE TABLE risk_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL, -- 'daily_loss_limit', 'suspicious_wallet', 'token_blacklisted', etc
  severity TEXT NOT NULL, -- 'info', 'warning', 'critical'
  
  -- Context
  wallet_address TEXT,
  token_mint TEXT,
  trade_signature TEXT,
  
  details JSONB, -- full context of the event
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_risk_events_type ON risk_events(event_type);
CREATE INDEX idx_risk_events_severity ON risk_events(severity);
CREATE INDEX idx_risk_events_created_at ON risk_events(created_at DESC);

-- Seed followed wallets from your .env
INSERT INTO followed_wallets (address) VALUES
  ('BiiduLCkxxkXfBZzrQeikgCqbeednby7rzoVteuioHJM'),
  ('5aLY85pyxiuX3fd4RgM3Yc1e3MAL6b7UgaZz6MS3JUfG'),
  ('2pDhRxLSGriCnFBY4BH5YFJXUFfE1R1ZnCCdP8iMGpxk'),
  ('79P5UPYtt4Tnw3dsmoTNirPF168KExHfnZsy1HyfKzti'),
  ('5TjCevDrEwCUchRo5tjJu2bS6VpTh3oP3neSTizkQdS7')
ON CONFLICT (address) DO NOTHING;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
CREATE TRIGGER update_followed_wallets_updated_at BEFORE UPDATE ON followed_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

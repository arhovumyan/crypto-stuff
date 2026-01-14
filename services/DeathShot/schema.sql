-- DeathShot Trading Bot Database Schema
-- PostgreSQL 14+

-- Market snapshots (time-series data)
CREATE TABLE IF NOT EXISTS market_snapshots (
    time TIMESTAMPTZ NOT NULL,
    market_id TEXT NOT NULL,
    price NUMERIC(20,10) NOT NULL,
    base_reserve BIGINT NOT NULL,
    quote_reserve BIGINT NOT NULL,
    liquidity_estimate NUMERIC(20,10),
    volume_proxy NUMERIC(20,10),
    PRIMARY KEY (time, market_id)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_time 
ON market_snapshots(market_id, time DESC);

-- Trade intents
CREATE TABLE IF NOT EXISTS trade_intents (
    intent_id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    market_id TEXT NOT NULL,
    side TEXT NOT NULL,
    size_sol NUMERIC(20,10) NOT NULL,
    reference_price NUMERIC(20,10) NOT NULL,
    current_price NUMERIC(20,10) NOT NULL,
    price_drop_pct NUMERIC(5,2) NOT NULL,
    liquidity NUMERIC(20,10) NOT NULL,
    estimated_slippage NUMERIC(5,2) NOT NULL,
    reason_codes JSONB,
    risk_decision TEXT NOT NULL,
    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_trade_intents_market 
ON trade_intents(market_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_intents_decision 
ON trade_intents(risk_decision, created_at DESC);

-- Positions
CREATE TABLE IF NOT EXISTS positions (
    position_id UUID PRIMARY KEY,
    intent_id UUID REFERENCES trade_intents(intent_id),
    market_id TEXT NOT NULL,
    state TEXT NOT NULL,
    entry_tx_sig TEXT,
    entry_price NUMERIC(20,10),
    entry_amount NUMERIC(20,10),
    entry_time TIMESTAMPTZ,
    exit_tx_sig TEXT,
    exit_price NUMERIC(20,10),
    exit_time TIMESTAMPTZ,
    realized_pnl_sol NUMERIC(20,10),
    exit_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_state 
ON positions(state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_positions_market 
ON positions(market_id, created_at DESC);

-- Execution logs
CREATE TABLE IF NOT EXISTS execution_logs (
    id SERIAL PRIMARY KEY,
    position_id UUID REFERENCES positions(position_id),
    event_type TEXT NOT NULL,
    signature TEXT,
    status TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_position 
ON execution_logs(position_id, created_at DESC);

-- System metrics (for monitoring)
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    metric_name TEXT NOT NULL,
    metric_value NUMERIC,
    metric_labels JSONB,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name_time 
ON system_metrics(metric_name, recorded_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for positions table
CREATE TRIGGER update_positions_updated_at 
    BEFORE UPDATE ON positions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

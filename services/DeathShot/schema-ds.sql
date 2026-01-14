-- DeathShot Trading Bot Database Schema
-- Prefix all tables with 'ds_' to avoid conflicts

-- Market snapshots
CREATE TABLE IF NOT EXISTS ds_market_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    market_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    price NUMERIC(20,10) NOT NULL,
    liquidity_sol NUMERIC(20,10),
    volume_proxy NUMERIC(20,10),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_ds_market_snapshots_market 
ON ds_market_snapshots(market_id, timestamp DESC);

-- Trade intents
CREATE TABLE IF NOT EXISTS ds_trade_intents (
    intent_id UUID PRIMARY KEY,
    market_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger_price NUMERIC(20,10) NOT NULL,
    current_price NUMERIC(20,10) NOT NULL,
    dip_magnitude_pct NUMERIC(5,2) NOT NULL,
    liquidity_sol NUMERIC(20,10) NOT NULL,
    estimated_slippage NUMERIC(5,2) NOT NULL,
    reason_codes JSONB,
    risk_decision TEXT NOT NULL,
    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ds_trade_intents_market 
ON ds_trade_intents(market_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ds_trade_intents_decision 
ON ds_trade_intents(risk_decision, created_at DESC);

-- Positions
CREATE TABLE IF NOT EXISTS ds_positions (
    position_id UUID PRIMARY KEY,
    intent_id UUID REFERENCES ds_trade_intents(intent_id),
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

CREATE INDEX IF NOT EXISTS idx_ds_positions_state 
ON ds_positions(state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ds_positions_market 
ON ds_positions(market_id, created_at DESC);

-- Execution logs
CREATE TABLE IF NOT EXISTS ds_execution_logs (
    id SERIAL PRIMARY KEY,
    position_id UUID REFERENCES ds_positions(position_id),
    event_type TEXT NOT NULL,
    signature TEXT,
    status TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ds_execution_logs_position 
ON ds_execution_logs(position_id, created_at DESC);

-- System metrics
CREATE TABLE IF NOT EXISTS ds_system_metrics (
    id SERIAL PRIMARY KEY,
    metric_name TEXT NOT NULL,
    metric_value NUMERIC,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ds_system_metrics_name 
ON ds_system_metrics(metric_name, created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_ds_positions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ds_positions_updated_at ON ds_positions;
CREATE TRIGGER update_ds_positions_updated_at
    BEFORE UPDATE ON ds_positions
    FOR EACH ROW
    EXECUTE FUNCTION update_ds_positions_updated_at();

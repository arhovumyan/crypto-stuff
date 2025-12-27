import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

export const config = {
  // Solana RPC
  heliusApiKey: process.env.HELIUS_API_KEY!,
  rpcUrl: process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL!,
  wsUrl: process.env.HELIUS_WS_URL!,
  
  // Database
  databaseUrl: process.env.DATABASE_URL!,
  
  // Discovery Parameters
  discovery: {
    // Large sell detection (% of pool liquidity)
    minSellPercentOfPool: parseFloat(process.env.DISCOVERY_MIN_SELL_PCT || '1.0'),  // 1%
    maxSellPercentOfPool: parseFloat(process.env.DISCOVERY_MAX_SELL_PCT || '3.0'),  // 3%
    
    // Observation window after large sell (seconds)
    absorptionWindowSec: parseInt(process.env.DISCOVERY_ABSORPTION_WINDOW_SEC || '60'),
    
    // Absorption thresholds
    minAbsorptionPercent: parseFloat(process.env.DISCOVERY_MIN_ABSORPTION_PCT || '20'), // 20% of sell
    maxAbsorptionPercent: parseFloat(process.env.DISCOVERY_MAX_ABSORPTION_PCT || '80'), // 80% of sell
    
    // Response timing (slots)
    maxResponseLatencySlots: parseInt(process.env.DISCOVERY_MAX_RESPONSE_SLOTS || '100'),
    
    // Stabilization window (seconds after absorption)
    stabilizationWindowSec: parseInt(process.env.DISCOVERY_STABILIZATION_WINDOW_SEC || '300'), // 5 min
    
    // Stabilization criteria
    maxPriceDropPercent: parseFloat(process.env.DISCOVERY_MAX_PRICE_DROP_PCT || '5.0'), // 5%
    minVolumeContractionPercent: parseFloat(process.env.DISCOVERY_MIN_VOLUME_CONTRACTION_PCT || '30'), // 30%
  },
  
  // Longitudinal Scoring Parameters
  scoring: {
    // Minimum events required to classify as infra
    minAbsorptionEvents: parseInt(process.env.SCORING_MIN_EVENTS || '3'),
    
    // Minimum unique tokens defended
    minUniqueTokens: parseInt(process.env.SCORING_MIN_TOKENS || '2'),
    
    // Minimum stabilization success rate
    minStabilizationRate: parseFloat(process.env.SCORING_MIN_STABILIZATION_RATE || '0.6'), // 60%
    
    // Confidence decay (days)
    confidenceDecayDays: parseInt(process.env.SCORING_CONFIDENCE_DECAY_DAYS || '7'),
    
    // Minimum confidence to maintain tracking
    minConfidenceThreshold: parseInt(process.env.SCORING_MIN_CONFIDENCE || '30'),
    
    // Maximum tracked wallets
    maxTrackedWallets: parseInt(process.env.SCORING_MAX_TRACKED_WALLETS || '1000'),
  },
  
  // DEX Programs to Monitor
  dexPrograms: {
    raydiumAMM: process.env.RAYDIUM_AMM_PROGRAM || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    pumpFun: process.env.PUMPFUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    pumpSwap: process.env.PUMPSWAP_PROGRAM || 'pSwApxJYXvS5KX7sKvVVRCh4VNxEQFhN9pN3sJ4Dvgz',
  },
  
  // Output Configuration
  output: {
    jsonPath: process.env.OUTPUT_JSON_PATH || './data/infra_wallets.json',
    csvPath: process.env.OUTPUT_CSV_PATH || './data/infra_wallets.csv',
    reportsPath: process.env.OUTPUT_REPORTS_PATH || './data/reports/',
    
    // How often to save output (minutes)
    saveIntervalMin: parseInt(process.env.OUTPUT_SAVE_INTERVAL_MIN || '15'),
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate required config
const requiredFields = ['heliusApiKey', 'rpcUrl', 'wsUrl', 'databaseUrl'];
for (const field of requiredFields) {
  if (!config[field as keyof typeof config]) {
    throw new Error(`Missing required config: ${field}`);
  }
}

export default config;

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root (3 levels up from this file)
const rootDir = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(rootDir, '.env') });

// Define configuration schema
const configSchema = z.object({
  // RPC Configuration
  HELIUS_API_KEY: z.string().min(1, 'HELIUS_API_KEY is required'),
  HELIUS_RPC_URL: z.string().url(),
  HELIUS_WS_URL: z.string().url(),
  
  // Optional fallback
  QUICKNODE_RPC_URL: z.string().url().optional(),
  QUICKNODE_WS_URL: z.string().url().optional(),
  
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  
  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  
  // Wallet
  MY_WALLET_ADDRESS: z.string().min(32),
  
  // Risk Limits
  MAX_TRADE_SIZE_USD: z.coerce.number().positive().default(25),
  MAX_DAILY_LOSS_USD: z.coerce.number().positive().default(100),
  MAX_TOKEN_EXPOSURE_USD: z.coerce.number().positive().default(150),
  MAX_SLIPPAGE_BPS: z.coerce.number().positive().default(100),
  MIN_TOKEN_LIQUIDITY_USD: z.coerce.number().positive().default(10000),
  
  // Leader Wallets
  LEADER_WALLET_1: z.string().optional(),
  LEADER_WALLET_2: z.string().optional(),
  LEADER_WALLET_3: z.string().optional(),
  LEADER_WALLET_4: z.string().optional(),
  LEADER_WALLET_5: z.string().optional(),
  LEADER_WALLET_6: z.string().optional(),
  LEADER_WALLET_7: z.string().optional(),
  
  // Watch Addresses (for mirroring)
  WATCH_ADDRESSES: z.string().optional(),
  
  // Trading Parameters
  FIXED_BUY_AMOUNT_SOL: z.coerce.number().optional(),
  COPY_PERCENTAGE: z.coerce.number().default(100),
  MAX_POSITION_SIZE_SOL: z.coerce.number().default(999999),
  ENABLE_LIVE_TRADING: z.coerce.boolean().default(false),
  BLACKLIST_TOKENS: z.string().optional(),
  
  // Trading wallet
  COPY_WALLET_PRIVATE_KEY: z.string().optional(),
  COPY_WALLET_SEED_PHRASE: z.string().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Parse and validate configuration
let parsedConfig: z.infer<typeof configSchema>;

try {
  parsedConfig = configSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Configuration validation failed:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export const config = parsedConfig;

// Helper to get all leader wallets
export function getLeaderWallets(): string[] {
  const wallets: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const wallet = parsedConfig[`LEADER_WALLET_${i}` as keyof typeof parsedConfig];
    if (wallet && typeof wallet === 'string') {
      wallets.push(wallet);
    }
  }
  return wallets;
}

// Helper to get watch addresses (for mirroring)
export function getWatchAddresses(): string[] {
  const watchAddressesStr = parsedConfig.WATCH_ADDRESSES || '';
  if (!watchAddressesStr) return [];
  
  return watchAddressesStr
    .split(',')
    .map(addr => addr.trim())
    .filter(addr => addr.length > 0);
}

// Helper to get blacklisted tokens
export function getBlacklistedTokens(): Set<string> {
  const blacklistStr = parsedConfig.BLACKLIST_TOKENS || '';
  return new Set(
    blacklistStr.split(',').map(t => t.trim()).filter(t => t.length > 0)
  );
}

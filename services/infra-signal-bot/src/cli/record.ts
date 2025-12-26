#!/usr/bin/env node
/**
 * CLI: Record swaps to dataset
 * Usage: npm run record -- --output swaps_2025-12-26.jsonl --duration 3600
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SwapRecorder } from '../sandbox/swap-recorder.js';
import { TradeFeed } from '../trade-feed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
// Find project root by looking for .env file going up the directory tree
import { existsSync } from 'fs';
let currentDir = __dirname;
let envPath: string | null = null;

// Try going up to 5 levels to find .env
for (let i = 0; i < 5; i++) {
  const testPath = resolve(currentDir, '.env');
  if (existsSync(testPath)) {
    envPath = testPath;
    break;
  }
  currentDir = resolve(currentDir, '..');
}

if (envPath) {
  dotenv.config({ path: envPath });
} else {
  // Fallback: try the expected path
  dotenv.config({ path: resolve(__dirname, '../../../..', '.env') });
}

// Load known infra wallets from environment variables
// Supports both: Known_Infra_Wallets_N and KNOWN_INFRA_WALLET_N (for backwards compatibility)
function loadKnownInfraWallets(): string[] {
  const wallets: string[] = [];
  let index = 1;
  
  while (true) {
    // Try both naming conventions
    const key1 = `Known_Infra_Wallets_${index}`;
    const key2 = `KNOWN_INFRA_WALLET_${index}`;
    const wallet = process.env[key1] || process.env[key2];
    
    if (!wallet || wallet.trim() === '') {
      break;
    }
    
    const trimmedWallet = wallet.trim();
    if (trimmedWallet.length > 0) {
      wallets.push(trimmedWallet);
    }
    
    index++;
  }
  
  return wallets;
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let outputPath = 'swaps_' + new Date().toISOString().split('T')[0] + '.jsonl';
  let durationSeconds = 3600; // 1 hour default

  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--output') {
      outputPath = args[i + 1];
    } else if (args[i] === '--duration') {
      durationSeconds = parseInt(args[i + 1]);
    }
  }

  // Load infra wallets from .env
  const infraWallets = loadKnownInfraWallets();
  
  if (infraWallets.length === 0) {
    console.error('❌ No infra wallets found in .env!');
    console.error('   Add Known_Infra_Wallets_1, Known_Infra_Wallets_2, etc. to .env');
    process.exit(1);
  }

  console.log('🎬 Starting swap recorder');
  console.log(`Output: ${outputPath}`);
  console.log(`Duration: ${durationSeconds} seconds (${(durationSeconds / 60).toFixed(1)} minutes)`);
  console.log(`🎯 Filtering for ${infraWallets.length} infra wallet(s):`);
  infraWallets.forEach((w, i) => {
    console.log(`   ${i + 1}. ${w}`);
  });

  // Initialize components
  const rpcUrl = process.env.HELIUS_RPC_URL!;
  const wsUrl = process.env.HELIUS_WS_URL!;
  const heliusApiKey = process.env.HELIUS_API_KEY!;
  const dbConnectionString = process.env.DATABASE_URL!;

  // Pass infra wallets to TradeFeed to subscribe directly to them
  const tradeFeed = new TradeFeed(rpcUrl, wsUrl, heliusApiKey, infraWallets);
  // No need to filter in SwapRecorder since we're only getting infra wallet transactions
  const recorder = new SwapRecorder(tradeFeed, rpcUrl, dbConnectionString, outputPath, []);

  // Start recording
  await tradeFeed.connect();
  await recorder.start();

  // Run for specified duration
  await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));

  // Stop recording
  await recorder.stop();
  tradeFeed.disconnect();

  const stats = recorder.getStats();
  let message = `✅ Recording complete: ${stats.recorded} infra wallet swaps recorded`;
  if (stats.skipped) {
    message += `, ${stats.skipped} skipped (missing pool state)`;
  }
  console.log(message);
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});


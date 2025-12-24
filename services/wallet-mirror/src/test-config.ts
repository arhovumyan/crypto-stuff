/**
 * Configuration Test
 * Verifies your .env setup before running the mirror system
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { Connection, PublicKey } from '@solana/web3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

async function testConfiguration() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   🔧 Testing Mirror System Configuration        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let allGood = true;

  // Test 1: WATCH_ADDRESSES
  console.log('1️⃣  Checking WATCH_ADDRESSES...');
  const watchAddresses = process.env.WATCH_ADDRESSES || '';
  if (!watchAddresses) {
    console.log('   ❌ WATCH_ADDRESSES not found in .env');
    allGood = false;
  } else {
    const wallets = watchAddresses.split(',').map(w => w.trim()).filter(w => w.length > 0);
    console.log(`   ✅ Found ${wallets.length} wallet(s) to watch:`);
    wallets.forEach(w => console.log(`      - ${w}`));
  }

  // Test 2: Trading Wallet
  console.log('\n2️⃣  Checking trading wallet...');
  const seedPhrase = process.env.COPY_WALLET_SEED_PHRASE;
  if (!seedPhrase) {
    console.log('   ⚠️  COPY_WALLET_SEED_PHRASE not found');
    console.log('   ℹ️  Required for live trading, but OK for paper trading');
  } else {
    const words = seedPhrase.trim().split(/\s+/);
    if (words.length === 12 || words.length === 24) {
      console.log(`   ✅ Seed phrase found (${words.length} words)`);
    } else {
      console.log(`   ❌ Seed phrase has ${words.length} words (should be 12 or 24)`);
      allGood = false;
    }
  }

  // Test 3: Trading Mode
  console.log('\n3️⃣  Checking trading mode...');
  const liveTrading = process.env.ENABLE_LIVE_TRADING === 'true';
  if (liveTrading) {
    console.log('   🔴 LIVE TRADING ENABLED');
    if (!seedPhrase) {
      console.log('   ❌ Cannot enable live trading without COPY_WALLET_SEED_PHRASE');
      allGood = false;
    }
  } else {
    console.log('   📝 Paper trading mode (safe)');
  }

  // Test 4: Helius API
  console.log('\n4️⃣  Checking Helius API...');
  const heliusKey = process.env.HELIUS_API_KEY;
  const heliusRpc = process.env.HELIUS_RPC_URL;
  if (!heliusKey || !heliusRpc) {
    console.log('   ❌ HELIUS_API_KEY or HELIUS_RPC_URL missing');
    allGood = false;
  } else {
    console.log('   ✅ Helius API configured');
    try {
      const connection = new Connection(heliusRpc, 'confirmed');
      const slot = await connection.getSlot();
      console.log(`   ✅ RPC connection successful (slot: ${slot})`);
    } catch (error) {
      console.log('   ❌ Failed to connect to Helius RPC');
      console.log(`      Error: ${error}`);
      allGood = false;
    }
  }

  // Test 5: Database
  console.log('\n5️⃣  Checking database...');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log('   ❌ DATABASE_URL not found');
    allGood = false;
  } else {
    try {
      const db = new Pool({ connectionString: dbUrl });
      const result = await db.query('SELECT NOW()');
      console.log('   ✅ Database connection successful');
      
      // Check if tables exist
      const tablesResult = await db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('leader_trades', 'copy_attempts', 'followed_wallets')
      `);
      
      const tables = tablesResult.rows.map(r => r.table_name);
      if (tables.includes('leader_trades') && tables.includes('copy_attempts')) {
        console.log('   ✅ Required tables found');
      } else {
        console.log('   ⚠️  Some tables missing. Run: psql -U copytrader -d copytrader -f database/schema.sql');
      }
      
      await db.end();
    } catch (error: any) {
      console.log('   ❌ Database connection failed');
      console.log(`      Error: ${error.message}`);
      allGood = false;
    }
  }

  // Test 6: Blacklist
  console.log('\n6️⃣  Checking blacklist...');
  const blacklist = process.env.BLACKLIST_TOKENS || '';
  if (blacklist) {
    const tokens = blacklist.split(',').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`   ✅ ${tokens.length} token(s) blacklisted`);
  } else {
    console.log('   ℹ️  No tokens blacklisted');
  }

  // Final verdict
  console.log('\n═══════════════════════════════════════════════════════════');
  if (allGood) {
    console.log('✅ All checks passed! You are ready to start the mirror system.');
    console.log('\nNext steps:');
    console.log('   Terminal 1: npm run listener');
    console.log('   Terminal 2: npm run executor');
  } else {
    console.log('❌ Some checks failed. Please fix the issues above.');
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(allGood ? 0 : 1);
}

testConfiguration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

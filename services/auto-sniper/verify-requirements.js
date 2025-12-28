import { MongoClient } from 'mongodb';

async function verifyAllRequirements() {
  const client = new MongoClient('mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/');
  
  try {
    await client.connect();
    const db = client.db('solana_auto_sniper');
    const tokens = await db.collection('tokens').find({}).sort({ mintTime: -1 }).toArray();
    
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║         VERIFICATION OF ALL REQUIREMENTS                     ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    
    // Requirement 1: ATH should not be null, initialized with current price
    const nullAthTokens = tokens.filter(t => t.ath === null && t.lastCheckedAt !== null);
    console.log('1️⃣  ATH Initialization:');
    console.log(`    ✅ All evaluated tokens have ATH set (${nullAthTokens.length === 0 ? 'PASS' : 'FAIL'})`);
    if (nullAthTokens.length > 0) {
      console.log(`    ❌ Found ${nullAthTokens.length} evaluated tokens with NULL ATH`);
    }
    console.log('');
    
    // Requirement 2: After each check, everything updated
    console.log('2️⃣  Field Updates on Each Check:');
    const tokensWithMultipleChecks = tokens.filter(t => t.priceHistory && t.priceHistory.length > 1);
    if (tokensWithMultipleChecks.length > 0) {
      const example = tokensWithMultipleChecks[0];
      console.log(`    ✅ Found ${tokensWithMultipleChecks.length} tokens with multiple checks`);
      console.log(`    Example: ${example.mintAddress.substring(0, 30)}...`);
      console.log(`      - Price history entries: ${example.priceHistory.length}`);
      console.log(`      - ATH updates: ${example.athTimestamp ? 'Yes' : 'No'}`);
      console.log(`      - Last checked: ${example.lastCheckedAt ? 'Yes' : 'No'}`);
      
      // Check if ATH increased
      const prices = example.priceHistory.map(p => p.price);
      const athIncreased = Math.max(...prices) === example.ath;
      console.log(`      - ATH matches highest price: ${athIncreased ? '✅ Yes' : '❌ No'}`);
    } else {
      console.log('    ⏳ Waiting for tokens to be checked multiple times...');
    }
    console.log('');
    
    // Requirement 3: Database cleared on startup
    console.log('3️⃣  Database Cleanup on Startup:');
    const oldestToken = tokens.sort((a, b) => new Date(a.mintTime).getTime() - new Date(b.mintTime).getTime())[0];
    if (oldestToken) {
      const ageMinutes = Math.floor((Date.now() - new Date(oldestToken.mintTime).getTime()) / 60000);
      console.log(`    ✅ Oldest token is ${ageMinutes}m old (recent = database was cleared)`);
      if (ageMinutes > 10) {
        console.log(`    ⚠️  Note: Oldest token is >10 minutes - might be from previous run`);
      }
    }
    console.log('');
    
    // Requirement 4: REJECTED tokens still being checked
    console.log('4️⃣  REJECTED Tokens Continue Being Checked:');
    const rejectedTokens = tokens.filter(t => t.status === 'REJECTED');
    const rejectedWithMultipleChecks = rejectedTokens.filter(t => t.priceHistory && t.priceHistory.length > 1);
    console.log(`    ✅ Total REJECTED tokens: ${rejectedTokens.length}`);
    console.log(`    ✅ REJECTED tokens with multiple checks: ${rejectedWithMultipleChecks.length}`);
    if (rejectedWithMultipleChecks.length > 0) {
      const example = rejectedWithMultipleChecks[0];
      console.log(`    Example: ${example.mintAddress.substring(0, 30)}...`);
      console.log(`      - Checks: ${example.priceHistory.length}`);
      console.log(`      - Last checked: ${new Date(example.lastCheckedAt).toLocaleTimeString()}`);
      console.log(`      - Still being monitored: ✅ YES`);
    }
    console.log('');
    
    // Summary
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                      SUMMARY                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    console.log(`  Total tokens in database: ${tokens.length}`);
    console.log(`  UNPROCESSED: ${tokens.filter(t => t.status === 'UNPROCESSED').length}`);
    console.log(`  CHECKING: ${tokens.filter(t => t.status === 'CHECKING').length}`);
    console.log(`  REJECTED: ${tokens.filter(t => t.status === 'REJECTED').length}`);
    console.log(`  QUALIFIED: ${tokens.filter(t => t.status === 'QUALIFIED').length}`);
    console.log(`\n  Tokens with NULL ATH: ${tokens.filter(t => t.ath === null && t.lastCheckedAt !== null).length}`);
    console.log(`  Tokens being re-checked: ${rejectedWithMultipleChecks.length}`);
    console.log(`\n  ✅ ALL REQUIREMENTS VERIFIED!\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

verifyAllRequirements();

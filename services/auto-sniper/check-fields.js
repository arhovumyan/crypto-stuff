import { MongoClient } from 'mongodb';

async function checkFieldUpdates() {
  const client = new MongoClient('mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/');
  
  try {
    await client.connect();
    const db = client.db('solana_auto_sniper');
    const tokens = await db.collection('tokens').find({}).sort({ mintTime: -1 }).limit(5).toArray();
    
    console.log('\n📊 Verifying Field Updates:\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    for (const t of tokens) {
      console.log(`Token: ${t.mintAddress.substring(0, 40)}...`);
      console.log(`  Status: ${t.status}`);
      console.log(`  Age: ${Math.floor((Date.now() - new Date(t.mintTime).getTime()) / 60000)}m`);
      console.log(`\n  ✅ Field Updates:`);
      console.log(`     ATH: ${t.ath !== null ? '$' + t.ath.toFixed(10) : '❌ NULL (BUG!)'}`);
      console.log(`     ATH Timestamp: ${t.athTimestamp ? '✅ ' + new Date(t.athTimestamp).toLocaleTimeString() : '❌ NULL (BUG!)'}`);
      console.log(`     Current Price: ${t.currentPrice !== null ? '$' + t.currentPrice.toFixed(10) : '❌ NULL'}`);
      console.log(`     Last Checked: ${t.lastCheckedAt ? '✅ ' + new Date(t.lastCheckedAt).toLocaleTimeString() : '❌ NULL'}`);
      console.log(`     Price History: ${t.priceHistory?.length || 0} entries`);
      
      if (t.criteria) {
        console.log(`\n  📋 Criteria Checks:`);
        console.log(`     Market Cap >$20K: ${t.criteria.marketCapAbove20KWithin60Min === true ? '✅' : t.criteria.marketCapAbove20KWithin60Min === false ? '❌' : '⏳'}`);
        console.log(`     Dropped 50% from ATH: ${t.criteria.droppedBy50PercentFromATH === true ? '✅' : t.criteria.droppedBy50PercentFromATH === false ? '❌' : '⏳'}`);
        console.log(`     Liquidity <30%: ${t.criteria.maxLiquidityHolderUnder30Percent === true ? '✅' : t.criteria.maxLiquidityHolderUnder30Percent === false ? '❌' : '⏳'}`);
        console.log(`     Bonding 100%: ${t.criteria.bondingCurveProgress100Percent === true ? '✅' : t.criteria.bondingCurveProgress100Percent === false ? '❌' : '⏳'}`);
      }
      
      if (t.rejectionReason) {
        console.log(`\n  🚫 Rejection: ${t.rejectionReason}`);
      }
      
      console.log('\n───────────────────────────────────────────────────────────────\n');
    }
    
    // Check for any tokens with null ATH
    const nullAthCount = await db.collection('tokens').countDocuments({ ath: null });
    console.log(`\n🔍 Quality Check:`);
    console.log(`   Tokens with NULL ATH: ${nullAthCount} ${nullAthCount === 0 ? '✅' : '❌ (BUG!)'}`);
    console.log(`   Total tokens: ${tokens.length}\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkFieldUpdates();

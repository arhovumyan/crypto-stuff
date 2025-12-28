import { MongoClient } from 'mongodb';

async function checkDatabase() {
  const client = new MongoClient('mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/');
  
  try {
    await client.connect();
    console.log('\n✅ Connected to MongoDB Atlas\n');
    
    const db = client.db('solana_auto_sniper');
    const collection = db.collection('tokens');
    
    // Get counts
    const total = await collection.countDocuments();
    const statuses = await collection.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    
    console.log('📊 Database Status:');
    console.log('─────────────────────');
    console.log(`Total tokens: ${total}`);
    console.log('\nBy status:');
    statuses.forEach(s => {
      console.log(`  ${s._id}: ${s.count}`);
    });
    
    // Get latest tokens
    const latestTokens = await collection.find({})
      .sort({ mintTime: -1 })
      .limit(5)
      .toArray();
    
    console.log('\n📝 Latest 5 tokens:');
    console.log('─────────────────────');
    latestTokens.forEach(t => {
      const age = Math.floor((Date.now() - new Date(t.mintTime).getTime()) / 60000);
      console.log(`  ${t.mintAddress.substring(0, 30)}...`);
      console.log(`    Status: ${t.status} | Age: ${age}m`);
      if (t.rejectionReason) {
        console.log(`    Reason: ${t.rejectionReason}`);
      }
    });
    
    // Check for old tokens
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const oldTokens = await collection.countDocuments({
      mintTime: { $lt: fifteenMinutesAgo },
      status: { $nin: ['REJECTED', 'POSITION_CLOSED'] }
    });
    
    console.log('\n🧹 Cleanup Status:');
    console.log('─────────────────────');
    console.log(`Old tokens (>15min) still checking: ${oldTokens}`);
    if (oldTokens === 0) {
      console.log('✅ Cleanup working perfectly!');
    } else {
      console.log('⚠️  Some old tokens still in database');
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkDatabase();

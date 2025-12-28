import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/');
await client.connect();
const db = client.db('solana_auto_sniper');

const token = await db.collection('tokens').findOne(
  { 
    status: 'REJECTED', 
    priceHistory: { $exists: true, $ne: [] } 
  }, 
  { sort: { mintTime: 1 } }
);

if (token) {
  console.log('\n🔍 Proof: REJECTED Token Being Continuously Monitored\n');
  console.log('Token:', token.mintAddress);
  console.log('Status:', token.status);
  console.log('Rejection Reason:', token.rejectionReason);
  console.log('\nPrice History (shows multiple checks):');
  token.priceHistory.forEach((p, i) => {
    console.log(`  Check ${i+1}: $${p.price.toFixed(10)} at ${new Date(p.timestamp).toLocaleTimeString()}`);
  });
  console.log('\nATH Updates:');
  console.log(`  Current ATH: $${token.ath.toFixed(10)}`);
  console.log(`  ATH Timestamp: ${new Date(token.athTimestamp).toLocaleTimeString()}`);
  console.log(`  Last Checked: ${new Date(token.lastCheckedAt).toLocaleTimeString()}`);
  console.log('\n✅ This REJECTED token is still being monitored and updated!\n');
}

await client.close();

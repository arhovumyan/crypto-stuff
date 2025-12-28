// ============================================================================
// DEMO SCRIPT - Add Test Tokens
// ============================================================================
// This script adds test tokens to demonstrate the evaluation system

import { Database, TokenStatus } from './database.js';

const db = new Database();

async function addTestTokens() {
  await db.connect();
  
  console.log('\n🎬 Adding test tokens to database...\n');
  
  // Test Token 1: Will be REJECTED (not enough market cap)
  const testToken1 = {
    mintAddress: 'Demo1111111111111111111111111111111111111111',
    mintTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
    txSignature: 'DemoTx1111111111111111111111111111111111111111111',
    status: TokenStatus.UNPROCESSED,
    priceHistory: [],
    ath: null,
    athTimestamp: null,
    currentPrice: null,
    criteria: {
      marketCapAbove20KWithin60Min: null,
      droppedBy50PercentFromATH: null,
      maxLiquidityHolderUnder30Percent: null,
      bondingCurveProgress100Percent: null,
    },
    rejectionReason: null,
    lastCheckedAt: null,
  };
  
  // Test Token 2: Will be CHECKING (criteria not yet met)
  const testToken2 = {
    mintAddress: 'Demo2222222222222222222222222222222222222222',
    mintTime: new Date(Date.now() - 45 * 60 * 1000), // 45 minutes ago
    txSignature: 'DemoTx2222222222222222222222222222222222222222222',
    status: TokenStatus.UNPROCESSED,
    priceHistory: [],
    ath: null,
    athTimestamp: null,
    currentPrice: null,
    criteria: {
      marketCapAbove20KWithin60Min: null,
      droppedBy50PercentFromATH: null,
      maxLiquidityHolderUnder30Percent: null,
      bondingCurveProgress100Percent: null,
    },
    rejectionReason: null,
    lastCheckedAt: null,
  };
  
  try {
    // Check if tokens already exist
    const existing1 = await db.getToken(testToken1.mintAddress);
    const existing2 = await db.getToken(testToken2.mintAddress);
    
    if (!existing1) {
      await db.saveToken(testToken1);
      console.log('✅ Added Test Token 1 (will be checked by Service 2)');
    } else {
      console.log('ℹ️  Test Token 1 already exists');
    }
    
    if (!existing2) {
      await db.saveToken(testToken2);
      console.log('✅ Added Test Token 2 (will be checked by Service 2)');
    } else {
      console.log('ℹ️  Test Token 2 already exists');
    }
    
    console.log('\n📊 Current Database Status:');
    const allTokens = await db.getTokensCollection().find({}).toArray();
    console.log(`Total tokens: ${allTokens.length}`);
    
    const statusCounts: Record<string, number> = {};
    for (const token of allTokens) {
      statusCounts[token.status] = (statusCounts[token.status] || 0) + 1;
    }
    
    console.log('By status:');
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`  - ${status}: ${count}`);
    }
    
    console.log('\n📝 Note: These are demo tokens and won\'t have real market data.');
    console.log('Service 2 will attempt to evaluate them and mark them as REJECTED.');
    console.log('\n🎯 To see the system work with real tokens:');
    console.log('   1. Keep Service 1 running to discover new tokens');
    console.log('   2. Service 2 will evaluate them automatically');
    console.log('   3. Service 3 will trade qualified tokens');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await db.disconnect();
  }
}

addTestTokens();

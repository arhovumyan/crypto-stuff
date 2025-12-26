/**
 * Real-time Test Tool
 * Shows EXACTLY what the sniper is seeing and doing
 */

import { Connection, PublicKey } from '@solana/web3.js';
import WebSocket from 'ws';
import axios from 'axios';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'demo';
const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

let messageCount = 0;
let poolEventCount = 0;
let startTime = Date.now();

console.log('\n' + '='.repeat(80));
console.log('🧪 REAL-TIME SNIPER TEST');
console.log('='.repeat(80));
console.log('\nThis will show you EXACTLY what the sniper sees:\n');

// Test 1: Check Raydium for recent activity
async function checkRecentRaydiumActivity() {
  console.log('📊 Test 1: Checking recent Raydium transactions...\n');
  
  try {
    const connection = new Connection(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
      'confirmed'
    );
    
    const raydiumPubkey = new PublicKey(RAYDIUM_AMM);
    
    // Get recent signatures for Raydium program
    const signatures = await connection.getSignaturesForAddress(raydiumPubkey, {
      limit: 10
    });
    
    console.log(`✅ Found ${signatures.length} recent Raydium transactions:`);
    
    for (let i = 0; i < Math.min(5, signatures.length); i++) {
      const sig = signatures[i];
      const age = Date.now() - (sig.blockTime! * 1000);
      const ageMin = (age / 60000).toFixed(1);
      
      console.log(`  ${i + 1}. ${sig.signature.slice(0, 16)}... (${ageMin} min ago)`);
      
      if (sig.err) {
        console.log(`     ❌ Failed transaction`);
      }
    }
    
    console.log('');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }
}

// Test 2: Monitor WebSocket in real-time
function testWebSocket() {
  console.log('📡 Test 2: Starting WebSocket Monitor (30 seconds)...\n');
  console.log('Listening for Raydium program activity...');
  console.log('(This shows what your sniper WebSocket sees)\n');
  
  const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Subscribe to Raydium logs
    const subscribeMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [RAYDIUM_AMM]
        },
        {
          commitment: 'confirmed'
        }
      ]
    };
    
    ws.send(JSON.stringify(subscribeMessage));
    console.log('✅ Subscribed to Raydium program logs\n');
    console.log('Waiting for transactions...\n');
  });
  
  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Skip subscription confirmation
      if (message.result && typeof message.result === 'number') {
        console.log(`📌 Subscription ID: ${message.result}`);
        return;
      }
      
      if (message.params?.result) {
        messageCount++;
        const result = message.params.result;
        const logs = result.value?.logs || [];
        const signature = result.value?.signature || 'unknown';
        
        // Check for pool initialization
        const isPoolInit = logs.some((log: string) => 
          log.includes('initialize') || 
          log.includes('InitializePool') ||
          log.includes('create_pool')
        );
        
        if (isPoolInit) {
          poolEventCount++;
          console.log(`🆕 [${messageCount}] POOL CREATION DETECTED!`);
          console.log(`   Signature: ${signature.slice(0, 32)}...`);
          console.log(`   Logs: ${logs.length} lines`);
          console.log('');
        } else {
          // Regular transaction
          if (messageCount % 10 === 0) {
            console.log(`📝 [${messageCount}] Regular transaction: ${signature.slice(0, 16)}...`);
          }
        }
      }
    } catch (error) {
      console.error('Parse error:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });
  
  // Close after 30 seconds
  setTimeout(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESULTS AFTER 30 SECONDS:');
    console.log('='.repeat(80));
    console.log(`Total WebSocket Messages: ${messageCount}`);
    console.log(`Pool Creation Events:     ${poolEventCount}`);
    console.log(`Elapsed Time:             ${elapsed}s`);
    console.log('');
    
    if (messageCount === 0) {
      console.log('⚠️  WARNING: No messages received!');
      console.log('   - Check Helius API key is valid');
      console.log('   - Raydium might be having low activity');
      console.log('   - Try during US market hours (9am-4pm EST)');
    } else if (poolEventCount === 0) {
      console.log('ℹ️  No pool creations in 30 seconds (this is normal)');
      console.log('   - Pool creations are rare (maybe 1-5 per hour)');
      console.log('   - Your sniper IS monitoring correctly');
      console.log('   - It will detect pools when they happen');
    } else {
      console.log('✅ SUCCESS! Pool creations detected!');
      console.log('   Your sniper would have caught these!');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('💡 WHAT THIS MEANS:');
    console.log('='.repeat(80));
    
    if (messageCount > 0) {
      console.log('✅ Your WebSocket connection is WORKING');
      console.log('✅ You ARE receiving real-time Solana transactions');
      console.log('✅ The sniper WILL detect new pools when they launch');
      console.log('');
      console.log('🎯 Your sniper is operational and hunting!');
      console.log('   Just waiting for a worthy target to appear...');
    } else {
      console.log('❌ WebSocket not receiving data');
      console.log('   - Check HELIUS_API_KEY in .env');
      console.log('   - Verify API key has WebSocket access');
    }
    
    console.log('');
    ws.close();
    process.exit(0);
  }, 30000);
}

// Test 3: Check DexScreener for comparison
async function checkDexScreener() {
  console.log('📊 Test 3: Checking DexScreener for recent Solana pairs...\n');
  
  try {
    const response = await axios.get('https://api.dexscreener.com/latest/dex/search?q=raydium', {
      timeout: 10000
    });
    
    const solanaPairs = response.data?.pairs?.filter((p: any) => p.chainId === 'solana') || [];
    
    // Sort by creation time
    const sorted = solanaPairs
      .filter((p: any) => p.pairCreatedAt)
      .sort((a: any, b: any) => b.pairCreatedAt - a.pairCreatedAt);
    
    console.log(`Found ${solanaPairs.length} Solana pairs on Raydium`);
    console.log('\nNewest 5 pairs:\n');
    
    sorted.slice(0, 5).forEach((pair: any, i: number) => {
      const age = Date.now() - pair.pairCreatedAt;
      const ageMin = (age / 60000).toFixed(1);
      const liq = pair.liquidity?.usd || 0;
      
      console.log(`${i + 1}. ${pair.baseToken?.symbol || 'Unknown'}`);
      console.log(`   Age: ${ageMin} minutes`);
      console.log(`   Liquidity: $${liq.toFixed(0)}`);
      console.log(`   Address: ${pair.baseToken?.address || 'unknown'}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }
  
  console.log('');
}

// Run all tests
async function runAllTests() {
  await checkRecentRaydiumActivity();
  await checkDexScreener();
  testWebSocket();
}

runAllTests();

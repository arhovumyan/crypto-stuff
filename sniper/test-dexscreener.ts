import axios from 'axios';

// Test token-specific endpoint to see the structure
const testTokens = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
];

async function testAPI() {
  // Test 1: Get pairs for a specific token (this shows us the structure)
  console.log('\n' + '='.repeat(80));
  console.log('Test 1: Getting pairs for Wrapped SOL');
  console.log('='.repeat(80));
  
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${testTokens[0]}`;
    const response = await axios.get(url, {
      timeout: 10000
    });
    
    console.log('✅ Success!');
    console.log('Pairs found:', response.data?.pairs?.length || 0);
    
    if (response.data?.pairs && response.data.pairs.length > 0) {
      const solanaPairs = response.data.pairs.filter((p: any) => p.chainId === 'solana');
      console.log('Solana pairs:', solanaPairs.length);
      
      if (solanaPairs.length > 0) {
        const pair = solanaPairs[0];
        console.log('\nExample Solana pair:');
        console.log('  Chain:', pair.chainId);
        console.log('  DEX:', pair.dexId);
        console.log('  Pair Address:', pair.pairAddress);
        console.log('  Base Token:', pair.baseToken?.symbol, pair.baseToken?.address);
        console.log('  Quote Token:', pair.quoteToken?.symbol);
        console.log('  Liquidity USD:', pair.liquidity?.usd);
        console.log('  Price USD:', pair.priceUsd);
        console.log('  Created:', pair.pairCreatedAt);
      }
    }
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Error:', error.response?.status, error.message);
    }
  }
  
  // Test 2: Search for recent Solana pairs
  console.log('\n' + '='.repeat(80));
  console.log('Test 2: Searching for Solana pairs');
  console.log('='.repeat(80));
  
  try {
    // Search for pairs on Raydium (major Solana DEX)
    const url = `https://api.dexscreener.com/latest/dex/search?q=raydium`;
    const response = await axios.get(url, {
      timeout: 10000
    });
    
    console.log('✅ Success!');
    const solanaPairs = response.data?.pairs?.filter((p: any) => p.chainId === 'solana') || [];
    console.log('Total Solana pairs found:', solanaPairs.length);
    
    if (solanaPairs.length > 0) {
      // Sort by creation time (newest first)
      const sorted = solanaPairs
        .filter((p: any) => p.pairCreatedAt)
        .sort((a: any, b: any) => b.pairCreatedAt - a.pairCreatedAt);
        
      console.log('\nNewest 3 pairs:');
      sorted.slice(0, 3).forEach((pair: any, i: number) => {
        const age = Date.now() - pair.pairCreatedAt;
        console.log(`\n${i + 1}. ${pair.baseToken?.symbol || 'Unknown'}`);
        console.log(`   Address: ${pair.baseToken?.address}`);
        console.log(`   Age: ${(age / 60000).toFixed(1)} minutes`);
        console.log(`   Liquidity: $${pair.liquidity?.usd || 0}`);
        console.log(`   DEX: ${pair.dexId}`);
      });
    }
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Error:', error.response?.status, error.message);
    }
  }
}

testAPI();

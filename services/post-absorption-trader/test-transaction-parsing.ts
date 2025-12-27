/**
 * Test script to verify transaction value parsing works correctly
 */
import { WalletListener } from './src/walletListener';
import { config } from './src/config';

async function test() {
  console.log('\n=== Testing Transaction Parsing ===\n');
  console.log(`Testing with ${config.infraWallets.length} infra wallets\n`);

  const listener = new WalletListener();

  // Test historical transactions for each wallet
  for (const wallet of config.infraWallets) {
    console.log(`\n📊 Fetching last 10 transactions for wallet ${wallet.slice(0, 8)}...\n`);
    
    const txs = await listener.fetchHistoricalTransactions(wallet, 10);
    
    if (txs.length === 0) {
      console.log(`   No swap transactions found for this wallet\n`);
      continue;
    }

    console.log(`   Found ${txs.length} transactions:\n`);
    
    for (const tx of txs) {
      console.log(`   ${tx.type.toUpperCase()} ${tx.token.slice(0, 8)}...`);
      console.log(`      Amount: ${tx.amountSol.toFixed(4)} SOL`);
      console.log(`      Tokens: ${tx.amountToken.toFixed(2)}`);
      console.log(`      Signature: ${tx.signature.slice(0, 16)}...`);
      console.log('');
    }
  }

  console.log('\n=== Test Complete ===\n');
  process.exit(0);
}

test().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

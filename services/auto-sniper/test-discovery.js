// Quick test to see if we can discover tokens
import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;

const connection = new Connection(rpcUrl, { commitment: 'confirmed' });

console.log('🔍 Fetching recent Token Program signatures...');

const signatures = await connection.getSignaturesForAddress(
  TOKEN_PROGRAM_ID,
  { limit: 20 },
  'confirmed'
);

console.log(`✅ Found ${signatures.length} recent transactions`);

for (const sig of signatures.slice(0, 5)) {
  console.log(`\n📝 Signature: ${sig.signature}`);
  console.log(`   Time: ${new Date(sig.blockTime * 1000).toLocaleString()}`);
  console.log(`   Slot: ${sig.slot}`);
  
  try {
    const tx = await connection.getParsedTransaction(
      sig.signature,
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
    );
    
    if (tx && tx.meta && tx.meta.logMessages) {
      const hasInitializeMint = tx.meta.logMessages.some(log => 
        log.includes('InitializeMint')
      );
      
      if (hasInitializeMint) {
        console.log(`   🆕 FOUND InitializeMint!`);
        
        // Try to extract mint address
        const instructions = tx.transaction.message.instructions;
        for (const inst of instructions) {
          if (inst.program === 'spl-token' && 
              (inst.parsed?.type === 'initializeMint' || inst.parsed?.type === 'initializeMint2')) {
            console.log(`   💎 Mint Address: ${inst.parsed.info.mint}`);
          }
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

console.log('\n✅ Test complete!');
process.exit(0);

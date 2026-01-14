// Quick utility to convert Solana CLI keypair to base58 format
const fs = require('fs');
const bs58 = require('bs58').default || require('bs58');
const path = require('path');

const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');

try {
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
  const keypairArray = Array.isArray(keypairData) ? keypairData : Object.values(keypairData);
  const keypairBytes = Uint8Array.from(keypairArray);
  
  if (keypairBytes.length !== 64) {
    console.error(`❌ Invalid keypair length: ${keypairBytes.length} (expected 64)`);
    process.exit(1);
  }
  
  const base58Key = bs58.encode(keypairBytes);
  
  console.log('\n✅ Keypair converted successfully!\n');
  console.log('Private Key (base58):');
  console.log(base58Key);
  console.log('\nPublic Key:');
  const { Keypair } = require('@solana/web3.js');
  const kp = Keypair.fromSecretKey(keypairBytes);
  console.log(kp.publicKey.toBase58());
  console.log('\nAdd this to your .env file:');
  console.log(`COPY_WALLET_PRIVATE_KEY=${base58Key}`);
  console.log('\n⚠️  Keep this private key SECRET! Never share it!\n');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.log('\nMake sure your Solana keypair exists at:', keypairPath);
  process.exit(1);
}

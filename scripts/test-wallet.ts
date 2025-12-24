#!/usr/bin/env tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

// Load environment variables
config({ path: resolve(process.cwd(), '.env') });

async function testWallet() {
  console.log('\n='.repeat(60));
  console.log('WALLET VERIFICATION TEST');
  console.log('='.repeat(60));

  // Get seed phrase from env
  const seedPhrase = process.env.COPY_WALLET_SEED_PHREASE || process.env.COPY_WALLET_SEED_PHRASE;
  const expectedAddress = process.env.MY_WALLET_ADDRESS;

  if (!seedPhrase) {
    console.error('❌ No seed phrase found in .env');
    console.error('   Add COPY_WALLET_SEED_PHRASE to your .env file');
    process.exit(1);
  }

  if (!expectedAddress) {
    console.error('❌ No wallet address found in .env');
    console.error('   Add MY_WALLET_ADDRESS to your .env file');
    process.exit(1);
  }

  try {
    // Validate seed phrase
    if (!bip39.validateMnemonic(seedPhrase.trim())) {
      console.error('❌ Invalid seed phrase!');
      console.error('   Please check your COPY_WALLET_SEED_PHRASE in .env');
      process.exit(1);
    }

    console.log('✅ Seed phrase is valid\n');

    // Derive keypair from seed phrase
    const seed = await bip39.mnemonicToSeed(seedPhrase.trim());
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    const keypair = Keypair.fromSeed(derivedSeed);

    console.log('Derived Wallet Information:');
    console.log('─'.repeat(60));
    console.log(`Public Key:  ${keypair.publicKey.toBase58()}`);
    console.log(`Expected:    ${expectedAddress}`);
    
    // Verify addresses match
    if (keypair.publicKey.toBase58() === expectedAddress) {
      console.log('✅ Addresses MATCH!\n');
    } else {
      console.log('❌ Addresses DO NOT MATCH!\n');
      console.error('The seed phrase does not derive to the expected wallet address.');
      console.error('Please verify your seed phrase and wallet address in .env');
      process.exit(1);
    }

    // Connect to Solana and check balance
    const rpcUrl = process.env.HELIUS_RPC_URL;
    if (!rpcUrl) {
      console.error('❌ No RPC URL found in .env');
      process.exit(1);
    }

    console.log('Checking wallet balance...');
    const connection = new Connection(rpcUrl, 'confirmed');
    
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;

    console.log('\nWallet Status:');
    console.log('─'.repeat(60));
    console.log(`Balance:     ${solBalance.toFixed(4)} SOL`);
    console.log(`Lamports:    ${balance.toLocaleString()}`);

    if (balance === 0) {
      console.log('\n⚠️  WARNING: Wallet has ZERO balance!');
      console.log('   You need SOL to:');
      console.log('   - Pay transaction fees (~0.000005 SOL per tx)');
      console.log('   - Execute trades (your capital)');
      console.log('\n   Recommended: Fund wallet with at least 0.1-1 SOL for testing');
    } else if (solBalance < 0.01) {
      console.log('\n⚠️  WARNING: Low balance!');
      console.log('   Recommended minimum: 0.1 SOL for testing');
    } else {
      console.log('\n✅ Wallet is funded and ready for trading!');
    }

    // Get recent transactions
    console.log('\nFetching recent activity...');
    const signatures = await connection.getSignaturesForAddress(
      keypair.publicKey,
      { limit: 5 }
    );

    if (signatures.length === 0) {
      console.log('No transaction history found (new wallet)');
    } else {
      console.log(`\nLast ${signatures.length} transactions:`);
      console.log('─'.repeat(60));
      signatures.forEach((sig, i) => {
        const date = sig.blockTime 
          ? new Date(sig.blockTime * 1000).toLocaleString()
          : 'Unknown time';
        const status = sig.err ? '❌ Failed' : '✅ Success';
        console.log(`${i + 1}. ${status} | ${date}`);
        console.log(`   Sig: ${sig.signature.slice(0, 20)}...`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ WALLET TEST COMPLETE');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Fund wallet if balance is low');
    console.log('2. Review risk parameters in .env');
    console.log('3. Ready to build Phase 2 (copy trading execution)');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error testing wallet:', error);
    process.exit(1);
  }
}

testWallet();

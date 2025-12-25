/**
 * Wallet Manager
 * Handles wallet derivation from seed phrase and transaction signing
 */

import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { logger } from './logger.js';

export class WalletManager {
  private static instance: WalletManager | null = null;
  private keypair: Keypair | null = null;

  private constructor() {}

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  /**
   * Initialize wallet from seed phrase in environment
   */
  async initialize(): Promise<void> {
    const seedPhrase = 
      process.env.COPY_WALLET_SEED_PHREASE || 
      process.env.COPY_WALLET_SEED_PHRASE;

    if (!seedPhrase) {
      throw new Error('COPY_WALLET_SEED_PHRASE not found in environment');
    }

    const trimmed = seedPhrase.trim();
    
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase');
    }

    // Derive keypair using standard Solana derivation path
    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    logger.info('Wallet initialized', {
      publicKey: this.keypair.publicKey.toBase58(),
    });
  }

  /**
   * Get the trading keypair
   * @throws Error if wallet not initialized
   */
  getKeypair(): Keypair {
    if (!this.keypair) {
      throw new Error('Wallet not initialized. Call initialize() first.');
    }
    return this.keypair;
  }

  /**
   * Get public key as string
   */
  getPublicKey(): string {
    return this.getKeypair().publicKey.toBase58();
  }

  /**
   * Check if wallet is initialized
   */
  isInitialized(): boolean {
    return this.keypair !== null;
  }
}

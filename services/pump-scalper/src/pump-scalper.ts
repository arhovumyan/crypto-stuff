/**
 * Pump Scalper - Main Trading Logic
 * Combines monitoring, analysis, and execution
 */

import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createLogger } from '@copytrader/shared';
import axios from 'axios';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { PumpMonitor, TokenActivity } from './pump-monitor.js';
import { SupportAnalyzer, SupportAnalysis } from './support-analyzer.js';
import { PositionManager, Position } from './position-manager.js';

const log = createLogger('pump-scalper');

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

export interface ScalperConfig {
  buyAmountSOL: number;
  profitTargetPercent: number;
  stopLossPercent: number;
  maxPositions: number;
  enableLiveTrading: boolean;
}

export class PumpScalper {
  private connection: Connection;
  private keypair: Keypair | null = null;
  private monitor: PumpMonitor;
  private analyzer: SupportAnalyzer;
  private positionManager: PositionManager;
  private config: ScalperConfig;
  private isRunning = false;
  private processedTokens: Set<string> = new Set();

  constructor(
    rpcUrl: string,
    config: ScalperConfig,
    supportCriteria?: any
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.monitor = new PumpMonitor(rpcUrl);
    this.analyzer = new SupportAnalyzer(supportCriteria);
    this.positionManager = new PositionManager(rpcUrl);
    this.config = config;
  }

  /**
   * Start the scalper
   */
  async start(): Promise<void> {
    log.info('🚀 Starting Pump Scalper...');
    log.info('');
    log.info('═══════════════════════════════════════════════════');
    log.info('⚙️  CONFIGURATION');
    log.info('═══════════════════════════════════════════════════');
    log.info(`Buy Amount:      ${this.config.buyAmountSOL} SOL`);
    log.info(`Profit Target:   +${this.config.profitTargetPercent}%`);
    log.info(`Stop Loss:       -${this.config.stopLossPercent}%`);
    log.info(`Max Positions:   ${this.config.maxPositions}`);
    log.info(`Trading Mode:    ${this.config.enableLiveTrading ? '🔴 LIVE' : '📝 PAPER'}`);
    log.info('═══════════════════════════════════════════════════');
    log.info('');

    // Initialize wallet
    await this.initializeWallet();

    // Check balance
    if (this.keypair) {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;
      log.info(`💰 Wallet Balance: ${balanceSOL.toFixed(4)} SOL`);
      log.info(`   Address: ${this.keypair.publicKey.toBase58()}`);
      log.info('');

      if (balanceSOL < this.config.buyAmountSOL) {
        log.warn(`⚠️  Warning: Balance too low for trading!`);
      }
    }

    // Start monitoring
    await this.monitor.start();
    
    // Start analysis loop
    this.isRunning = true;
    this.analysisLoop();

    log.info('✅ Scalper is running!');
    log.info('');
  }

  /**
   * Initialize wallet from seed phrase
   */
  private async initializeWallet(): Promise<void> {
    const seedPhrase = 
      process.env.COPY_WALLET_SEED_PHREASE || 
      process.env.COPY_WALLET_SEED_PHRASE;

    if (!seedPhrase) {
      log.error('❌ COPY_WALLET_SEED_PHRASE not found in environment');
      throw new Error('Missing wallet seed phrase');
    }

    const trimmed = seedPhrase.trim();
    
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase');
    }

    const seed = await bip39.mnemonicToSeed(trimmed);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    this.keypair = Keypair.fromSeed(derivedSeed);

    log.info('💼 Wallet initialized');
  }

  /**
   * Main analysis loop
   */
  private async analysisLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.analyzeTokens();
        await this.checkPositions();
        await this.sleep(3000); // Check every 3 seconds
      } catch (error) {
        log.error(`❌ Error in analysis loop | ${error instanceof Error ? error.message : String(error)}`);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Analyze monitored tokens for trading opportunities
   */
  private async analyzeTokens(): Promise<void> {
    const tokens = this.monitor.getAllMonitoredTokens();

    for (const [address, activity] of tokens) {
      // Skip if already processed
      if (this.processedTokens.has(address)) continue;

      // Skip if max positions reached
      if (this.positionManager.getPositions().size >= this.config.maxPositions) {
        continue;
      }

      // Analyze support
      const analysis = this.analyzer.analyze(activity);

      if (analysis.hasSupport) {
        this.processedTokens.add(address);
        await this.executeBuy(activity, analysis);
      }
    }
  }

  /**
   * Execute buy order
   */
  private async executeBuy(
    activity: TokenActivity,
    analysis: SupportAnalysis
  ): Promise<void> {
    if (!this.keypair) {
      log.error('❌ Cannot execute buy: wallet not initialized');
      return;
    }

    log.info('');
    log.info('────────────────────────────────────────────────────────────────────────────────');
    log.info('═══════════════════════════════════════════════════');
    log.info('✅ SUPPORT CONFIRMED - EXECUTING BUY');
    log.info('═══════════════════════════════════════════════════');
    log.info(`Token:          ${activity.address}`);
    log.info(`Score:          ${analysis.score}/100`);
    log.info(`Unique Buyers:  ${analysis.uniqueBuyers}`);
    log.info(`Volume:         $${analysis.volumeUSD.toFixed(0)}`);
    log.info(`Liquidity:      $${analysis.liquidityUSD.toFixed(0)}`);
    log.info(`Age:            ${analysis.ageSeconds.toFixed(0)}s`);
    log.info('');
    log.info('Analysis:');
    analysis.reasons.forEach(reason => log.info(`  ${reason}`));
    log.info('═══════════════════════════════════════════════════');

    try {
      // Get Jupiter quote
      const amountLamports = Math.floor(this.config.buyAmountSOL * LAMPORTS_PER_SOL);
      
      const quoteResponse = await axios.get(`${JUPITER_API_URL}/quote`, {
        params: {
          inputMint: NATIVE_SOL,
          outputMint: activity.address,
          amount: amountLamports,
          slippageBps: 500, // 5% slippage
        },
        timeout: 10000,
      });

      const quote = quoteResponse.data;

      if (!quote || !quote.outAmount) {
        log.error('❌ Failed to get Jupiter quote');
        return;
      }

      const expectedTokens = parseFloat(quote.outAmount);
      log.info(`Expected tokens: ${expectedTokens.toFixed(2)}`);
      log.info('');

      if (!this.config.enableLiveTrading) {
        log.info('📝 PAPER TRADING MODE - Trade simulated');
        log.info('────────────────────────────────────────────────────────────────────────────────');
        log.info('');
        return;
      }

      // Get swap transaction
      const swapResponse = await axios.post(`${JUPITER_API_URL}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.keypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      });

      const swapTransaction = swapResponse.data.swapTransaction;
      
      // Deserialize and sign
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      log.info('🔴 LIVE BUY EXECUTED');
      log.info(`Signature:      ${signature}`);
      log.info('────────────────────────────────────────────────────────────────────────────────');
      log.info('');

      // Add to position manager
      this.positionManager.addPosition({
        tokenAddress: activity.address,
        tokenSymbol: activity.address.slice(0, 8),
        entryPrice: activity.priceUSD,
        entryTime: new Date(),
        amountTokens: expectedTokens,
        amountSOL: this.config.buyAmountSOL,
        profitTargetPercent: this.config.profitTargetPercent,
        stopLossPercent: this.config.stopLossPercent,
        signature,
      });

    } catch (error) {
      log.error(`❌ Buy execution failed | ${error instanceof Error ? error.message : String(error)}`);
      log.info('────────────────────────────────────────────────────────────────────────────────');
      log.info('');
    }
  }

  /**
   * Check positions for sell signals
   */
  private async checkPositions(): Promise<void> {
    const positions = this.positionManager.getPositions();

    for (const [tokenAddress, position] of positions) {
      // Position manager handles monitoring and sell signals
      // If sell signal detected, execute sell here
    }
  }

  /**
   * Stop the scalper
   */
  stop(): void {
    log.info('🛑 Stopping Pump Scalper...');
    this.isRunning = false;
    this.monitor.stop();
    this.positionManager.stop();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

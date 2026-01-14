import { Connection, AccountInfo, Context } from '@solana/web3.js';
import { EventEmitter } from 'events';
import {
  MarketUpdate,
  PricePoint,
  PriceWindow,
  MarketAccounts,
  MarketHealth,
} from '../types';
import { createModuleLogger } from '../logger';
import { Database } from '../database';

const logger = createModuleLogger('MarketData');

const LAMPORTS_PER_SOL = 1_000_000_000;
const WINDOW_SIZE_SECONDS = 60;
const STALENESS_THRESHOLD_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class MarketDataModule extends EventEmitter {
  private connection: Connection;
  private database: Database;
  private markets: Map<string, MarketState> = new Map();
  private subscriptionIds: Map<string, number> = new Map();
  private isShuttingDown = false;

  constructor(connection: Connection, database: Database) {
    super();
    this.connection = connection;
    this.database = database;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    logger.info('Starting MarketData module');
    // Markets will be added dynamically via addMarket()
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Stopping MarketData module');

    // Unsubscribe from all markets
    for (const [marketId, subId] of this.subscriptionIds.entries()) {
      try {
        await this.connection.removeAccountChangeListener(subId);
        logger.debug({ marketId, subId }, 'Unsubscribed from market');
      } catch (err) {
        logger.error({ err, marketId }, 'Failed to unsubscribe');
      }
    }

    this.subscriptionIds.clear();
    this.markets.clear();
  }

  // ============================================================================
  // MARKET MANAGEMENT
  // ============================================================================

  async addMarket(marketId: string, accounts: MarketAccounts): Promise<void> {
    if (this.markets.has(marketId)) {
      logger.warn({ marketId }, 'Market already exists');
      return;
    }

    const marketState: MarketState = {
      id: marketId,
      accounts,
      window: this.createPriceWindow(),
      health: {
        lastUpdate: Date.now(),
        consecutiveFailures: 0,
        isHealthy: true,
      },
      baseReserve: BigInt(0),
      quoteReserve: BigInt(0),
    };

    this.markets.set(marketId, marketState);

    // Subscribe to account changes
    await this.subscribeToMarket(marketId, marketState);

    logger.info({ marketId, accounts: accounts.poolAddress.toBase58() }, 'Market added');
  }

  removeMarket(marketId: string): void {
    const subId = this.subscriptionIds.get(marketId);
    if (subId !== undefined) {
      this.connection.removeAccountChangeListener(subId);
      this.subscriptionIds.delete(marketId);
    }

    this.markets.delete(marketId);
    logger.info({ marketId }, 'Market removed');
  }

  getMarket(marketId: string): MarketUpdate | undefined {
    const state = this.markets.get(marketId);
    if (!state) return undefined;

    return this.stateToUpdate(state);
  }

  getAllMarkets(): MarketUpdate[] {
    return Array.from(this.markets.values()).map(this.stateToUpdate);
  }

  isMarketHealthy(marketId: string): boolean {
    const state = this.markets.get(marketId);
    if (!state) return false;

    return state.health.isHealthy && this.checkStaleness(state);
  }

  // ============================================================================
  // SUBSCRIPTION LOGIC
  // ============================================================================

  private async subscribeToMarket(marketId: string, state: MarketState): Promise<void> {
    try {
      // For simplicity, we'll subscribe to the base and quote vault accounts
      // In production, you'd parse the specific AMM pool state structure

      const baseSubId = this.connection.onAccountChange(
        state.accounts.baseVault,
        (accountInfo, context) => {
          this.handleAccountUpdate(marketId, 'base', accountInfo, context);
        },
        'confirmed'
      );

      const quoteSubId = this.connection.onAccountChange(
        state.accounts.quoteVault,
        (accountInfo, context) => {
          this.handleAccountUpdate(marketId, 'quote', accountInfo, context);
        },
        'confirmed'
      );

      // Store subscription IDs (we'll track base for now)
      this.subscriptionIds.set(marketId, baseSubId);

      logger.info({ marketId, baseSubId, quoteSubId }, 'Subscribed to market accounts');
    } catch (err) {
      logger.error({ err, marketId }, 'Failed to subscribe to market');
      state.health.consecutiveFailures++;
      this.checkHealth(state);
    }
  }

  private handleAccountUpdate(
    marketId: string,
    accountType: 'base' | 'quote',
    accountInfo: AccountInfo<Buffer>,
    context: Context
  ): void {
    const state = this.markets.get(marketId);
    if (!state || this.isShuttingDown) return;

    try {
      // Parse token account data
      // Token accounts have a standard layout:
      // 0-31: mint (32 bytes)
      // 32-63: owner (32 bytes)
      // 64-71: amount (8 bytes, little-endian u64)
      const amount = accountInfo.data.readBigUInt64LE(64);

      // Update reserves
      if (accountType === 'base') {
        state.baseReserve = amount;
      } else {
        state.quoteReserve = amount;
      }

      // Only emit update if we have both reserves
      if (state.baseReserve > 0n && state.quoteReserve > 0n) {
        this.processReserveUpdate(state, context.slot);
      }

      // Update health
      state.health.lastUpdate = Date.now();
      state.health.consecutiveFailures = 0;
      state.health.isHealthy = true;
    } catch (err) {
      logger.error({ err, marketId, accountType }, 'Failed to parse account update');
      state.health.consecutiveFailures++;
      this.checkHealth(state);
    }
  }

  private processReserveUpdate(state: MarketState, slot: number): void {
    // Calculate price from reserves (constant product formula)
    // price = quoteReserve / baseReserve
    const price = Number(state.quoteReserve) / Number(state.baseReserve);

    if (!isFinite(price) || price <= 0) {
      logger.warn({ marketId: state.id, price }, 'Invalid price calculated');
      return;
    }

    // Create price point
    const pricePoint: PricePoint = {
      timestamp: Date.now(),
      price,
      baseReserve: state.baseReserve,
      quoteReserve: state.quoteReserve,
      slot,
    };

    // Add to window
    this.addToWindow(state.window, pricePoint);

    // Create market update
    const update = this.stateToUpdate(state);

    // Emit event
    this.emit('marketUpdate', update);

    // Save to database (async, non-blocking)
    this.saveSnapshot(update).catch((err) => {
      logger.error({ err, marketId: state.id }, 'Failed to save snapshot');
    });

    logger.debug({
      marketId: state.id,
      price: price.toFixed(10),
      liquiditySol: update.liquiditySol.toFixed(2),
    }, 'Market updated');
  }

  // ============================================================================
  // PRICE WINDOW MANAGEMENT
  // ============================================================================

  private createPriceWindow(): PriceWindow {
    return {
      data: [],
      capacity: WINDOW_SIZE_SECONDS, // One point per second
    };
  }

  private addToWindow(window: PriceWindow, point: PricePoint): void {
    // Maintain chronological order
    window.data.push(point);

    // Remove points older than window size
    const cutoff = Date.now() - WINDOW_SIZE_SECONDS * 1000;
    while (window.data.length > 0 && window.data[0].timestamp < cutoff) {
      window.data.shift();
    }

    // Also maintain capacity limit
    while (window.data.length > window.capacity) {
      window.data.shift();
    }
  }

  getReferencePrice(window: PriceWindow): number | undefined {
    if (window.data.length === 0) return undefined;

    // Get price from 60s ago, or oldest available
    const cutoff = Date.now() - WINDOW_SIZE_SECONDS * 1000;
    const oldPoint = window.data.find((p) => p.timestamp <= cutoff) || window.data[0];

    return oldPoint.price;
  }

  getCurrentPrice(window: PriceWindow): number | undefined {
    if (window.data.length === 0) return undefined;
    return window.data[window.data.length - 1].price;
  }

  computeVolatility(window: PriceWindow): number {
    if (window.data.length < 2) return 0;

    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < window.data.length; i++) {
      const ret = Math.log(window.data[i].price / window.data[i - 1].price);
      returns.push(ret);
    }

    // Calculate standard deviation
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  computeVolumeProxy(window: PriceWindow): number {
    if (window.data.length < 2) return 0;

    let totalVolume = 0;
    for (let i = 1; i < window.data.length; i++) {
      const baseChange = Math.abs(Number(window.data[i].baseReserve - window.data[i - 1].baseReserve));
      const quoteChange = Math.abs(Number(window.data[i].quoteReserve - window.data[i - 1].quoteReserve));

      // Convert to SOL equivalent
      const volumeSol = (baseChange * window.data[i].price + quoteChange) / LAMPORTS_PER_SOL;
      totalVolume += volumeSol;
    }

    return totalVolume;
  }

  // ============================================================================
  // HEALTH CHECKS
  // ============================================================================

  private checkStaleness(state: MarketState): boolean {
    const staleness = Date.now() - state.health.lastUpdate;
    return staleness <= STALENESS_THRESHOLD_MS;
  }

  private checkHealth(state: MarketState): void {
    if (state.health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn({ marketId: state.id }, 'Market unhealthy, too many failures');
      state.health.isHealthy = false;
      this.emit('marketUnhealthy', state.id);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private stateToUpdate(state: MarketState): MarketUpdate {
    const liquiditySol = this.computeLiquidity(state);
    const volumeProxy = this.computeVolumeProxy(state.window);

    return {
      id: state.id,
      window: state.window,
      baseReserve: state.baseReserve,
      quoteReserve: state.quoteReserve,
      liquiditySol,
      volumeProxy,
      lastUpdate: state.health.lastUpdate,
    };
  }

  private computeLiquidity(state: MarketState): number {
    // Simple liquidity estimate: 2 * sqrt(base_reserve * quote_reserve) / LAMPORTS_PER_SOL
    const product = Number(state.baseReserve) * Number(state.quoteReserve);
    const liquidity = 2 * Math.sqrt(product) / LAMPORTS_PER_SOL;
    return liquidity;
  }

  private async saveSnapshot(update: MarketUpdate): Promise<void> {
    const currentPrice = this.getCurrentPrice(update.window);
    if (!currentPrice) return;

    await this.database.saveMarketSnapshot({
      time: new Date(),
      marketId: update.id,
      price: currentPrice,
      baseReserve: update.baseReserve.toString(),
      quoteReserve: update.quoteReserve.toString(),
      liquidityEstimate: update.liquiditySol,
      volumeProxy: update.volumeProxy,
    });
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface MarketState {
  id: string;
  accounts: MarketAccounts;
  window: PriceWindow;
  health: MarketHealth;
  baseReserve: bigint;
  quoteReserve: bigint;
}

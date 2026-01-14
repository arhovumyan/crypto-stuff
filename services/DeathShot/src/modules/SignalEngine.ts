import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  MarketUpdate,
  TradeIntent,
  Side,
  DipDetectorConfig,
  PriceWindow,
} from '../types';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('SignalEngine');

const LAMPORTS_PER_SOL = 1_000_000_000;

export class SignalEngine extends EventEmitter {
  private config: DipDetectorConfig;
  private lastTradeTime: Map<string, number> = new Map();

  constructor(config: DipDetectorConfig) {
    super();
    this.config = config;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async start(): Promise<void> {
    logger.info('Starting SignalEngine module');
    logger.info({ config: this.config }, 'Signal configuration');
  }

  async stop(): Promise<void> {
    logger.info('Stopping SignalEngine module');
    this.lastTradeTime.clear();
  }

  // ============================================================================
  // SIGNAL DETECTION
  // ============================================================================

  onMarketUpdate(market: MarketUpdate): void {
    const intent = this.evaluate(market);
    if (intent) {
      logger.info({
        marketId: market.id,
        intentId: intent.intentId,
        dropPct: intent.dropPct.toFixed(2),
        currentPrice: intent.currentPrice.toFixed(10),
        referencePrice: intent.referencePrice.toFixed(10),
      }, 'Dip detected, trade intent created');

      this.emit('tradeIntent', intent);
    }
  }

  private evaluate(market: MarketUpdate): TradeIntent | undefined {
    // Gate 1: Check cooldown
    if (!this.checkCooldown(market.id)) {
      return undefined;
    }

    // Gate 2: Price drop threshold
    const referencePrice = this.getReferencePrice(market.window);
    const currentPrice = this.getCurrentPrice(market.window);

    if (!referencePrice || !currentPrice) {
      return undefined;
    }

    const dropPct = ((referencePrice - currentPrice) / referencePrice) * 100;

    if (dropPct < this.config.thresholdPct) {
      return undefined; // Not a big enough dip
    }

    // Gate 3: Liquidity check
    if (market.liquiditySol < this.config.minLiquiditySol) {
      logger.debug({
        marketId: market.id,
        liquidity: market.liquiditySol.toFixed(2),
        minRequired: this.config.minLiquiditySol,
      }, 'Insufficient liquidity');
      return undefined;
    }

    // Gate 4: Slippage estimation
    const intendedSizeSol = this.computeOrderSize(market.liquiditySol);
    const estimatedSlippage = this.estimateSlippage(
      currentPrice,
      intendedSizeSol,
      market.baseReserve,
      market.quoteReserve
    );

    if (estimatedSlippage > this.config.maxSlippagePct) {
      logger.debug({
        marketId: market.id,
        estimatedSlippage: estimatedSlippage.toFixed(2),
        maxAllowed: this.config.maxSlippagePct,
      }, 'Slippage too high');
      return undefined;
    }

    // Gate 5: Volume proxy (avoid dead pools)
    if (market.volumeProxy < this.config.minVolumeProxy) {
      logger.debug({
        marketId: market.id,
        volumeProxy: market.volumeProxy.toFixed(2),
        minRequired: this.config.minVolumeProxy,
      }, 'Volume too low');
      return undefined;
    }

    // All gates passed, update last trade time
    this.lastTradeTime.set(market.id, Date.now());

    // Create intent
    return {
      intentId: uuidv4(),
      timestamp: new Date(),
      marketId: market.id,
      side: Side.Buy,
      sizeSol: intendedSizeSol,
      referencePrice,
      currentPrice,
      dropPct,
      liquiditySol: market.liquiditySol,
      estimatedSlippage,
      reasonCodes: [
        'PRICE_DROP_THRESHOLD_MET',
        'LIQUIDITY_SUFFICIENT',
        'SLIPPAGE_ACCEPTABLE',
        'VOLUME_SUFFICIENT',
      ],
    };
  }

  // ============================================================================
  // GATE CHECKS
  // ============================================================================

  private checkCooldown(marketId: string): boolean {
    const lastTrade = this.lastTradeTime.get(marketId);
    if (!lastTrade) return true;

    const elapsed = Date.now() - lastTrade;
    if (elapsed < this.config.cooldownDurationMs) {
      logger.debug({
        marketId,
        elapsedMs: elapsed,
        cooldownMs: this.config.cooldownDurationMs,
      }, 'Market in cooldown');
      return false;
    }

    return true;
  }

  private getReferencePrice(window: PriceWindow): number | undefined {
    if (window.data.length === 0) return undefined;

    // Get price from 60s ago, or oldest available
    const cutoff = Date.now() - 60_000;
    const oldPoint = window.data.find((p) => p.timestamp <= cutoff) || window.data[0];

    return oldPoint.price;
  }

  private getCurrentPrice(window: PriceWindow): number | undefined {
    if (window.data.length === 0) return undefined;
    return window.data[window.data.length - 1].price;
  }

  // ============================================================================
  // CALCULATIONS
  // ============================================================================

  private estimateSlippage(
    price: number,
    sizeSol: number,
    baseReserve: bigint,
    quoteReserve: bigint
  ): number {
    // Constant product formula: x * y = k
    // After swap: (x + dx) * (y - dy) = k
    // We're buying base token with SOL (quote token)
    // dy = y - k / (x + dx)
    // Price impact = abs((dy / dx - price) / price * 100)

    const k = Number(baseReserve) * Number(quoteReserve);
    const dx = sizeSol * LAMPORTS_PER_SOL; // Convert SOL to lamports
    const quoteReserveNum = Number(quoteReserve);
    const dy = quoteReserveNum - k / (quoteReserveNum + dx);
    const effectivePrice = dy / dx;

    const slippage = Math.abs((effectivePrice - price) / price * 100);

    return slippage;
  }

  private computeOrderSize(liquiditySol: number): number {
    // Dynamic sizing: use 1% of pool liquidity, capped at max
    const MAX_SIZE_SOL = 5.0;
    const POOL_SIZE_PCT = 0.01;

    const size = Math.min(liquiditySol * POOL_SIZE_PCT, MAX_SIZE_SOL);

    // Also ensure minimum size
    const MIN_SIZE_SOL = 0.01;
    return Math.max(size, MIN_SIZE_SOL);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  updateConfig(config: Partial<DipDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ newConfig: this.config }, 'Signal configuration updated');
  }

  clearCooldown(marketId: string): void {
    this.lastTradeTime.delete(marketId);
    logger.debug({ marketId }, 'Cooldown cleared');
  }

  getCooldownStatus(marketId: string): { inCooldown: boolean; remainingMs: number } {
    const lastTrade = this.lastTradeTime.get(marketId);
    if (!lastTrade) {
      return { inCooldown: false, remainingMs: 0 };
    }

    const elapsed = Date.now() - lastTrade;
    const remaining = Math.max(0, this.config.cooldownDurationMs - elapsed);

    return {
      inCooldown: remaining > 0,
      remainingMs: remaining,
    };
  }
}

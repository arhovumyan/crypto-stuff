/**
 * Replay Trade Feed
 * Replays recorded swaps as if they were live trades
 */

import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { createLogger } from '../logger.js';
import { HistoricalSwapEvent } from './types.js';
import { RawTrade } from '../types.js';

const log = createLogger('replay-trade-feed');

export class ReplayTradeFeed extends EventEmitter {
  private events: HistoricalSwapEvent[] = [];
  private currentIndex = 0;
  private speed: '1x' | '10x' | '100x' | 'max';
  private startSlot: number;
  private endSlot: number;
  private isRunning = false;
  private isPaused = false;

  constructor(speed: '1x' | '10x' | '100x' | 'max' = '1x') {
    super();
    this.speed = speed;
    this.startSlot = 0;
    this.endSlot = Number.MAX_SAFE_INTEGER;
  }

  /**
   * Load dataset from JSONL file
   */
  async loadDataset(filePath: string, startSlot?: number, endSlot?: number): Promise<void> {
    log.info('Loading dataset', { filePath, startSlot, endSlot });

    try {
      // Read file
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      // Parse events
      this.events = lines
        .map(line => {
          try {
            return JSON.parse(line) as HistoricalSwapEvent;
          } catch (error) {
            log.warn(`Failed to parse line: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }
        })
        .filter((event): event is HistoricalSwapEvent => event !== null)
        .filter(event => {
          if (startSlot && event.slot < startSlot) return false;
          if (endSlot && event.slot > endSlot) return false;
          return true;
        })
        .sort((a, b) => {
          // CRITICAL: Sort by (slot, txIndex, logIndex) for deterministic ordering
          if (a.slot !== b.slot) return a.slot - b.slot;
          if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
          if (a.logIndex && b.logIndex && a.logIndex !== b.logIndex) {
            return a.logIndex - b.logIndex;
          }
          // Fallback to signature if indices not available
          return a.signature.localeCompare(b.signature);
        });

      this.startSlot = startSlot || this.events[0]?.slot || 0;
      this.endSlot = endSlot || this.events[this.events.length - 1]?.slot || Number.MAX_SAFE_INTEGER;

      log.info(`Loaded ${this.events.length} events`, {
        firstSlot: this.events[0]?.slot,
        lastSlot: this.events[this.events.length - 1]?.slot,
        uniqueTokens: new Set(this.events.map(e => e.tokenMint)).size,
        uniqueTraders: new Set(this.events.map(e => e.trader)).size,
      });
    } catch (error) {
      log.error(`Failed to load dataset: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Start replay
   */
  async start(): Promise<void> {
    if (this.events.length === 0) {
      throw new Error('No events loaded. Call loadDataset() first.');
    }

    log.info('Starting replay', {
      speed: this.speed,
      totalEvents: this.events.length,
    });

    this.isRunning = true;
    this.currentIndex = 0;

    // Emit events
    while (this.isRunning && this.currentIndex < this.events.length) {
      if (this.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const event = this.events[this.currentIndex];
      
      // Convert to RawTrade format
      const trade: RawTrade = this.convertToRawTrade(event);
      
      // Emit as if from WebSocket
      this.emit('trade', trade);
      
      // Handle replay speed
      if (this.speed === '1x') {
        await this.waitForNextSlot(event);
      } else if (this.speed === '10x') {
        await new Promise(resolve => setTimeout(resolve, 150)); // 10x faster
      } else if (this.speed === '100x') {
        await new Promise(resolve => setTimeout(resolve, 15)); // 100x faster
      }
      // max: no delay
      
      this.currentIndex++;
      
      // Log progress
      if (this.currentIndex % 1000 === 0) {
        const progress = (this.currentIndex / this.events.length * 100).toFixed(1);
        log.info(`Replay progress: ${this.currentIndex}/${this.events.length} (${progress}%)`);
      }
    }

    this.isRunning = false;
    this.emit('complete');
    log.info('Replay complete');
  }

  /**
   * Convert HistoricalSwapEvent to RawTrade
   */
  private convertToRawTrade(event: HistoricalSwapEvent): RawTrade {
    return {
      signature: event.signature,
      slot: event.slot,
      blockTime: event.blockTime,
      tokenMint: event.tokenMint,
      traderWallet: event.trader,
      type: event.side,
      amountSOL: event.amountInSOL,
      // Store pool and program info in the trade object (will be available as 'any')
      ...(event.poolAddress && { poolAddress: event.poolAddress }),
      ...(event.programId && { programId: event.programId }),
      ...(event.amountIn && { amountIn: event.amountIn }),
      ...(event.amountOut && { amountOut: event.amountOut }),
    } as RawTrade;
  }

  /**
   * Wait for next slot (1x speed)
   */
  private async waitForNextSlot(currentEvent: HistoricalSwapEvent): Promise<void> {
    const nextEvent = this.events[this.currentIndex + 1];
    if (!nextEvent) return;

    const slotDiff = nextEvent.slot - currentEvent.slot;
    const msPerSlot = 1500; // Solana ~1.5s per slot (approximate)
    const waitTime = slotDiff * msPerSlot;

    if (waitTime > 0 && waitTime < 60000) { // Cap at 1 minute
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Pause replay
   */
  pause(): void {
    this.isPaused = true;
    log.info('Replay paused');
  }

  /**
   * Resume replay
   */
  resume(): void {
    this.isPaused = false;
    log.info('Replay resumed');
  }

  /**
   * Stop replay
   */
  stop(): void {
    this.isRunning = false;
    log.info('Replay stopped');
  }

  /**
   * Get progress
   */
  getProgress(): { current: number; total: number; percentage: number } {
    return {
      current: this.currentIndex,
      total: this.events.length,
      percentage: this.events.length > 0 ? (this.currentIndex / this.events.length) * 100 : 0,
    };
  }

  /**
   * Set replay speed
   */
  setSpeed(speed: '1x' | '10x' | '100x' | 'max'): void {
    this.speed = speed;
    log.info(`Replay speed changed to ${speed}`);
  }
}


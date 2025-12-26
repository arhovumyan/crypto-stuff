/**
 * Time Provider
 * Abstracts time source for deterministic replay vs live mode
 */

export interface TimeProvider {
  /**
   * Get current slot
   */
  nowSlot(): number;
  
  /**
   * Get current time in milliseconds (optional, for logging)
   */
  nowMs(): number;
  
  /**
   * Check if time has elapsed since a reference slot
   */
  hasElapsedSlots(referenceSlot: number, slotsToElapse: number): boolean;
  
  /**
   * Convert milliseconds to slots (approximate)
   */
  msToSlots(ms: number): number;
  
  /**
   * Convert slots to milliseconds (approximate)
   */
  slotsToMs(slots: number): number;
}

/**
 * Live Time Provider
 * Uses Solana network time (wall clock + estimated slots)
 */
export class LiveTimeProvider implements TimeProvider {
  private readonly SOLANA_SLOT_TIME_MS = 400; // ~400ms per slot on Solana
  private startTime: number;
  private startSlot: number;
  
  constructor(currentSlot: number) {
    this.startTime = Date.now();
    this.startSlot = currentSlot;
  }
  
  nowSlot(): number {
    const elapsed = Date.now() - this.startTime;
    const slotsElapsed = Math.floor(elapsed / this.SOLANA_SLOT_TIME_MS);
    return this.startSlot + slotsElapsed;
  }
  
  nowMs(): number {
    return Date.now();
  }
  
  hasElapsedSlots(referenceSlot: number, slotsToElapse: number): boolean {
    return this.nowSlot() >= referenceSlot + slotsToElapse;
  }
  
  msToSlots(ms: number): number {
    return Math.ceil(ms / this.SOLANA_SLOT_TIME_MS);
  }
  
  slotsToMs(slots: number): number {
    return slots * this.SOLANA_SLOT_TIME_MS;
  }
}

/**
 * Replay Time Provider
 * Uses slot from replayed events (deterministic)
 */
export class ReplayTimeProvider implements TimeProvider {
  private readonly SOLANA_SLOT_TIME_MS = 400; // For conversions only
  private currentSlot: number;
  private currentBlockTime: number;
  
  constructor(initialSlot: number = 0, initialBlockTime: number = Date.now()) {
    this.currentSlot = initialSlot;
    this.currentBlockTime = initialBlockTime;
  }
  
  /**
   * Set current slot (called by replay engine before emitting event)
   */
  setCurrentSlot(slot: number, blockTime?: number): void {
    this.currentSlot = slot;
    if (blockTime !== undefined) {
      this.currentBlockTime = blockTime;
    }
  }
  
  nowSlot(): number {
    return this.currentSlot;
  }
  
  nowMs(): number {
    // In replay, return the block time of the current event
    return this.currentBlockTime * 1000;
  }
  
  hasElapsedSlots(referenceSlot: number, slotsToElapse: number): boolean {
    return this.currentSlot >= referenceSlot + slotsToElapse;
  }
  
  msToSlots(ms: number): number {
    return Math.ceil(ms / this.SOLANA_SLOT_TIME_MS);
  }
  
  slotsToMs(slots: number): number {
    return slots * this.SOLANA_SLOT_TIME_MS;
  }
  
  /**
   * Get current slot (for external access)
   */
  getCurrentSlot(): number {
    return this.currentSlot;
  }
}


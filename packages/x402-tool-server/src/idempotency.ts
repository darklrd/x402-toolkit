/**
 * In-memory idempotency store.
 *
 * Keys expire after `ttlMs` (default 1 hour). A background interval runs
 * every `sweepIntervalMs` (default 5 min) to evict stale entries.
 *
 * For production, swap this out with a Redis-backed implementation that
 * implements the same `IdempotencyStore` interface.
 *
 * See docs/DESIGN.md §idempotency for the swap guide.
 */
import type { IdempotencyStore, StoredResponse } from './types.js';

interface Entry {
  value: StoredResponse;
  expiresAt: number;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(options: { ttlMs?: number; sweepIntervalMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 3_600_000; // 1 h
    this.timer = setInterval(
      () => this.sweep(),
      options.sweepIntervalMs ?? 300_000, // 5 min
    );
    // Allow the process to exit even if this timer is still running.
    if (this.timer.unref) this.timer.unref();
  }

  get(key: string): StoredResponse | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: StoredResponse): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Remove expired entries. Called automatically by the background timer. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Stop the background sweep timer (useful in tests). */
  destroy(): void {
    clearInterval(this.timer);
  }

  /** Number of live entries (for testing). */
  get size(): number {
    return this.store.size;
  }
}

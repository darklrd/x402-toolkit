/**
 * In-memory MCP receipt store.
 *
 * MCP receipts preserve the base toolkit receipt fields and add MCP context
 * (toolName, argumentsHash, mcpMethod, sessionId). Receipts are kept for
 * `ttlMs` (default 1 hour) then swept.
 */
import type { McpReceipt, McpReceiptStore } from './types.js';

export class MemoryMcpReceiptStore implements McpReceiptStore {
  private store = new Map<string, { receipt: McpReceipt; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 3_600_000;

    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [nonce, entry] of this.store) {
        if (now > entry.expiresAt) this.store.delete(nonce);
      }
    }, 60_000);

    if (this.sweepInterval.unref) this.sweepInterval.unref();
  }

  save(receipt: McpReceipt): void {
    this.store.set(receipt.nonce, {
      receipt,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(nonce: string): McpReceipt | undefined {
    const entry = this.store.get(nonce);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(nonce);
      return undefined;
    }
    return entry.receipt;
  }

  /** Number of receipts currently stored. */
  get size(): number {
    return this.store.size;
  }

  /** Stop the background sweep timer. */
  destroy(): void {
    clearInterval(this.sweepInterval);
  }
}

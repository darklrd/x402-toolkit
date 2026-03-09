/**
 * x402 Receipt Store — stores payment receipts for audit and verification.
 *
 * After a successful payment, the middleware saves a receipt keyed by nonce.
 * Consumers can retrieve receipts via GET /x402/receipts/:nonce.
 */

export interface Receipt {
  /** The challenge nonce that was paid */
  nonce: string;
  /** Payer identifier (wallet address or "mock") */
  payer: string;
  /** Payment amount as decimal string */
  amount: string;
  /** Asset symbol, e.g. "USDC" */
  asset: string;
  /** Network identifier, e.g. "mock" or "solana" */
  network: string;
  /** Recipient address */
  recipient: string;
  /** The endpoint that was paid for */
  endpoint: string;
  /** HTTP method of the paid request */
  method: string;
  /** SHA-256 hex digest of the canonical request */
  requestHash: string;
  /** ISO-8601 timestamp when payment was verified */
  paidAt: string;
}

/**
 * Interface for receipt storage backends.
 * Implement this to use a database, Redis, etc.
 */
export interface ReceiptStore {
  /** Save a receipt. */
  save(receipt: Receipt): void;
  /** Retrieve a receipt by nonce. Returns undefined if not found. */
  get(nonce: string): Receipt | undefined;
}

/**
 * Default in-memory receipt store.
 * Receipts are kept for `ttlMs` (default: 1 hour) then swept.
 */
export class MemoryReceiptStore implements ReceiptStore {
  private store = new Map<string, { receipt: Receipt; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 3_600_000; // 1 hour default

    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      for (const [nonce, entry] of this.store) {
        if (now > entry.expiresAt) this.store.delete(nonce);
      }
    }, 60_000);

    if (this.sweepInterval.unref) this.sweepInterval.unref();
  }

  save(receipt: Receipt): void {
    this.store.set(receipt.nonce, {
      receipt,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(nonce: string): Receipt | undefined {
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

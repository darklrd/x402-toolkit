/**
 * MockPayer — deterministic proof generator for local/offline development.
 *
 * Proof signature = HMAC-SHA256(hex, secret, `${nonce}|${requestHash}`)
 *
 * The secret must match the one used by MockVerifier on the server side.
 * Default secret: "mock-secret" (works out-of-box; override for uniqueness).
 */
import { createHmac } from 'crypto';

// Structural types (mirroring x402-agent-client types without importing them)
interface X402Challenge {
  version: number;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  price?: string;
  asset?: string;
}

interface RequestContext {
  url: string;
  method: string;
}

interface PaymentProof {
  version: number;
  nonce: string;
  requestHash: string;
  payer: string;
  timestamp: string;
  expiresAt: string;
  signature: string;
}

interface PayerInterface {
  pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof>;
}

export interface MockPayerOptions {
  /**
   * HMAC secret shared with MockVerifier.
   * Default: "mock-secret"
   */
  secret?: string;
  /**
   * Identifier included in proof.payer field.
   * Default: "mock://0x0000000000000000000000000000000000000001"
   */
  payerAddress?: string;
}

/**
 * MockPayer — use in tests and local demos.
 *
 * Satisfies the `PayerInterface` from x402-agent-client via structural typing.
 */
export class MockPayer implements PayerInterface {
  private readonly secret: string;
  private readonly payerAddress: string;

  constructor(options: MockPayerOptions = {}) {
    this.secret = options.secret ?? 'mock-secret';
    this.payerAddress = options.payerAddress ?? 'mock://0x0000000000000000000000000000000000000001';
  }

  async pay(challenge: X402Challenge, _context: RequestContext): Promise<PaymentProof> {
    const { nonce, requestHash, expiresAt, version } = challenge;

    // Deterministic signature: HMAC-SHA256(secret, nonce|requestHash)
    const signature = createHmac('sha256', this.secret)
      .update(`${nonce}|${requestHash}`)
      .digest('hex');

    return {
      version,
      nonce,
      requestHash,
      payer: this.payerAddress,
      timestamp: new Date().toISOString(),
      expiresAt,
      signature,
    };
  }
}

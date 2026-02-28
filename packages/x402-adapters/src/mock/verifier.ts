/**
 * MockVerifier — validates proofs created by MockPayer.
 *
 * Checks:
 *   1. proof.requestHash matches the server-recomputed requestHash
 *   2. proof.expiresAt is in the future (not expired)
 *   3. HMAC-SHA256(secret, `${nonce}|${requestHash}`) matches proof.signature
 *
 * The secret must match the one used by MockPayer.
 */
import { createHmac, timingSafeEqual } from 'crypto';

// Structural types (mirroring x402-tool-server types without importing them)
interface PricingConfig {
  price: string;
  asset: string;
  recipient: string;
  network?: string;
}

interface VerifierInterface {
  verify(proofHeader: string, requestHash: string, pricing: PricingConfig): Promise<boolean>;
}

interface PaymentProof {
  version?: number;
  nonce: string;
  requestHash: string;
  payer?: string;
  timestamp?: string;
  expiresAt: string;
  signature: string;
}

export interface MockVerifierOptions {
  /**
   * HMAC secret shared with MockPayer.
   * Default: "mock-secret"
   */
  secret?: string;
}

/**
 * MockVerifier — use in tests and local demos.
 *
 * Satisfies the `VerifierInterface` from x402-tool-server via structural typing.
 */
export class MockVerifier implements VerifierInterface {
  private readonly secret: string;

  constructor(options: MockVerifierOptions = {}) {
    this.secret = options.secret ?? 'mock-secret';
  }

  async verify(
    proofHeader: string,
    requestHash: string,
    _pricing: PricingConfig,
  ): Promise<boolean> {
    let proof: PaymentProof;

    // Decode base64url JSON proof.
    try {
      const decoded = Buffer.from(proofHeader, 'base64url').toString('utf8');
      proof = JSON.parse(decoded) as PaymentProof;
    } catch {
      return false;
    }

    // 1. requestHash must match what the server computed.
    if (proof.requestHash !== requestHash) return false;

    // 2. Must not be expired.
    const expiry = new Date(proof.expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) return false;

    // 3. Verify HMAC signature (constant-time comparison to prevent timing attacks).
    const expected = createHmac('sha256', this.secret)
      .update(`${proof.nonce}|${proof.requestHash}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(proof.signature ?? '');

    if (expectedBuf.length !== actualBuf.length) return false;

    return timingSafeEqual(expectedBuf, actualBuf);
  }
}

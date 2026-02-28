/**
 * x402-tool-server — shared types
 *
 * Wire format note (MVP deviations from Coinbase x402 spec are documented in docs/DESIGN.md):
 * - 402 body: { x402: X402Challenge }
 * - Payment proof sent in header: X-Payment-Proof (base64url-encoded JSON PaymentProof)
 */

// ─── Challenge (402 response body) ──────────────────────────────────────────

export interface X402Challenge {
  /** Protocol version — always 1 for this implementation */
  version: number;
  /** Human-readable payment scheme, e.g. "exact" or "mock" */
  scheme: string;
  /** Payment amount as a decimal string, e.g. "0.001" */
  price: string;
  /** Asset symbol, e.g. "USDC", "ETH", or "MOCK" */
  asset: string;
  /** Network identifier, e.g. "base-sepolia" or "mock" */
  network: string;
  /** Recipient address (wallet address or "mock") */
  recipient: string;
  /** Unique one-time nonce — prevents replay attacks */
  nonce: string;
  /** ISO-8601 expiry timestamp — proof rejected after this time */
  expiresAt: string;
  /**
   * SHA-256 hex digest of the canonical request:
   *   METHOD\nPATHNAME\nCANONICAL_QUERY\nRAW_BODY_BYTES
   */
  requestHash: string;
  /** Optional human-readable description of what is being purchased */
  description?: string;
}

export interface X402ChallengeBody {
  x402: X402Challenge;
}

// ─── Payment proof (sent from client back to server) ────────────────────────

export interface PaymentProof {
  /** Must equal challenge.version */
  version: number;
  /** Must equal challenge.nonce */
  nonce: string;
  /** Must equal the server-computed requestHash */
  requestHash: string;
  /** Payer identifier (address, "mock", etc.) */
  payer: string;
  /** ISO-8601 timestamp when proof was created */
  timestamp: string;
  /** Must equal challenge.expiresAt */
  expiresAt: string;
  /**
   * Proof of payment.
   * Mock: HMAC-SHA256(hex, secret, `${nonce}|${requestHash}`)
   * Real: on-chain tx hash or EIP-712 signature
   */
  signature: string;
}

// ─── Pricing config (attached to routes) ────────────────────────────────────

export interface PricingConfig {
  /** Payment amount as a decimal string, e.g. "0.001" */
  price: string;
  /** Asset symbol, e.g. "USDC" or "MOCK" */
  asset: string;
  /** Payment network, e.g. "base-sepolia" or "mock" */
  network?: string;
  /** Recipient address */
  recipient: string;
  /** Payment scheme, defaults to "exact" */
  scheme?: string;
  /** Human-readable description (included in challenge) */
  description?: string;
  /** Challenge TTL in seconds, defaults to 300 (5 min) */
  ttlSeconds?: number;
}

// ─── Verifier interface ──────────────────────────────────────────────────────

export interface VerifierInterface {
  /**
   * Verify a payment proof against the current request.
   *
   * @param proofHeader - raw value of X-Payment-Proof header (base64url JSON)
   * @param requestHash - SHA-256 hex of the canonical request (server-recomputed)
   * @param pricing     - pricing config for this route
   * @returns true if the proof is valid and payment is accepted
   */
  verify(
    proofHeader: string,
    requestHash: string,
    pricing: PricingConfig,
  ): Promise<boolean>;
}

// ─── Idempotency store interface ─────────────────────────────────────────────

export interface StoredResponse {
  requestHash: string;
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface IdempotencyStore {
  get(key: string): StoredResponse | undefined;
  set(key: string, value: StoredResponse): void;
}

// ─── Route config augmentation ───────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyContextConfig {
    x402Pricing?: PricingConfig;
  }
}

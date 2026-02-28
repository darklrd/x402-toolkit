/**
 * x402-agent-client — types
 *
 * These types mirror the server-side types and must stay in sync.
 * They are redefined here to keep the client dependency-free from
 * the server package (structural typing guarantees compatibility).
 */

// ─── Challenge (received in 402 body) ────────────────────────────────────────

export interface X402Challenge {
  version: number;
  scheme: string;
  price: string;
  asset: string;
  network: string;
  recipient: string;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  description?: string;
}

export interface X402ChallengeBody {
  x402: X402Challenge;
}

// ─── Payment proof (created by payer, sent to server) ────────────────────────

export interface PaymentProof {
  version: number;
  nonce: string;
  requestHash: string;
  payer: string;
  timestamp: string;
  expiresAt: string;
  signature: string;
}

// ─── Payer interface ──────────────────────────────────────────────────────────

export interface RequestContext {
  url: string;
  method: string;
}

export interface PayerInterface {
  /**
   * Given a 402 challenge and the request context, produce a payment proof
   * that the server will accept.
   */
  pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof>;
}

// ─── x402Fetch options ────────────────────────────────────────────────────────

export interface X402FetchOptions {
  /** Payer implementation (e.g. MockPayer) */
  payer: PayerInterface;
  /**
   * Maximum number of payment retries.
   * Default: 1 (pay once, then retry once; do not loop forever).
   */
  maxRetries?: number;
}

// ─── createTool options ───────────────────────────────────────────────────────

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

export interface ToolConfig {
  /** Tool name (used in agent frameworks) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema describing the tool's input */
  inputSchema: JsonSchema;
  /** Full URL of the priced endpoint */
  endpoint: string;
  /** HTTP method (default: GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** x402Fetch options (payer, maxRetries) */
  fetchOptions: X402FetchOptions;
}

export interface ToolInvokeResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

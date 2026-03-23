/**
 * x402-tool-server — public API
 *
 * Exports:
 *   createX402Middleware  Fastify plugin that gates priced routes
 *   pricedRoute           Full RouteOptions factory (method + url + handler + pricing)
 *   pricedHandler         Shorthand options factory (pricing only, use with fastify.get/post)
 *
 *   X402Challenge         Type: 402 response body inner object
 *   X402ChallengeBody     Type: full 402 response body { x402: X402Challenge }
 *   PaymentProof          Type: proof sent back by the client
 *   PricingConfig         Type: per-route pricing configuration
 *   VerifierInterface     Interface that verifiers must implement
 *   IdempotencyStore      Interface for custom idempotency backends
 *   StoredResponse        Type stored by IdempotencyStore
 *   MemoryIdempotencyStore Default in-memory idempotency store
 *
 *   Receipt               Type: payment receipt record
 *   ReceiptStore          Interface for receipt storage backends
 *   MemoryReceiptStore    Default in-memory receipt store
 *
 *   X402MiddlewareOptions Type: options for createX402Middleware
 *   computeRequestHash    Utility: compute the canonical request hash
 *   canonicalQueryString  Utility: produce sorted canonical query string
 */

export { createX402Middleware } from './middleware.js';
export type { X402MiddlewareOptions } from './middleware.js';

export { X402EventEmitter } from './events.js';
export type {
  X402EventMap,
  X402ChallengeEvent,
  X402PaymentEvent,
  X402ErrorEvent,
  X402ErrorReason,
  RequestInfo as X402RequestInfo,
} from './events.js';

export { pricedRoute, pricedHandler } from './route.js';
export type { PricedRouteOptions } from './route.js';

export { computeRequestHash, canonicalQueryString } from './hash.js';

export { MemoryIdempotencyStore } from './idempotency.js';

export { MemoryReceiptStore } from './receipts.js';
export type { Receipt, ReceiptStore } from './receipts.js';

export type {
  X402Challenge,
  X402ChallengeBody,
  PaymentProof,
  PricingConfig,
  VerifierInterface,
  IdempotencyStore,
  StoredResponse,
} from './types.js';

export { rateLimitMiddleware } from './rate-limit.js';
export type { RateLimitOptions } from './rate-limit.js';

export { openApiPlugin } from './openapi.js';
export type { OpenApiOptions } from './openapi.js';

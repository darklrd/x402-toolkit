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
 *   X402MiddlewareOptions Type: options for createX402Middleware
 *   computeRequestHash    Utility: compute the canonical request hash
 *   canonicalQueryString  Utility: produce sorted canonical query string
 */

export { createX402Middleware } from './middleware.js';
export type { X402MiddlewareOptions } from './middleware.js';

export { pricedRoute, pricedHandler } from './route.js';
export type { PricedRouteOptions } from './route.js';

export { computeRequestHash, canonicalQueryString } from './hash.js';

export { MemoryIdempotencyStore } from './idempotency.js';

export type {
  X402Challenge,
  X402ChallengeBody,
  PaymentProof,
  PricingConfig,
  VerifierInterface,
  IdempotencyStore,
  StoredResponse,
} from './types.js';

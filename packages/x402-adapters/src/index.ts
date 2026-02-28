/**
 * x402-adapters — public API
 *
 * Exports:
 *   MockPayer     Deterministic HMAC-based payer (for local/offline use)
 *   MockVerifier  Validates MockPayer proofs (for local/offline use)
 *
 * Future:
 *   RealPayer     On-chain payer (TODO — see docs/DESIGN.md §real-payer)
 *   RealVerifier  On-chain verifier (TODO)
 */

export { MockPayer } from './mock/payer.js';
export type { MockPayerOptions } from './mock/payer.js';
export { MockVerifier } from './mock/verifier.js';
export type { MockVerifierOptions } from './mock/verifier.js';

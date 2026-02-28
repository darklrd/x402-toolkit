/**
 * Real payer/verifier adapters — TODO
 *
 * This is a placeholder for production adapters that integrate with
 * actual on-chain payment systems (e.g. Coinbase x402 on Base).
 *
 * See docs/DESIGN.md §real-payer for the integration guide.
 *
 * Do NOT implement until all acceptance criteria for the mock adapter pass.
 */

export function createRealPayer(): never {
  throw new Error(
    'Real payer adapter is not yet implemented. ' +
    'See docs/DESIGN.md §real-payer for the planned integration.',
  );
}

export function createRealVerifier(): never {
  throw new Error(
    'Real verifier adapter is not yet implemented. ' +
    'See docs/DESIGN.md §real-payer for the planned integration.',
  );
}

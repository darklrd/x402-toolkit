# Design Notes

## Why Fastify?

Fastify was chosen over Express for:
1. **Plugin system** — `fastify.register()` makes the middleware self-contained and composable.
2. **Route config** — `config` field on routes lets us attach pricing metadata without patching `Request`.
3. **Performance** — Fastify is significantly faster than Express for I/O-bound workloads.
4. **Type safety** — Fastify ships first-class TypeScript types.

## x402 Wire Format (MVP deviations from Coinbase spec)

The [Coinbase x402 spec](https://github.com/coinbase/x402) defines a 402 body for Base chain ERC-20 payments. Our MVP deviates as follows:

| Field | Coinbase spec | This implementation | Reason |
|---|---|---|---|
| 402 body wrapper | `{ accepts: [...] }` | `{ x402: { ... } }` | Simpler single-challenge envelope for MVP |
| `scheme` | `"exact"` | `"exact"` (default) or `"mock"` | Same |
| `asset` | Contract address | `"USDC"` string or `"MOCK"` | Avoid chain-specifics in MVP |
| Payment header | `X-PAYMENT` | `X-Payment-Proof` | More descriptive |
| Proof format | EIP-712 typed sig | base64url-encoded JSON | Avoids wallet deps in mock |

These deviations are intentional for the MVP. The real adapter (`packages/x402-adapters/src/real/`) will follow the Coinbase spec exactly when implemented.

## requestHash Canonicalization

The requestHash binds a payment proof to a specific HTTP request, preventing proof reuse across different requests.

```
requestHash = SHA-256(
  METHOD + "\n" +
  PATHNAME + "\n" +
  CANONICAL_QUERY + "\n" +
  RAW_BODY_BYTES
)
```

**Canonical query string**: keys sorted lexicographically, both keys and values percent-encoded via `encodeURIComponent`. This ensures `city=Paris&units=metric` and `units=metric&city=Paris` produce the same hash.

**Raw body bytes**: captured in the `preParsing` hook before Fastify's body parser runs. The `preParsing` hook intercepts the stream, buffers it, and re-feeds a new `Readable` so Fastify can still parse the body normally.

**Why not hash the parsed body?** Parsed bodies lose information (e.g. key ordering in JSON). Using raw bytes is deterministic and safe.

## Idempotency

The `Idempotency-Key` header prevents double-charging on network retries.

**Key semantics:**
- First call with a key: normal payment flow, store response under key + requestHash.
- Retry with same key + same requestHash: return stored response, `X-Idempotent-Replay: true`.
- Same key, different requestHash: 409 Conflict (different request ≠ retry).

**Storage interface** (`IdempotencyStore`): swappable. The default `MemoryIdempotencyStore` is fine for single-node deployments. For multi-node, implement with Redis:

```ts
import { createClient } from 'redis';
import type { IdempotencyStore, StoredResponse } from 'x402-tool-server';

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private redis: ReturnType<typeof createClient>, private ttlSeconds = 3600) {}

  async get(key: string): Promise<StoredResponse | undefined> {
    const raw = await this.redis.get(`x402:idem:${key}`);
    return raw ? JSON.parse(raw) : undefined;
  }

  async set(key: string, value: StoredResponse): Promise<void> {
    await this.redis.set(`x402:idem:${key}`, JSON.stringify(value), { EX: this.ttlSeconds });
  }
}
```

Note: The interface methods are synchronous in the current implementation. For async stores, the interface should be updated to return `Promise<...>`. This is a known MVP limitation — see roadmap.

## Nonce Replay Protection

The server maintains an in-process `Map<nonce, expiryMs>`. After `proof.expiresAt + 60s`, the nonce is eligible for eviction (a background interval runs every 60s).

For multi-node deployments, use a shared Redis set with TTL instead.

## MockPayer / MockVerifier

The mock adapter uses **HMAC-SHA256** as a proof-of-payment simulation:

```
signature = HMAC-SHA256(secret, `${nonce}|${requestHash}`)
```

This is deterministic (same inputs → same signature) and allows tests to be stable without mocking crypto. The shared `secret` acts as the "wallet key" in mock mode.

**Constant-time comparison**: `MockVerifier.verify()` uses `crypto.timingSafeEqual()` to prevent timing side-channels when comparing signatures.

## Public API Surface

The API is intentionally minimal:

**Server** (`x402-tool-server`):
- `createX402Middleware(options)` — Fastify plugin
- `pricedRoute(options)` — route factory
- `pricedHandler(pricing)` — shorthand options factory
- `computeRequestHash(...)` — utility (useful for tests)
- Types: `X402Challenge`, `PricingConfig`, `VerifierInterface`, `IdempotencyStore`

**Client** (`x402-agent-client`):
- `x402Fetch(url, init, options)` — fetch wrapper
- `createTool(config)` — agent tool factory
- Types: `PayerInterface`, `RequestContext`, `PaymentProof`, `X402FetchOptions`, `ToolConfig`

**Adapters** (`x402-adapters`):
- `MockPayer` — HMAC payer
- `MockVerifier` — HMAC verifier

## Real Payer Roadmap

When implementing the real adapter:

1. `RealVerifier.verify()`: call Coinbase x402 verification API or verify on-chain transaction.
2. `RealPayer.pay()`: use a wallet (e.g. Coinbase Wallet SDK, viem) to sign and broadcast an ERC-20 transfer.
3. Wire format: switch to `{ accepts: [{ scheme: 'exact', ... }] }` per Coinbase spec.
4. Update `X-Payment-Proof` → `X-PAYMENT` per Coinbase spec, or keep extensible.

Do NOT implement until all mock-mode acceptance criteria pass.

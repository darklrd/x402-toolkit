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
- `MockPayer` — HMAC payer (default subpath `x402-adapters`)
- `MockVerifier` — HMAC verifier (default subpath `x402-adapters`)
- `SolanaUSDCPayer` — real SPL token transfer payer (subpath `x402-adapters/solana`)
- `SolanaUSDCVerifier` — on-chain tx verifier (subpath `x402-adapters/solana`)

## SolanaUSDCPayer / SolanaUSDCVerifier

The Solana adapter performs real on-chain USDC transfers on Solana devnet.

### Key design decisions

**Subpath export** (`x402-adapters/solana`): `@solana/web3.js` is a large dependency. Mock-only users import from `x402-adapters` and never pay the bundle cost.

**Recipient ATA pre-creation**: The payer throws `"Recipient has no USDC token account"` if the recipient's Associated Token Account (ATA) does not exist. The payer does NOT auto-create it — auto-creation adds lamports to the tx and requires the payer to fund an account for the recipient, which changes the trust model. Recipients must run `spl-token create-account` once before receiving payments.

**Memo binding**: Every payment transaction includes a Memo instruction:
```
Memo: "${nonce}|${requestHash}"
```
This cryptographically binds the on-chain tx to a specific 402 challenge nonce and request. A tx from a different request cannot be replayed here even if it reaches the same recipient address. The verifier checks this memo before accepting payment.

**Amount arithmetic with bigint**: Price strings (e.g. `"0.001"`) are converted to micro-USDC using string splitting and `BigInt()` arithmetic to avoid floating-point precision errors. For example, `"0.001"` → `1000n` micro-USDC (never `999n` or `1001n`).

**Recipient verification without extra RPC call**: Rather than fetching the destination ATA account to check its owner, the verifier derives the expected ATA address with `getAssociatedTokenAddressSync(USDC_DEVNET_MINT, new PublicKey(pricing.recipient))` and compares it directly to the instruction's `destination` field. This avoids a round-trip to the RPC node.

**Type-safe RPC response parsing**: `@solana/web3.js` types `ParsedInstruction.parsed` as `any`. To avoid propagating `any`, the verifier assigns `ix.parsed` to `const parsed: unknown` and narrows it through a local type guard `isTransferCheckedParsed(parsed: unknown)` before reading any fields.

**blockTime validation**: The verifier rejects transactions where:
- `blockTime` is null (not yet confirmed)
- `blockTime` is older than 600 seconds (stale tx reuse prevention)
- `blockTime` is after `proof.expiresAt` (tx submitted after challenge expired)

### Switching adapters

Both demo apps use a single `PAYMENT_MODE` env var:
```
PAYMENT_MODE=mock    # default — MockPayer/MockVerifier, no network
PAYMENT_MODE=solana  # SolanaUSDCPayer/SolanaUSDCVerifier, Solana devnet
```

# Work Plan: Rate Limiting Middleware for x402-tool-server (#9)

## Status

A skeleton already exists at `packages/x402-tool-server/src/rate-limit.ts` with basic structure. It needs refinement, export wiring, and full test coverage.

---

## 1. Architecture

### 1.1 Request Lifecycle Position

Rate limiting runs **before** the x402 payment check. The plugin registers an `onRequest` hook (the existing skeleton already does this). This is correct because:

- Prevents abusive callers from triggering expensive verifier/payer logic
- A rate-limited client shouldn't burn a payment proof on a rejected request
- `onRequest` fires before `preParsing` (body capture) and `preHandler` (payment gate)

Hook execution order: `onRequest` (rate limit) → `preParsing` (raw body capture) → `preHandler` (x402 payment gate) → handler.

### 1.2 Plugin Registration Pattern

The existing skeleton correctly uses `fp()` wrapping with `fastify-plugin` to escape scope encapsulation, matching the `createX402Middleware` pattern. The plugin is registered as:

```ts
fastify.register(rateLimitMiddleware, { maxRequests: 100, windowMs: 60_000 });
```

### 1.3 Data Structure

Fixed-window counter using `Map<string, WindowEntry>`:

```ts
interface WindowEntry {
  count: number;
  windowStart: number;
}
```

This is already implemented in the skeleton. Each key (default: `request.ip`) maps to a counter + window start timestamp.

### 1.4 Cleanup Strategy

Lazy cleanup on every request, throttled to run at most once per 60 seconds. Iterates the map and deletes entries where `now - windowStart >= windowMs`. No background interval timer needed — avoids the unref/leak complexity.

This is already implemented in the skeleton.

---

## 2. Files to Create/Modify

### 2.1 `packages/x402-tool-server/src/rate-limit.ts` — MODIFY (minor refinements)

The existing file is nearly complete. Changes needed:

1. **Add `RateLimitInfo` response type** for the 429 body (avoid inline object literal):

```ts
interface RateLimitResponseBody {
  error: string;
  retryAfter: number;
}
```

2. **Export the `WindowEntry` type** for testability (or keep internal — no strong need).

3. **Expose a `reset()` or store access method** for testing cleanup behavior. Two options:
   - Option A: Accept an injectable `Map` in options (testable but over-engineered)
   - Option B: Return the plugin + expose a `getStoreForTesting` decorated on the fastify instance

   **Recommendation:** Neither. Test cleanup behavior through the public HTTP interface by manipulating time with `vi.useFakeTimers()`.

**Final type signatures (current, no changes needed):**

```ts
export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyExtractor?: (request: FastifyRequest) => string;
}

export const rateLimitMiddleware: FastifyPluginAsync<RateLimitOptions>;
```

### 2.2 `packages/x402-tool-server/src/index.ts` — MODIFY

Add export for the rate limiting middleware:

```ts
export { rateLimitMiddleware } from './rate-limit.js';
export type { RateLimitOptions } from './rate-limit.js';
```

### 2.3 `tests/unit/rate-limit.test.ts` — CREATE

New file. ~12 test cases (see §3).

### 2.4 `tests/integration/rate-limit-e2e.test.ts` — CREATE

New file. ~6 test cases (see §4).

### 2.5 No other files need changes.

---

## 3. Unit Tests — `tests/unit/rate-limit.test.ts`

Test server builder pattern (follow `server.test.ts` style):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { rateLimitMiddleware } from 'x402-tool-server';
```

Helper: `buildRateLimitedServer(opts: Partial<RateLimitOptions>)` → registers `rateLimitMiddleware` with defaults `{ maxRequests: 3, windowMs: 10_000 }`, adds a `GET /test` route returning `{ ok: true }`.

### Test Cases

| # | Test Name | Description |
|---|-----------|-------------|
| 1 | `allows requests under the limit` | Send `maxRequests` requests, all return 200 |
| 2 | `returns 429 when limit is exceeded` | Send `maxRequests + 1` requests, last one returns 429 |
| 3 | `429 response body contains error and retryAfter` | Verify `{ error: 'Too Many Requests', retryAfter: <number> }` |
| 4 | `429 response includes Retry-After header` | `Retry-After` header is a positive integer string |
| 5 | `Retry-After value decreases as window progresses` | Advance time partway through window, verify Retry-After is smaller |
| 6 | `window resets after windowMs elapses` | Exhaust limit, advance time past window, next request succeeds |
| 7 | `different IPs are tracked independently` | Exhaust limit for IP-A, IP-B still gets 200 |
| 8 | `custom keyExtractor uses provided function` | Extract key from a header instead of IP; verify independent tracking |
| 9 | `cleanup removes expired entries` | Exhaust limit, advance time past window + 60s cleanup interval, send new request (triggers cleanup), verify it succeeds |
| 10 | `cleanup does not remove active windows` | Create entries for two IPs, advance time to expire only one, verify the active one still rate-limits |
| 11 | `maxRequests of 1 blocks second request` | Edge case: limit=1, first request OK, second blocked |
| 12 | `different routes share the same rate limit counter` | Hit `/test-a` and `/test-b`, verify they share the counter (global rate limit) |

### Time Manipulation

Use `vi.useFakeTimers()` / `vi.advanceTimersByTime()` / `vi.useRealTimers()` for window expiry tests. Mock `Date.now` for deterministic behavior.

**Important:** The rate limiter uses `Date.now()` directly, so `vi.useFakeTimers()` will intercept it. Confirm this works with the existing implementation; if it uses raw performance timers, adapt.

### Test Structure

```ts
describe('Rate limit middleware', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  // ... test cases
});
```

---

## 4. Integration Tests — `tests/integration/rate-limit-e2e.test.ts`

Test server builder: registers **both** `rateLimitMiddleware` and `createX402Middleware`, plus free and priced routes. Uses a real HTTP server (`fastify.listen({ port: 0 })`).

### Test Cases

| # | Test Name | Description |
|---|-----------|-------------|
| 1 | `rate limit fires before x402 payment check` | Exhaust rate limit, then send a request with valid payment proof — should get 429, not 402 or 200 |
| 2 | `free routes are also rate limited` | Hit `/health` past the limit, verify 429 |
| 3 | `priced route returns 402 challenge when under rate limit` | Normal behavior preserved — under limit, no proof → 402 |
| 4 | `priced route returns 200 with valid payment when under rate limit` | Normal paid flow still works when rate limit not exhausted |
| 5 | `rate limit resets and payment works after window expires` | Exhaust limit, wait, then successfully complete a paid request |
| 6 | `different clients (IPs) have independent rate limits` | Two different clients can both make requests up to the limit independently |

### Registration Order

```ts
// Rate limit FIRST — runs onRequest before x402's preParsing/preHandler
fastify.register(rateLimitMiddleware, { maxRequests: 5, windowMs: 10_000 });
fastify.register(createX402Middleware({ verifier: new MockVerifier({ secret: SECRET }) }));
```

### Server Builder

```ts
async function buildE2EServerWithRateLimit() {
  const fastify = Fastify({ logger: false });
  
  fastify.register(rateLimitMiddleware, { maxRequests: 5, windowMs: 10_000 });
  fastify.register(createX402Middleware({
    verifier: new MockVerifier({ secret: SECRET }),
  }));

  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.route(pricedRoute({
    method: 'GET',
    url: '/weather',
    pricing: PRICING,
    handler: async (req) => {
      const { city } = req.query as { city: string };
      return { city, temp: 20 };
    },
  }));

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}
```

---

## 5. Constraints Checklist

- [x] No `any` or `unknown` types — existing skeleton has none; maintain this
- [x] No unnecessary comments or JSDoc — strip any that exist in the skeleton
- [x] Zero new dependencies — uses only `fastify`, `fastify-plugin` (already deps)
- [x] Must not break existing 113 tests — only adding new exports and new test files
- [x] Plugin uses `fp()` wrapping consistent with `createX402Middleware`
- [x] `fastify: '>=4.0.0'` version constraint in `fp()` options

---

## 6. Implementation Order

1. **Refine `rate-limit.ts`** — minor cleanup (remove any unnecessary comments, ensure strict types)
2. **Update `index.ts`** — add `rateLimitMiddleware` and `RateLimitOptions` exports
3. **Write `tests/unit/rate-limit.test.ts`** — all 12 unit tests
4. **Write `tests/integration/rate-limit-e2e.test.ts`** — all 6 integration tests
5. **Run full test suite** — `npx vitest run` — verify all 113 existing + new tests pass
6. **Build** — `npm run build` in the package to verify TypeScript compilation

---

## 7. Appendix: Current rate-limit.ts Skeleton (for reference)

The existing file at `packages/x402-tool-server/src/rate-limit.ts` is **functionally complete**. The main gaps are:

1. **Not exported from `index.ts`** — consumers can't import it
2. **No test coverage** — zero tests exist for this module
3. **Minor: has some comments that could be trimmed** per project conventions

The implementation logic (fixed-window counting, lazy cleanup, `onRequest` hook, 429 + Retry-After) is correct and needs no algorithmic changes.

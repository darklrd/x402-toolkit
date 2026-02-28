# x402 Paywalled Agent Tools

> Gate any HTTP tool endpoint behind a micropayment using the [HTTP 402](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402) Payment Required status — with automatic 402 → pay → retry handled by the client.

Works **100% offline/locally** with a mock payer. No real funds, no wallet, no chain required in the default mode.

[![CI](https://github.com/your-org/x402-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/x402-toolkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it is

`x402-toolkit` is a TypeScript monorepo with three packages:

| Package | Description |
|---|---|
| [`x402-tool-server`](packages/x402-tool-server) | Fastify middleware to price HTTP endpoints using x402 |
| [`x402-agent-client`](packages/x402-agent-client) | Client that auto-handles 402 → pay → retry |
| [`x402-adapters`](packages/x402-adapters) | Mock (and future real) payer/verifier implementations |

---

## 30-second quickstart

```bash
git clone https://github.com/your-org/x402-toolkit
cd x402-toolkit
pnpm install
pnpm build
pnpm dev       # starts the weather server + CLI demo
```

You'll see:

```
→ GET http://127.0.0.1:3000/weather?city=London
  (no payment proof — expecting 402…)
✅ Payment accepted — response:
{ "city": "London", "temp": 15, "condition": "Cloudy", "humidity": 72, "unit": "celsius" }
```

---

## Add a priced tool in ~10 lines

**Server** (Fastify):

```ts
import Fastify from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { MockVerifier } from 'x402-adapters';

const app = Fastify();
app.register(createX402Middleware({ verifier: new MockVerifier() }));

app.route(pricedRoute({
  method: 'GET',
  url: '/my-tool',
  pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: '0x…' },
  handler: async (req) => ({ result: 'hello' }),
}));

await app.listen({ port: 3000 });
```

**Client**:

```ts
import { x402Fetch } from 'x402-agent-client';
import { MockPayer } from 'x402-adapters';

const payer = new MockPayer();
const res = await x402Fetch('http://localhost:3000/my-tool', {}, { payer });
console.log(await res.json()); // { result: 'hello' }
```

---

## Sequence diagram

```
Client                         Server
  │── GET /my-tool ───────────▶ │  (no proof → issue 402 challenge)
  │◀── 402 { x402: challenge } ─│
  │
  │  payer.pay(challenge) → PaymentProof
  │
  │── GET /my-tool ───────────▶ │  X-Payment-Proof: <base64url proof>
  │                              │  verifier.verify(proof, requestHash)
  │◀── 200 { result: 'hello' } ─│
```

See [docs/SEQUENCE.md](docs/SEQUENCE.md) for all flows (idempotency, replay, conflicts).

---

## Agent-friendly tool wrapper

```ts
import { createTool } from 'x402-agent-client';
import { MockPayer } from 'x402-adapters';

const payer = new MockPayer();

const weatherTool = createTool({
  name: 'get_weather',
  description: 'Fetch current weather for a city (costs 0.001 USDC)',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  endpoint: 'http://localhost:3000/weather',
  method: 'GET',
  fetchOptions: { payer },
});

// Use in any agent framework:
const result = await weatherTool.invoke({ city: 'Tokyo' });
console.log(result.data); // { city: 'Tokyo', temp: 26, ... }
```

---

## Security notes

### Replay protection
Every 402 challenge includes a **unique nonce** (UUID). The server tracks used nonces in memory (until `expiresAt + 60s`). Replaying a captured proof with the same nonce returns 402.

### Proof expiry
Challenges expire after **300 seconds** (configurable via `ttlSeconds`). Proofs rejected after expiry regardless of signature validity.

### requestHash binding
The proof is bound to the exact canonical request:
```
SHA-256(METHOD + "\n" + PATHNAME + "\n" + CANONICAL_QUERY + "\n" + RAW_BODY)
```
A proof for `GET /weather?city=Paris` cannot be used for `GET /weather?city=Tokyo`.

### Idempotency
Pass an `Idempotency-Key` header to prevent double-charging on retries. The server returns a stored response if the same key + same requestHash is seen again (`X-Idempotent-Replay: true`). A conflicting key (same key, different request) returns 409.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat analysis.

---

## Mock vs Real payer

| | Mock (default) | Real (TODO) |
|---|---|---|
| Proof | HMAC-SHA256 | On-chain tx / EIP-712 |
| Funds | No real funds | USDC on Base (planned) |
| Works offline | ✅ | ❌ |
| Production-ready | No | Yes (when implemented) |

The real adapter will live in `packages/x402-adapters/src/real/`. See [docs/DESIGN.md](docs/DESIGN.md#real-payer-roadmap) for the integration plan.

---

## Commands

```bash
pnpm install        # install all dependencies
pnpm build          # compile all packages
pnpm dev            # start demo server + run CLI demo
pnpm test           # run all tests
pnpm lint           # lint all TypeScript
```

---

## Package structure

```
packages/
  x402-tool-server/    Fastify middleware + types (no mock logic)
  x402-agent-client/   Client fetch wrapper + createTool (no mock logic)
  x402-adapters/       MockPayer, MockVerifier (adapters/real is TODO)
examples/
  paid-weather-tool/   Fastify weather server with priced /weather route
  cli-agent-demo/      CLI demo: 402 → pay → retry + createTool
docs/
  SEQUENCE.md          Flow diagrams
  THREAT_MODEL.md      Security analysis
  DESIGN.md            Architectural decisions
evals/
  quick_eval.ts        50-call latency + success rate eval
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

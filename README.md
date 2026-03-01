# x402 Paywalled Agent Tools

> Gate any HTTP tool endpoint behind a micropayment using the [HTTP 402](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402) Payment Required status — with automatic 402 → pay → retry handled by the client.

Works **100% offline/locally** with the mock payer. No real funds, no wallet, no chain required in the default mode. Switch to **real Solana USDC payments on devnet** with a single env var.

[![CI](https://github.com/your-org/x402-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/x402-toolkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it is

`x402-toolkit` is a TypeScript monorepo with three packages:

| Package | Description |
|---|---|
| [`x402-tool-server`](packages/x402-tool-server) | Fastify middleware to price HTTP endpoints using x402 |
| [`x402-agent-client`](packages/x402-agent-client) | Client that auto-handles 402 → pay → retry |
| [`x402-adapters`](packages/x402-adapters) | Payer/verifier implementations (mock + Solana USDC) |

---

## 30-second quickstart (mock mode)

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

## Solana devnet quickstart (real USDC)

1. **Fund your devnet wallet:**

```bash
solana airdrop 2 $(solana address) --url devnet          # SOL for fees
# Get devnet USDC from https://faucet.circle.com
```

2. **Create the recipient's USDC token account** (required before receiving payments):

```bash
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --owner $(solana address) --url devnet
```

3. **Configure and run:**

```bash
cp examples/.env.solana.example examples/.env.solana
# Edit examples/.env.solana — set RECIPIENT_WALLET and SOLANA_PRIVATE_KEY

pnpm exec tsx scripts/setup-devnet.ts   # verify balances + ATA readiness

set -a && source examples/.env.solana && set +a && pnpm build && pnpm dev
```

Each request now sends a real SPL token transfer on Solana devnet and verifies it on-chain before serving the response (~500ms confirmation time).

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

To use real Solana USDC, swap the adapter:

```ts
import { SolanaUSDCVerifier } from 'x402-adapters/solana'; // server
import { SolanaUSDCPayer }    from 'x402-adapters/solana'; // client
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
  fetchOptions: { payer: new MockPayer() },
});

const result = await weatherTool.invoke({ city: 'Tokyo' });
console.log(result.data); // { city: 'Tokyo', temp: 26, ... }
```

---

## Security notes

### Replay protection
Every 402 challenge includes a **unique nonce** (UUID). The server tracks used nonces in memory (until `expiresAt + 60s`). Replaying a captured proof with the same nonce returns 402.

### Proof expiry
Challenges expire after **300 seconds** (configurable via `ttlSeconds`). Proofs are rejected after expiry regardless of signature validity.

### requestHash binding
The proof is bound to the exact canonical request:
```
SHA-256(METHOD + "\n" + PATHNAME + "\n" + CANONICAL_QUERY + "\n" + RAW_BODY)
```
A proof for `GET /weather?city=Paris` cannot be used for `GET /weather?city=Tokyo`.

### Solana memo binding
In Solana mode, every payment transaction includes a **Memo instruction** containing `nonce|requestHash`. The verifier checks this memo before accepting payment, ensuring a tx from a different request cannot be replayed here even if it reaches the same recipient.

### Idempotency
Pass an `Idempotency-Key` header to prevent double-charging on retries. The server returns a stored response if the same key + same requestHash is seen again (`X-Idempotent-Replay: true`). A conflicting key (same key, different request) returns 409.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat analysis.

---

## Mock vs Solana USDC

| | Mock (default) | Solana USDC (devnet) |
|---|---|---|
| Proof | HMAC-SHA256 | On-chain SPL token transfer + memo |
| Funds | No real funds | USDC on Solana devnet |
| Works offline | ✅ | ❌ |
| Confirmation time | ~0ms | ~500ms |
| Switch via | default | `PAYMENT_MODE=solana` |

---

## Commands

```bash
pnpm install                    # install all dependencies
pnpm build                      # compile all packages (required before running demos)
pnpm dev                        # start demo server + run CLI demo (mock mode)
pnpm test                       # run all 77 tests
pnpm lint                       # lint all TypeScript
pnpm eval                       # 50-call latency + success rate eval

pnpm exec tsx scripts/setup-devnet.ts   # check Solana devnet balances + ATA readiness
```

---

## Package structure

```
packages/
  x402-tool-server/    Fastify middleware + types (no adapter logic)
  x402-agent-client/   Client fetch wrapper + createTool (no adapter logic)
  x402-adapters/
    src/mock/          MockPayer, MockVerifier (HMAC-SHA256, offline)
    src/solana/        SolanaUSDCPayer, SolanaUSDCVerifier (devnet)
examples/
  paid-weather-tool/   Fastify weather server (mock or solana via PAYMENT_MODE)
  cli-agent-demo/      CLI demo: 402 → pay → retry + createTool
  .env.solana.example  Env var template for Solana mode
scripts/
  setup-devnet.ts      Check Solana devnet balances + ATA readiness
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

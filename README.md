# x402-toolkit

> **The Fastify-native x402 payment toolkit for AI agents.**
> Gate any HTTP endpoint behind a micropayment. Agents auto-handle 402 → pay → retry.

[![CI](https://github.com/darklrd/x402-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/darklrd/x402-toolkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![x402](https://img.shields.io/badge/protocol-x402-blue)](https://x402.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6)](https://www.typescriptlang.org)

```
Agent                          Your Fastify API
  │── GET /weather ───────────▶ │  no payment? → 402 challenge
  │◀── 402 { challenge } ───────│
  │    payer.pay(challenge)      │
  │── GET /weather ───────────▶ │  X-Payment-Proof: <proof>
  │◀── 200 { temp: 22°C } ──────│  ✅ verified + served
```

Works **100% offline** in mock mode. Switch to real **Solana USDC** with one env var.

---

## Why x402-toolkit?

The [official coinbase/x402](https://github.com/coinbase/x402) supports Express, Hono, and Next.js.
**x402-toolkit is the Fastify implementation** — plus extras the official SDK doesn't have:

| Feature | coinbase/x402 | x402-toolkit |
|---------|:---:|:---:|
| Fastify middleware | ❌ | ✅ |
| Mock mode (offline dev, zero config) | ❌ | ✅ |
| Payment receipts + audit trail | ❌ | ✅ |
| Idempotency protection | ❌ | ✅ |
| Nonce replay protection | ✅ | ✅ |
| Solana USDC (devnet + mainnet) | ✅ | ✅ |
| Agent-friendly `createTool` wrapper | ❌ | ✅ |
| requestHash binding | ✅ | ✅ |
| Docker Compose quickstart | ❌ | ✅ |

---

## Packages

| Package | Description |
|---|---|
| [`x402-tool-server`](packages/x402-tool-server) | Fastify plugin — gate routes behind x402 payments |
| [`x402-agent-client`](packages/x402-agent-client) | Client — auto-handles 402 → pay → retry |
| [`x402-adapters`](packages/x402-adapters) | Adapters — mock (offline) + Solana USDC |
| [`x402-langchain`](packages/x402-langchain) | LangChain `StructuredTool` adapter for x402 |

---

## Quickstart (mock mode — no wallet needed)

```bash
git clone https://github.com/darklrd/x402-toolkit
cd x402-toolkit && pnpm install && pnpm build
pnpm dev
```

Or with Docker:

```bash
docker compose up --build
```

Output:
```
→ GET http://127.0.0.1:3000/weather?city=London
  (no payment — expecting 402…)
✅ Payment accepted:
{ "city": "London", "temp": 15, "condition": "Cloudy" }
```

---

## Add a priced endpoint in ~10 lines

**Server:**

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
  handler: async () => ({ result: 'hello' }),
}));

await app.listen({ port: 3000 });
```

**Agent (auto-pays):**

```ts
import { x402Fetch } from 'x402-agent-client';
import { MockPayer } from 'x402-adapters';

const res = await x402Fetch('http://localhost:3000/my-tool', {}, { payer: new MockPayer() });
console.log(await res.json()); // { result: 'hello' }
```

**Switch to real Solana USDC** by swapping one import:

```ts
import { SolanaUSDCVerifier } from 'x402-adapters/solana'; // server
import { SolanaUSDCPayer }    from 'x402-adapters/solana'; // client
```

---

## Agent tool wrapper (LangChain-compatible)

```ts
import { createTool } from 'x402-agent-client';
import { MockPayer } from 'x402-adapters';

const weatherTool = createTool({
  name: 'get_weather',
  description: 'Fetch weather for a city (costs 0.001 USDC)',
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
// { city: 'Tokyo', temp: 26, condition: 'Sunny' }
```

---

## LangChain Agent Integration

Use x402 tools directly in any LangChain agent:

```ts
import { X402Tool } from 'x402-langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MockPayer } from 'x402-adapters';
import { z } from 'zod';

const weatherTool = new X402Tool({
  name: 'get_weather',
  description: 'Get current weather for a city. Costs 0.001 USDC per call.',
  schema: z.object({ city: z.string().describe('City name') }),
  endpoint: 'http://localhost:3000/weather',
  method: 'GET',
  fetchOptions: { payer: new MockPayer() },
});

const agent = createReactAgent({ llm: new ChatOpenAI({ model: 'gpt-4o-mini' }), tools: [weatherTool] });
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
});
```

See [`examples/langchain-agent`](examples/langchain-agent) for a full working example.

---

## Solana quickstart (real USDC)

Defaults to **devnet**. Set `SOLANA_CLUSTER=mainnet` for production.

```bash
# 1. Fund devnet wallet
solana airdrop 2 $(solana address) --url devnet
# Get devnet USDC: https://faucet.circle.com

# 2. Create recipient token account
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --owner $(solana address) --url devnet

# 3. Configure and run
cp examples/.env.solana.example examples/.env.solana
# Set RECIPIENT_WALLET and SOLANA_PRIVATE_KEY

pnpm exec tsx scripts/setup-solana.ts   # verify balances
set -a && source examples/.env.solana && set +a && pnpm dev
```

Each request sends a real SPL token transfer + on-chain memo (~500ms confirmation).

### Mainnet

```bash
SOLANA_CLUSTER=mainnet
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>  # paid RPC recommended
```

| | Devnet | Mainnet |
|---|---|---|
| USDC mint | `4zMMC9srt5…` | `EPjFWdd5Au…` |
| Funds | Free faucet | Real USDC |
| RPC | Public (free) | Paid provider recommended |

---

## Security

### Replay protection
Every challenge includes a unique UUID nonce. Used nonces are tracked until `expiresAt + 60s`. Replaying a proof returns 402.

### requestHash binding
Proof is bound to the exact request:
```
SHA-256(METHOD + "\n" + PATHNAME + "\n" + CANONICAL_QUERY + "\n" + RAW_BODY)
```
A proof for `GET /weather?city=Paris` cannot be used for `GET /weather?city=Tokyo`.

### Proof expiry
Challenges expire after 300s (configurable via `ttlSeconds`).

### Solana memo binding
Every Solana payment tx includes `Memo("nonce|requestHash")` — a tx from a different request cannot be replayed even if it reaches the same recipient.

### Idempotency
Pass `Idempotency-Key` to prevent double-charging on retries. Same key + same request → replays stored response (`X-Idempotent-Replay: true`). Same key + different request → 409.

### Payment receipts
Enable the receipt store for full audit trail:

```ts
import { createX402Middleware, MemoryReceiptStore } from 'x402-tool-server';

const receiptStore = new MemoryReceiptStore();
app.register(createX402Middleware({ verifier, receiptStore }));

// Auto-registered: GET /x402/receipts/:nonce
// → { nonce, payer, amount, asset, endpoint, requestHash, paidAt }
```

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat analysis.

---

## Mock vs Solana

| | Mock | Solana devnet | Solana mainnet |
|---|---|---|---|
| Proof | HMAC-SHA256 | On-chain SPL + memo | On-chain SPL + memo |
| Funds required | None | Free faucet | Real USDC |
| Works offline | ✅ | ❌ | ❌ |
| Confirmation | ~0ms | ~500ms | ~500ms–13s |
| `PAYMENT_MODE` | `default` | `solana` | `solana` |
| `SOLANA_CLUSTER` | — | `devnet` | `mainnet` |

---

## Commands

```bash
pnpm install          # install all dependencies
pnpm build            # compile all packages
pnpm dev              # start demo server + CLI agent (mock mode)
pnpm test             # run all 82 tests
pnpm lint             # lint TypeScript
pnpm eval             # 50-call latency + success rate eval

pnpm exec tsx scripts/setup-solana.ts  # check Solana balances + ATA readiness
```

---

## Repo structure

```
packages/
  x402-tool-server/    Fastify middleware + receipts + idempotency
  x402-agent-client/   x402Fetch + createTool wrapper
  x402-adapters/
    src/mock/          MockPayer, MockVerifier (offline, zero config)
    src/solana/        SolanaUSDCPayer, SolanaUSDCVerifier
examples/
  paid-weather-tool/   Demo Fastify server
  cli-agent-demo/      CLI: 402 → pay → retry
docs/
  SEQUENCE.md          Flow diagrams (happy path, idempotency, replay, receipts)
  THREAT_MODEL.md      Security analysis
  DESIGN.md            Architecture decisions
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially new chain adapters and agent framework integrations.

## License

[MIT](LICENSE)

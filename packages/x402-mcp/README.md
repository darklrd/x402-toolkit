# x402-mcp

Sell and buy **paid MCP tools**. `x402-mcp` makes a remote [Model Context
Protocol](https://modelcontextprotocol.io) server behave like a paid API: an
MCP client attempts a `tools/call`, receives an HTTP **402** payment challenge,
pays through an x402-compatible payer, retries the same call, and gets the
result.

It reuses the rest of the toolkit instead of inventing a second payment stack —
the same verifier, payer, budget, receipts, events, wire-format compatibility,
mock mode, and Solana USDC adapters you already use for paid HTTP routes.

```
MCP client ──tools/call──▶ Fastify route (x402-mcp)
                            ├─ free method            ─▶ forward to MCP server
                            ├─ paid + no proof         ─▶ 402 challenge
                            └─ paid + valid proof      ─▶ verify ▸ receipt ▸ forward ─▶ tool result
```

## Install

```bash
pnpm add x402-mcp @modelcontextprotocol/sdk fastify
# adapters provide MockPayer/MockVerifier (and Solana USDC)
pnpm add -D x402-adapters
```

`@modelcontextprotocol/sdk` (>=1.9) and `fastify` (>=4) are peer dependencies.

## Seller — paid MCP server

```ts
import Fastify from 'fastify';
import { createPaidMcpRegistry, x402McpPlugin, MemoryMcpReceiptStore } from 'x402-mcp';
import { MockVerifier } from 'x402-adapters';

const registry = createPaidMcpRegistry();

registry.tool(
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
    pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: '0xMerchant' },
    discovery: { example: { city: 'London' }, transport: 'streamable-http' },
  },
  async ({ city }) => ({
    content: [{ type: 'text', text: JSON.stringify({ city, tempC: 22 }) }],
  }),
);

const app = Fastify();
await app.register(x402McpPlugin, {
  path: '/mcp',
  registry,
  serverInfo: { name: 'paid-tools', version: '0.1.0' },
  verifier: new MockVerifier(),
  receiptStore: new MemoryMcpReceiptStore(),
  wireFormat: 'dual', // 'toolkit' | 'coinbase' | 'dual'
});
await app.listen({ port: 3402, host: '127.0.0.1' });
```

> **Note** — the registry owns server construction (`registry.createMcpServer`
> is called per request), so you register tools on the registry, not on an
> `McpServer` instance. This is what lets the gate sit cleanly in front of the
> SDK's Streamable HTTP transport.

Only `tools/call` is payable. `initialize`, `tools/list`, `ping`, etc. are free.
Unknown tools fail closed by default (set `allowUnpricedTools: true` to pass
them through). JSON-RPC batches are rejected by default.

## Buyer — payer-enabled MCP client

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createX402McpHttpTransport } from 'x402-mcp';
import { MockPayer } from 'x402-adapters';
import { BudgetTracker } from '@darklrd/x402-agent-client';

const transport = createX402McpHttpTransport('http://127.0.0.1:3402/mcp', {
  payer: new MockPayer(),
  budget: new BudgetTracker({ maxSpend: '0.01' }),
  // Policy runs in code before any payment is signed — never trust model text.
  policy: ({ toolName, challenge }) =>
    toolName === 'get_weather' && challenge.network === 'mock',
});

const client = new Client({ name: 'buyer', version: '0.1.0' });
await client.connect(transport);

const result = await client.callTool({ name: 'get_weather', arguments: { city: 'London' } });
```

The transport auto-detects the challenge format (toolkit body `{ x402 }` or the
Coinbase `payment-required` header), runs your policy, reserves budget, signs,
and retries with the correct proof header.

## Switching from mock to Solana USDC

Swap the adapters — nothing else changes. The payment is bound to the canonical
MCP request hash (`MCP\n<path>\ntools/call\n<toolName>\n<canonicalJson(args)>`),
which the Solana verifier checks against the on-chain memo just like the mock
verifier checks its HMAC.

```ts
// server
import { SolanaUSDCVerifier } from 'x402-adapters/solana';
// ...
verifier: new SolanaUSDCVerifier({ /* rpcUrl, mintAddress, ... */ }),
// price each tool in Solana USDC:
pricing: { price: '0.001', asset: 'USDC', network: 'solana-devnet', recipient: '<recipient pubkey>' },

// client
import { SolanaUSDCPayer } from 'x402-adapters/solana';
// ...
payer: new SolanaUSDCPayer({ /* keypair, rpcUrl, ... */ }),
```

## Discovery metadata

`toBazaarMcpResource(config, baseUrl)` converts a paid tool config into x402
[Bazaar](https://docs.x402.org/extensions/bazaar)-style metadata. It is a helper
only — it does not publish to a facilitator.

## Transport limitations

- **Remote HTTP MCP can be paywalled.** This package gates the Streamable HTTP
  transport.
- **stdio MCP cannot return an HTTP 402** to its caller, so a stdio *server*
  cannot be paywalled on inbound calls.
- **stdio is still useful as a buyer-side bridge** — a local stdio MCP server
  can itself pay outbound paid HTTP APIs.

## Production recommendations

- Use **TLS** — payment proofs travel in headers.
- Use **persistent** nonce / receipt stores for multi-node deployments (the
  built-in stores are in-memory).
- Enforce spend limits and expected tool/price/network in the client **policy**
  hook, in code — not in model prompts.
- Payment is charged **before** tool execution in this MVP, so a tool that
  throws can produce a paid-but-failed call. A facilitator-backed
  settle-after-success mode is future work.

## Notes

- In `dual` / `coinbase` mode the challenge price round-trips through atomic
  units, so the client may observe `'0.001000'` where the server priced
  `'0.001'`. This does not affect verification (proofs bind to nonce +
  requestHash, not price).

## API

| Export | Purpose |
|---|---|
| `createPaidMcpRegistry()` | Register paid tools; build MCP servers |
| `x402McpPlugin` | Fastify plugin — gate + forward Streamable HTTP |
| `createX402McpHttpTransport(url, opts)` | Buyer MCP transport with auto-pay |
| `createMcpPaymentGuard(opts)` | Transport-independent payment guard |
| `computeMcpRequestHash` / `canonicalJson` | Canonical MCP payment hash |
| `toBazaarMcpResource(config, baseUrl)` | Bazaar discovery metadata |
| `MemoryMcpReceiptStore` | In-memory MCP receipts |
| `X402McpEventEmitter` | `x402:mcp:challenge` / `:payment` / `:error` events |

## License

MIT

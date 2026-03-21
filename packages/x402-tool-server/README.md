# x402-tool-server

Fastify middleware for x402 HTTP-payment-gated tool endpoints. Gate any API behind Solana USDC micropayments — agents handle the 402 challenge-response flow automatically.

## Install

```bash
pnpm add x402-tool-server x402-adapters
```

## Quick Start

```ts
import Fastify from 'fastify';
import { x402PaymentMiddleware, defineTool } from 'x402-tool-server';
import { MockVerifier } from 'x402-adapters';

const app = Fastify();
const verifier = new MockVerifier();

app.register(x402PaymentMiddleware, { verifier });

app.get('/weather', {
  config: defineTool({
    name: 'weather',
    description: 'Get current weather',
    price: '0.001',
    recipient: 'your-wallet-address',
  }),
}, async () => {
  return { temp: 22, unit: 'C', conditions: 'sunny' };
});

app.listen({ port: 3000 });
```

### OpenAPI Spec

Auto-generate an OpenAPI 3.0 spec from your priced routes:

```ts
import { openApiPlugin } from 'x402-tool-server';

app.register(openApiPlugin, {
  title: 'My Paid API',
  version: '1.0.0',
  servers: [{ url: 'https://api.example.com' }],
});

// GET /x402/openapi.json → full Swagger spec with x-x402-* pricing extensions
```

## Features

- Fastify-native middleware (the only x402 implementation for Fastify)
- Automatic 402 challenge generation with nonce, price, and recipient
- On-chain payment verification via pluggable adapters
- Request hash binding prevents proof replay across endpoints
- Nonce-based replay protection
- Idempotency store for receipt tracking
- OpenAPI 3.0 spec auto-generation with `x-x402-*` pricing extensions
- Built-in rate limiting

## Links

- [GitHub](https://github.com/darklrd/x402-toolkit)
- [Playground](https://darklrd.github.io/x402-toolkit/)
- [x402 Protocol](https://x402.org)

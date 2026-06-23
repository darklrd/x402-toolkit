/**
 * paid-mcp-server — a Fastify + MCP server that sells two tools with x402.
 *
 * Runs in mock mode by default (no wallet required). Switch to Solana by
 * swapping MockVerifier for SolanaUSDCVerifier from `x402-adapters/solana`
 * and setting network/recipient on each tool's pricing (see README).
 *
 *   pnpm --filter paid-mcp-server dev
 */
import Fastify from 'fastify';
import { createPaidMcpRegistry, x402McpPlugin, MemoryMcpReceiptStore } from 'x402-mcp';
import { MockVerifier } from 'x402-adapters';

const PORT = Number(process.env.PORT ?? 3402);
const HOST = process.env.HOST ?? '127.0.0.1';
const SECRET = process.env.MOCK_SECRET ?? 'mock-secret';

const pricing = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xMerchantWalletAddress',
};

const registry = createPaidMcpRegistry();

registry.tool(
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
    pricing,
    discovery: { example: { city: 'London' }, transport: 'streamable-http' },
  },
  async ({ city }) => ({
    content: [{ type: 'text', text: JSON.stringify({ city, tempC: 22, condition: 'Sunny' }) }],
  }),
);

registry.tool(
  {
    name: 'get_price',
    description: 'Get the current USD price for a ticker symbol',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Ticker symbol, e.g. BTC' } },
      required: ['symbol'],
    },
    pricing,
    discovery: { example: { symbol: 'BTC' }, transport: 'streamable-http' },
  },
  async ({ symbol }) => ({
    content: [{ type: 'text', text: JSON.stringify({ symbol, priceUsd: 42000 }) }],
  }),
);

const receiptStore = new MemoryMcpReceiptStore();
const app = Fastify({ logger: { level: 'info' } });

app.get('/health', async () => ({ status: 'ok' }));

await app.register(x402McpPlugin, {
  path: '/mcp',
  registry,
  serverInfo: { name: 'paid-tools', version: '0.1.0' },
  verifier: new MockVerifier({ secret: SECRET }),
  receiptStore,
  // Emit both the toolkit and Coinbase-compatible challenge formats.
  wireFormat: 'dual',
});

app.x402McpEvents.on('x402:mcp:payment', (event) => {
  app.log.info(
    `paid: ${event.toolName} by ${event.payer} (${event.pricing.price} ${event.pricing.asset})`,
  );
});

await app.listen({ port: PORT, host: HOST });
console.log(`paid-mcp-server listening on http://${HOST}:${PORT}/mcp`);

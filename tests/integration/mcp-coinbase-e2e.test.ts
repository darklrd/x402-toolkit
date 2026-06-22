import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createPaidMcpRegistry, x402McpPlugin, createX402McpHttpTransport } from 'x402-mcp';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { BudgetTracker } from '@darklrd/x402-agent-client';

const SECRET = 'mcp-coinbase-secret';
const pricing = { price: '0.001', asset: 'USDC', network: 'mock', recipient: '0xMerchant' };

async function buildServer() {
  const registry = createPaidMcpRegistry();
  registry.tool(
    {
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      pricing,
    },
    async ({ city }) => ({ content: [{ type: 'text', text: JSON.stringify({ city, temp: 18 }) }] }),
  );

  const app = Fastify({ logger: false });
  await app.register(x402McpPlugin, {
    path: '/mcp',
    registry,
    serverInfo: { name: 'paid-tools', version: '0.1.0' },
    verifier: new MockVerifier({ secret: SECRET }),
    // Emit both wire formats and accept both proof headers.
    wireFormat: 'dual',
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('x402-mcp E2E (Coinbase-compatible dual wire format)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await buildServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('pays via the Coinbase payment-required / payment-signature headers', async () => {
    // The server emits a `payment-required` header (Coinbase format) which the
    // client transport prefers, signing with a `payment-signature` header.
    const transport = createX402McpHttpTransport(`${baseUrl}/mcp`, {
      payer: new MockPayer({ secret: SECRET }),
      budget: new BudgetTracker({ maxSpend: '0.01' }),
    });
    const client = new Client({ name: 'cb-buyer', version: '0.1.0' });
    await client.connect(transport);

    const result = await client.callTool({ name: 'get_weather', arguments: { city: 'Lisbon' } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual({ city: 'Lisbon', temp: 18 });

    await client.close();
  });

  it('the 402 challenge carries the Coinbase payment-required header', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_weather', arguments: { city: 'Lisbon' } },
      }),
    });
    expect(res.status).toBe(402);
    expect(res.headers.get('payment-required')).toBeTruthy();
    // dual also emits the toolkit body
    const body = (await res.json()) as { x402?: unknown };
    expect(body.x402).toBeTruthy();
  });
});

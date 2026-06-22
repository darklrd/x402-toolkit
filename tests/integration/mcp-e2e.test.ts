import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  createPaidMcpRegistry,
  x402McpPlugin,
  createX402McpHttpTransport,
  MemoryMcpReceiptStore,
} from 'x402-mcp';
import type { McpReceiptStore } from 'x402-mcp';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { BudgetTracker } from '@darklrd/x402-agent-client';

const SECRET = 'mcp-e2e-secret';
const pricing = { price: '0.001', asset: 'USDC', network: 'mock', recipient: '0xMerchant' };

const weatherSchema = {
  type: 'object',
  properties: { city: { type: 'string' } },
  required: ['city'],
};
const priceSchema = {
  type: 'object',
  properties: { symbol: { type: 'string' } },
  required: ['symbol'],
};

async function buildServer(receiptStore?: McpReceiptStore) {
  const registry = createPaidMcpRegistry();
  registry.tool(
    { name: 'get_weather', description: 'Get current weather', inputSchema: weatherSchema, pricing },
    async ({ city }) => ({ content: [{ type: 'text', text: JSON.stringify({ city, temp: 22 }) }] }),
  );
  registry.tool(
    { name: 'get_price', description: 'Get a price', inputSchema: priceSchema, pricing },
    async ({ symbol }) => ({ content: [{ type: 'text', text: JSON.stringify({ symbol, price: 42 }) }] }),
  );

  const app = Fastify({ logger: false });
  await app.register(x402McpPlugin, {
    path: '/mcp',
    registry,
    serverInfo: { name: 'paid-tools', version: '0.1.0' },
    verifier: new MockVerifier({ secret: SECRET }),
    receiptStore,
    wireFormat: 'toolkit',
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${addr.port}` };
}

function rpcPost(baseUrl: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function callBody(name: string, args: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function encodeProof(proof: unknown): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

describe('x402-mcp E2E (toolkit wire format)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let receiptStore: MemoryMcpReceiptStore;

  beforeAll(async () => {
    receiptStore = new MemoryMcpReceiptStore();
    ({ app, baseUrl } = await buildServer(receiptStore));
  });

  afterAll(async () => {
    await app.close();
    receiptStore.destroy();
  });

  it('a mock buyer pays for get_weather and receives the result', async () => {
    const transport = createX402McpHttpTransport(`${baseUrl}/mcp`, {
      payer: new MockPayer({ secret: SECRET }),
      budget: new BudgetTracker({ maxSpend: '0.01' }),
    });
    const client = new Client({ name: 'buyer', version: '0.1.0' });
    await client.connect(transport);

    const result = await client.callTool({ name: 'get_weather', arguments: { city: 'London' } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual({ city: 'London', temp: 22 });

    await client.close();
  });

  it('free tools/list works without spending (payer is never invoked)', async () => {
    const throwingPayer = {
      pay: () => {
        throw new Error('payer should not be called for tools/list');
      },
    };
    const transport = createX402McpHttpTransport(`${baseUrl}/mcp`, { payer: throwingPayer });
    const client = new Client({ name: 'lister', version: '0.1.0' });
    await client.connect(transport);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(['get_price', 'get_weather']);

    await client.close();
  });

  it('records a receipt with toolName "get_weather"', async () => {
    const challengeRes = await rpcPost(baseUrl, callBody('get_weather', { city: 'Paris' }));
    expect(challengeRes.status).toBe(402);
    const challenge = ((await challengeRes.json()) as { x402: { nonce: string } }).x402;

    const payer = new MockPayer({ secret: SECRET });
    const proof = await payer.pay(challenge as never, { url: `${baseUrl}/mcp`, method: 'POST' });

    const paidRes = await rpcPost(baseUrl, callBody('get_weather', { city: 'Paris' }), {
      'x-payment-proof': encodeProof(proof),
    });
    expect(paidRes.status).toBe(200);

    const receipt = receiptStore.get(challenge.nonce);
    expect(receipt?.toolName).toBe('get_weather');
    expect(receipt?.network).toBe('mock');
  });

  it('emits x402:mcp:payment on app.x402McpEvents for a paid call', async () => {
    const paidTools: string[] = [];
    app.x402McpEvents.on('x402:mcp:payment', (event) => paidTools.push(event.toolName));

    const challengeRes = await rpcPost(baseUrl, callBody('get_weather', { city: 'Cairo' }));
    const challenge = ((await challengeRes.json()) as { x402: { nonce: string } }).x402;
    const payer = new MockPayer({ secret: SECRET });
    const proof = await payer.pay(challenge as never, { url: `${baseUrl}/mcp`, method: 'POST' });

    const paid = await rpcPost(baseUrl, callBody('get_weather', { city: 'Cairo' }), {
      'x-payment-proof': encodeProof(proof),
    });
    expect(paid.status).toBe(200);

    expect(paidTools).toContain('get_weather');
  });

  it('rejects replay of the same proof', async () => {
    const challengeRes = await rpcPost(baseUrl, callBody('get_weather', { city: 'Berlin' }));
    const challenge = ((await challengeRes.json()) as { x402: { nonce: string } }).x402;
    const payer = new MockPayer({ secret: SECRET });
    const proof = await payer.pay(challenge as never, { url: `${baseUrl}/mcp`, method: 'POST' });
    const header = encodeProof(proof);

    const first = await rpcPost(baseUrl, callBody('get_weather', { city: 'Berlin' }), {
      'x-payment-proof': header,
    });
    expect(first.status).toBe(200);

    const replay = await rpcPost(baseUrl, callBody('get_weather', { city: 'Berlin' }, 2), {
      'x-payment-proof': header,
    });
    expect(replay.status).toBe(402);
  });

  it('rejects a proof minted for get_weather when used on get_price', async () => {
    const challengeRes = await rpcPost(baseUrl, callBody('get_weather', { city: 'Rome' }));
    const challenge = ((await challengeRes.json()) as { x402: { nonce: string } }).x402;
    const payer = new MockPayer({ secret: SECRET });
    const proof = await payer.pay(challenge as never, { url: `${baseUrl}/mcp`, method: 'POST' });

    const crossUse = await rpcPost(baseUrl, callBody('get_price', { symbol: 'BTC' }), {
      'x-payment-proof': encodeProof(proof),
    });
    expect(crossUse.status).toBe(402);
  });

  it('budget exceeded prevents the payer from signing', async () => {
    let payCalls = 0;
    const payer = new MockPayer({ secret: SECRET });
    const countingPayer = {
      pay: (...args: Parameters<typeof payer.pay>) => {
        payCalls += 1;
        return payer.pay(...args);
      },
    };
    const transport = createX402McpHttpTransport(`${baseUrl}/mcp`, {
      payer: countingPayer,
      budget: new BudgetTracker({ maxSpend: '0.0001' }), // less than 0.001 price
    });
    const client = new Client({ name: 'broke-buyer', version: '0.1.0' });
    await client.connect(transport);

    await expect(
      client.callTool({ name: 'get_weather', arguments: { city: 'Oslo' } }),
    ).rejects.toThrow();
    expect(payCalls).toBe(0);

    await client.close();
  });

  it('policy denial prevents the payer from signing', async () => {
    let payCalls = 0;
    const payer = new MockPayer({ secret: SECRET });
    const countingPayer = {
      pay: (...args: Parameters<typeof payer.pay>) => {
        payCalls += 1;
        return payer.pay(...args);
      },
    };
    const transport = createX402McpHttpTransport(`${baseUrl}/mcp`, {
      payer: countingPayer,
      policy: ({ toolName }) => toolName === 'get_price', // deny get_weather
    });
    const client = new Client({ name: 'policy-buyer', version: '0.1.0' });
    await client.connect(transport);

    await expect(
      client.callTool({ name: 'get_weather', arguments: { city: 'Madrid' } }),
    ).rejects.toThrow();
    expect(payCalls).toBe(0);

    await client.close();
  });
});

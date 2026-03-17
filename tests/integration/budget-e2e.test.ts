import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { x402Fetch, createTool, BudgetTracker, BudgetExceededError } from '@darklrd/x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'budget-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xBUDGET',
};

async function buildServer() {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 22 };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('Budget e2e integration', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;
  let payer: MockPayer;

  beforeAll(async () => {
    ({ fastify, baseUrl } = await buildServer());
    payer = new MockPayer({ secret: SECRET });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('x402Fetch with sufficient budget succeeds and tracks spend', async () => {
    const budget = new BudgetTracker({ maxSpend: '1.0' });
    const res = await x402Fetch(
      `${baseUrl}/weather?city=London`,
      {},
      { payer, maxRetries: 1, budget },
    );
    expect(res.status).toBe(200);
    expect(budget.spent).toBe(PRICING.price);
  });

  it('x402Fetch with insufficient budget throws before payment', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.0005' });
    await expect(
      x402Fetch(`${baseUrl}/weather?city=Paris`, {}, { payer, maxRetries: 1, budget }),
    ).rejects.toThrow(BudgetExceededError);
    expect(budget.spent).toBe('0');
  });

  it('budget accumulates across multiple e2e calls', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.003' });
    for (let i = 0; i < 3; i++) {
      const res = await x402Fetch(
        `${baseUrl}/weather?city=City${i}`,
        {},
        { payer, maxRetries: 1, budget },
      );
      expect(res.status).toBe(200);
    }
    expect(budget.spent).toBe('0.003');
    await expect(
      x402Fetch(`${baseUrl}/weather?city=Overflow`, {}, { payer, maxRetries: 1, budget }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it('createTool with budget enforces limit e2e', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.002' });
    const tool = createTool({
      name: 'weather',
      description: 'Get weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      endpoint: `${baseUrl}/weather`,
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    await tool.invoke({ city: 'Tokyo' });
    await tool.invoke({ city: 'Seoul' });
    await expect(tool.invoke({ city: 'Overflow' })).rejects.toThrow(BudgetExceededError);
  });

  it('budget.reset allows spending again after exhaustion', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.001' });
    const res1 = await x402Fetch(
      `${baseUrl}/weather?city=Rome`,
      {},
      { payer, maxRetries: 1, budget },
    );
    expect(res1.status).toBe(200);

    await expect(
      x402Fetch(`${baseUrl}/weather?city=Fail`, {}, { payer, maxRetries: 1, budget }),
    ).rejects.toThrow(BudgetExceededError);

    budget.reset();
    const res2 = await x402Fetch(
      `${baseUrl}/weather?city=Milan`,
      {},
      { payer, maxRetries: 1, budget },
    );
    expect(res2.status).toBe(200);
  });

  it('shared budget across x402Fetch and createTool', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.003' });
    const tool = createTool({
      name: 'weather',
      description: 'Get weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      endpoint: `${baseUrl}/weather`,
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    await x402Fetch(`${baseUrl}/weather?city=A`, {}, { payer, maxRetries: 1, budget });
    await tool.invoke({ city: 'B' });
    await x402Fetch(`${baseUrl}/weather?city=C`, {}, { payer, maxRetries: 1, budget });

    expect(budget.spent).toBe('0.003');
    await expect(
      x402Fetch(`${baseUrl}/weather?city=D`, {}, { payer, maxRetries: 1, budget }),
    ).rejects.toThrow(BudgetExceededError);
  });
});

/**
 * Integration tests — end-to-end: Fastify server + x402Fetch + MockPayer/Verifier
 *
 * Spins up a real HTTP server (random port) so we exercise the full stack.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { x402Fetch, createTool } from 'x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xE2E',
};

async function buildE2EServer() {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  // Free route
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Priced GET route
  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 20, condition: 'Sunny' };
      },
    }),
  );

  // Priced POST route
  fastify.route(
    pricedRoute({
      method: 'POST',
      url: '/action',
      pricing: PRICING,
      handler: async (req) => {
        const body = req.body as { action: string };
        return { executed: body.action, at: new Date().toISOString() };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('End-to-end integration', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;
  let payer: MockPayer;

  beforeAll(async () => {
    ({ fastify, baseUrl } = await buildE2EServer());
    payer = new MockPayer({ secret: SECRET });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('GET /health returns 200 without payment', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('GET /weather without proof returns 402 with challenge', async () => {
    const res = await fetch(`${baseUrl}/weather?city=London`);
    expect(res.status).toBe(402);
    const body = await res.json() as { x402: { requestHash: string; nonce: string } };
    expect(body).toHaveProperty('x402');
    expect(body.x402.requestHash).toHaveLength(64);
  });

  it('x402Fetch: GET /weather resolves after auto-payment', async () => {
    const res = await x402Fetch(
      `${baseUrl}/weather?city=Paris`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { city: string; temp: number };
    expect(body.city).toBe('Paris');
    expect(body.temp).toBe(20);
  });

  it('x402Fetch: POST /action resolves after auto-payment', async () => {
    const res = await x402Fetch(
      `${baseUrl}/action`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'deploy' }),
      },
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { executed: string };
    expect(body.executed).toBe('deploy');
  });

  it('createTool: GET tool works end-to-end', async () => {
    const weatherTool = createTool({
      name: 'weather',
      description: 'Get weather',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      endpoint: `${baseUrl}/weather`,
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1 },
    });

    const result = await weatherTool.invoke({ city: 'Tokyo' });
    expect(result.ok).toBe(true);
    const data = result.data as { city: string };
    expect(data.city).toBe('Tokyo');
  });

  it('wrong secret: server rejects proof with 402', async () => {
    const wrongPayer = new MockPayer({ secret: 'wrong-secret' });
    const res = await x402Fetch(
      `${baseUrl}/weather?city=Berlin`,
      {},
      { payer: wrongPayer, maxRetries: 1 },
    );
    // Server should reject the tampered proof and return 402 again
    expect(res.status).toBe(402);
  });

  it('idempotency: same key + same request replays without extra charge', async () => {
    const idemKey = `e2e-idem-${Date.now()}`;
    const url = `${baseUrl}/weather?city=Rome`;

    const r1 = await x402Fetch(url, { headers: { 'idempotency-key': idemKey } }, { payer, maxRetries: 1 });
    expect(r1.status).toBe(200);
    const d1 = await r1.json() as { city: string };

    const r2 = await x402Fetch(url, { headers: { 'idempotency-key': idemKey } }, { payer, maxRetries: 1 });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('x-idempotent-replay')).toBe('true');
    const d2 = await r2.json() as { city: string };
    expect(d2).toEqual(d1);
  });

  it('idempotency: same key + different request returns 409', async () => {
    const idemKey = `e2e-conflict-${Date.now()}`;

    const r1 = await x402Fetch(
      `${baseUrl}/weather?city=Oslo`,
      { headers: { 'idempotency-key': idemKey } },
      { payer, maxRetries: 1 },
    );
    expect(r1.status).toBe(200);

    // Same key, different city (different requestHash)
    const r2 = await x402Fetch(
      `${baseUrl}/weather?city=Dublin`,
      { headers: { 'idempotency-key': idemKey } },
      { payer, maxRetries: 1 },
    );
    expect(r2.status).toBe(409);
  });

  it('nonce replay: reusing same proof returns 402', async () => {
    // Get a challenge first
    const challengeRes = await fetch(`${baseUrl}/weather?city=Vienna`);
    const { x402 } = await challengeRes.json() as { x402: import('x402-agent-client').X402Challenge };

    // Build a valid proof
    const proof = await payer.pay(x402, { url: `${baseUrl}/weather?city=Vienna`, method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url');

    // First use — should succeed
    const r1 = await fetch(`${baseUrl}/weather?city=Vienna`, {
      headers: { 'x-payment-proof': proofHeader },
    });
    expect(r1.status).toBe(200);

    // Second use of SAME proof (nonce replay) — should be rejected
    const r2 = await fetch(`${baseUrl}/weather?city=Vienna`, {
      headers: { 'x-payment-proof': proofHeader },
    });
    expect(r2.status).toBe(402);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute, rateLimitMiddleware } from 'x402-tool-server';
import { x402Fetch } from '@darklrd/x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'rate-limit-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xRATELIMIT',
};

async function buildE2EServerWithRateLimit(maxRequests = 5) {
  const fastify = Fastify({ logger: false });

  fastify.register(rateLimitMiddleware, { maxRequests, windowMs: 10_000 });
  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 20 };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('Rate limit integration', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;
  let payer: MockPayer;

  beforeAll(async () => {
    ({ fastify, baseUrl } = await buildE2EServerWithRateLimit(3));
    payer = new MockPayer({ secret: SECRET });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('rate limit fires before x402 payment check', async () => {
    const server = Fastify({ logger: false });
    server.register(rateLimitMiddleware, { maxRequests: 1, windowMs: 10_000 });
    server.register(createX402Middleware({ verifier: new MockVerifier({ secret: SECRET }) }));
    server.route(
      pricedRoute({
        method: 'GET',
        url: '/paid',
        pricing: PRICING,
        handler: async () => ({ ok: true }),
      }),
    );
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    // First request uses the one allowed slot (gets 402 since no payment)
    const r1 = await fetch(`${url}/paid`);
    expect(r1.status).toBe(402);

    // Second request should be rate limited (429), not 402
    const r2 = await fetch(`${url}/paid`);
    expect(r2.status).toBe(429);

    await server.close();
  });

  it('free routes are also rate limited', async () => {
    const server = Fastify({ logger: false });
    server.register(rateLimitMiddleware, { maxRequests: 2, windowMs: 10_000 });
    server.get('/health', async () => ({ status: 'ok' }));
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    await fetch(`${url}/health`);
    await fetch(`${url}/health`);
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(429);

    await server.close();
  });

  it('priced route returns 402 challenge when under rate limit', async () => {
    const res = await fetch(`${baseUrl}/weather?city=London`);
    expect(res.status).toBe(402);
    const body = await res.json() as { x402: { requestHash: string } };
    expect(body).toHaveProperty('x402');
  });

  it('priced route returns 200 with valid payment when under rate limit', async () => {
    const res = await x402Fetch(
      `${baseUrl}/weather?city=Tokyo`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { city: string; temp: number };
    expect(body.city).toBe('Tokyo');
  });

  it('rate limit resets and payment works after window expires', async () => {
    const server = Fastify({ logger: false });
    server.register(rateLimitMiddleware, { maxRequests: 2, windowMs: 500 });
    server.register(createX402Middleware({ verifier: new MockVerifier({ secret: SECRET }) }));
    server.route(
      pricedRoute({
        method: 'GET',
        url: '/weather',
        pricing: PRICING,
        handler: async (req) => {
          const { city } = req.query as { city: string };
          return { city, temp: 25 };
        },
      }),
    );
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    // Use up both allowed requests
    await fetch(`${url}/weather?city=Berlin`);
    await fetch(`${url}/weather?city=Berlin`);

    // Rate limited
    const blocked = await fetch(`${url}/weather?city=Berlin`);
    expect(blocked.status).toBe(429);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Should work again — x402Fetch uses 2 requests (402 challenge + paid retry)
    const res = await x402Fetch(
      `${url}/weather?city=Berlin`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);

    await server.close();
  });

  it('different clients have independent rate limits', async () => {
    const server = Fastify({ logger: false });
    server.register(rateLimitMiddleware, {
      maxRequests: 1,
      windowMs: 10_000,
      keyExtractor: (req) => req.headers['x-client-id'] as string ?? 'default',
    });
    server.get('/ping', async () => ({ pong: true }));
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const r1 = await fetch(`${url}/ping`, { headers: { 'x-client-id': 'client-a' } });
    expect(r1.status).toBe(200);

    const r1b = await fetch(`${url}/ping`, { headers: { 'x-client-id': 'client-a' } });
    expect(r1b.status).toBe(429);

    const r2 = await fetch(`${url}/ping`, { headers: { 'x-client-id': 'client-b' } });
    expect(r2.status).toBe(200);

    await server.close();
  });
});

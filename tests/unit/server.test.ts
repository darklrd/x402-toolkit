/**
 * Unit tests — server middleware (402 response shape, requestHash in challenge)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute, pricedHandler } from 'x402-tool-server';
import { MockVerifier } from 'x402-adapters';

const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xTEST',
  description: 'Test endpoint',
};

async function buildTestServer(verifierSecret = 'test-secret') {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: verifierSecret }),
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/priced',
      pricing: PRICING,
      handler: async () => ({ paid: true }),
    }),
  );

  fastify.get('/free', async () => ({ free: true }));

  await fastify.ready();
  return fastify;
}

describe('Server middleware — 402 challenge shape', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 for free routes without any proof', async () => {
    const res = await app.inject({ method: 'GET', url: '/free' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ free: true });
  });

  it('returns 402 for priced route without payment proof', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
  });

  it('402 body contains x402 wrapper object', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const body = res.json();
    expect(body).toHaveProperty('x402');
    expect(typeof body.x402).toBe('object');
  });

  it('402 challenge includes all required fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = res.json();

    expect(x402).toMatchObject({
      version: 1,
      scheme: expect.any(String),
      price: PRICING.price,
      asset: PRICING.asset,
      network: PRICING.network,
      recipient: PRICING.recipient,
      nonce: expect.any(String),
      expiresAt: expect.any(String),
      requestHash: expect.any(String),
    });
  });

  it('challenge.requestHash is a 64-char hex string', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = res.json();
    expect(x402.requestHash).toHaveLength(64);
    expect(x402.requestHash).toMatch(/^[0-9a-f]+$/);
  });

  it('challenge.expiresAt is a future ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = res.json();
    const expiry = new Date(x402.expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('challenge.nonce is a UUID', async () => {
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = res.json();
    expect(x402.nonce).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('two requests produce different nonces', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/priced' });
    const r2 = await app.inject({ method: 'GET', url: '/priced' });
    expect(r1.json().x402.nonce).not.toBe(r2.json().x402.nonce);
  });

  it('same request produces same requestHash across calls', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/priced?city=London' });
    const r2 = await app.inject({ method: 'GET', url: '/priced?city=London' });
    expect(r1.json().x402.requestHash).toBe(r2.json().x402.requestHash);
  });

  it('different query params produce different requestHash', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/priced?city=London' });
    const r2 = await app.inject({ method: 'GET', url: '/priced?city=Paris' });
    expect(r1.json().x402.requestHash).not.toBe(r2.json().x402.requestHash);
  });

  it('pricedHandler shorthand also returns 402', async () => {
    // Build a fresh server so we can add the route before ready().
    const freshApp = Fastify({ logger: false });
    freshApp.register(createX402Middleware({ verifier: new MockVerifier({ secret: 'test' }) }));
    freshApp.get('/priced2', pricedHandler(PRICING), async () => ({ ok: true }));
    await freshApp.ready();
    const res = await freshApp.inject({ method: 'GET', url: '/priced2' });
    await freshApp.close();
    expect(res.statusCode).toBe(402);
  });
});

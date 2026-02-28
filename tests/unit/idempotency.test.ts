/**
 * Unit tests — idempotency behaviour
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute, MemoryIdempotencyStore } from 'x402-tool-server';
import { MockVerifier, MockPayer } from 'x402-adapters';

const SECRET = 'idem-test-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xIDEM',
};

let callCount = 0;

async function buildServer() {
  callCount = 0;
  const store = new MemoryIdempotencyStore();
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
      idempotencyStore: store,
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/counted',
      pricing: PRICING,
      handler: async () => {
        callCount++;
        return { callCount, ts: Date.now() };
      },
    }),
  );

  await fastify.ready();
  return { fastify, store };
}

/** Get a valid proof for a given request via MockPayer */
async function getProof(fastify: FastifyInstance, url: string): Promise<string> {
  const payer = new MockPayer({ secret: SECRET });
  // First request to get the challenge
  const r402 = await fastify.inject({ method: 'GET', url });
  const { x402 } = r402.json();
  const proof = await payer.pay(x402, { url, method: 'GET' });
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

describe('Idempotency store — MemoryIdempotencyStore', () => {
  it('starts empty', () => {
    const store = new MemoryIdempotencyStore();
    expect(store.get('missing')).toBeUndefined();
    store.destroy();
  });

  it('stores and retrieves a response', () => {
    const store = new MemoryIdempotencyStore();
    const value = { requestHash: 'abc', statusCode: 200, body: { ok: true }, headers: {} };
    store.set('k1', value);
    expect(store.get('k1')).toEqual(value);
    store.destroy();
  });

  it('returns undefined for unknown key', () => {
    const store = new MemoryIdempotencyStore();
    expect(store.get('unknown')).toBeUndefined();
    store.destroy();
  });
});

describe('Middleware idempotency behaviour', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    ({ fastify } = await buildServer());
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('same Idempotency-Key + same request: returns stored response, does not re-execute handler', async () => {
    const url = '/counted?v=1';
    const proofHeader = await getProof(fastify, url);
    const idemKey = `test-idem-${Date.now()}`;

    // First paid call
    const r1 = await fastify.inject({
      method: 'GET',
      url,
      headers: { 'x-payment-proof': proofHeader, 'idempotency-key': idemKey },
    });
    expect(r1.statusCode).toBe(200);
    expect(callCount).toBe(1);
    const body1 = r1.json();

    // Second call with same key — needs a new proof (nonce replay protection),
    // BUT the idempotency check runs BEFORE proof verification, so it replays.
    // We simulate by using a fresh call with same idempotency key and proof.
    const r2 = await fastify.inject({
      method: 'GET',
      url,
      headers: { 'x-payment-proof': proofHeader, 'idempotency-key': idemKey },
    });
    // Handler should NOT be called again
    expect(callCount).toBe(1);
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual(body1);
    expect(r2.headers['x-idempotent-replay']).toBe('true');
  });

  it('same Idempotency-Key + different request: returns 409', async () => {
    const payer = new MockPayer({ secret: SECRET });
    const idemKey = `conflict-${Date.now()}`;

    // First request: /counted?v=A
    const r402A = await fastify.inject({ method: 'GET', url: '/counted?v=A' });
    const proofA = await payer.pay(r402A.json().x402, { url: '/counted?v=A', method: 'GET' });
    const proofHeaderA = Buffer.from(JSON.stringify(proofA)).toString('base64url');

    const r1 = await fastify.inject({
      method: 'GET',
      url: '/counted?v=A',
      headers: { 'x-payment-proof': proofHeaderA, 'idempotency-key': idemKey },
    });
    expect(r1.statusCode).toBe(200);

    // Second request: same key but DIFFERENT path (/counted?v=B)
    const r402B = await fastify.inject({ method: 'GET', url: '/counted?v=B' });
    const proofB = await payer.pay(r402B.json().x402, { url: '/counted?v=B', method: 'GET' });
    const proofHeaderB = Buffer.from(JSON.stringify(proofB)).toString('base64url');

    const r2 = await fastify.inject({
      method: 'GET',
      url: '/counted?v=B',
      headers: { 'x-payment-proof': proofHeaderB, 'idempotency-key': idemKey },
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json()).toHaveProperty('error');
  });
});

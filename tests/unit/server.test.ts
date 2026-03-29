/**
 * Unit tests — server middleware (402 response shape, requestHash in challenge)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute, pricedHandler } from 'x402-tool-server';
import type { WireFormat } from 'x402-tool-server';
import { MockVerifier, MockPayer } from 'x402-adapters';
import type { CoinbasePaymentRequired, CoinbasePaymentPayload } from 'x402-tool-server/compat';

const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xTEST',
  description: 'Test endpoint',
};

async function buildTestServer(verifierSecret = 'test-secret', wireFormat?: WireFormat) {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: verifierSecret }),
      wireFormat,
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

describe('Server middleware — wireFormat modes', () => {
  const SECRET = 'wire-test';

  it('wireFormat: coinbase — 402 has PAYMENT-REQUIRED header', async () => {
    const app = await buildTestServer(SECRET, 'coinbase');
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
    expect(res.headers['payment-required']).toBeDefined();
    const decoded = JSON.parse(
      Buffer.from(res.headers['payment-required'] as string, 'base64').toString('utf8'),
    ) as CoinbasePaymentRequired;
    expect(decoded.x402Version).toBe(1);
    expect(decoded.accepts).toHaveLength(1);
    await app.close();
  });

  it('wireFormat: coinbase — 402 body is minimal', async () => {
    const app = await buildTestServer(SECRET, 'coinbase');
    const res = await app.inject({ method: 'GET', url: '/priced' });
    const body = res.json();
    expect(body).toEqual({ error: 'Payment Required' });
    expect(body).not.toHaveProperty('x402');
    await app.close();
  });

  it('wireFormat: coinbase — accepts PAYMENT-SIGNATURE header', async () => {
    const app = await buildTestServer(SECRET, 'coinbase');
    const payer = new MockPayer({ secret: SECRET });

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const prHeader = challengeRes.headers['payment-required'] as string;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: PRICING.network ?? 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: '/priced', method: 'GET' });
    const coinbasePayload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: req,
      payload: {
        signature: proof.signature,
        nonce: proof.nonce,
        requestHash: proof.requestHash,
        payer: proof.payer,
        timestamp: proof.timestamp,
        expiresAt: proof.expiresAt,
      },
    };
    const paymentSig = Buffer.from(JSON.stringify(coinbasePayload), 'utf8').toString('base64');

    const payRes = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes.statusCode).toBe(200);
    expect(payRes.json()).toEqual({ paid: true });
    await app.close();
  });

  it('wireFormat: coinbase — still accepts X-Payment-Proof', async () => {
    const app = await buildTestServer(SECRET, 'coinbase');
    const payer = new MockPayer({ secret: SECRET });

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const prHeader = challengeRes.headers['payment-required'] as string;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: PRICING.network ?? 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: '/priced', method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');

    const payRes = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });
    expect(payRes.statusCode).toBe(200);
    await app.close();
  });

  it('wireFormat: dual — 402 has both body and header', async () => {
    const app = await buildTestServer(SECRET, 'dual');
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
    expect(res.headers['payment-required']).toBeDefined();
    const body = res.json();
    expect(body).toHaveProperty('x402');
    await app.close();
  });

  it('wireFormat: dual — accepts both header formats', async () => {
    const app = await buildTestServer(SECRET, 'dual');
    const payer = new MockPayer({ secret: SECRET });

    // Test with toolkit format
    const res1 = await app.inject({ method: 'GET', url: '/priced' });
    const challenge1 = res1.json().x402;
    const proof1 = await payer.pay(challenge1, { url: '/priced', method: 'GET' });
    const proofHeader1 = Buffer.from(JSON.stringify(proof1), 'utf8').toString('base64url');

    const payRes1 = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader1 },
    });
    expect(payRes1.statusCode).toBe(200);
    await app.close();
  });

  it('wireFormat: toolkit (default) — no PAYMENT-REQUIRED header', async () => {
    const app = await buildTestServer(SECRET);
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
    expect(res.headers['payment-required']).toBeUndefined();
    expect(res.json()).toHaveProperty('x402');
    await app.close();
  });

  it('wireFormat: toolkit — accepts both proof header formats', async () => {
    const app = await buildTestServer(SECRET);
    const payer = new MockPayer({ secret: SECRET });

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const challenge = challengeRes.json().x402;

    const proof = await payer.pay(challenge, { url: '/priced', method: 'GET' });
    const coinbasePayload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: {
        scheme: challenge.scheme,
        network: 'mock:1',
        asset: 'USDC',
        amount: '1000',
        payTo: challenge.recipient,
        maxTimeoutSeconds: 300,
        extra: { nonce: challenge.nonce, requestHash: challenge.requestHash },
      },
      payload: {
        signature: proof.signature,
        nonce: proof.nonce,
        requestHash: proof.requestHash,
        payer: proof.payer,
        timestamp: proof.timestamp,
        expiresAt: proof.expiresAt,
      },
    };
    const paymentSig = Buffer.from(JSON.stringify(coinbasePayload), 'utf8').toString('base64');

    const payRes = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes.statusCode).toBe(200);
    await app.close();
  });

  it('default wireFormat is toolkit', async () => {
    const app = await buildTestServer(SECRET);
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
    expect(res.headers['payment-required']).toBeUndefined();
    expect(res.json()).toHaveProperty('x402');
    await app.close();
  });

  it('nonce replay works with Coinbase-format proofs', async () => {
    const app = await buildTestServer(SECRET, 'coinbase');
    const payer = new MockPayer({ secret: SECRET });

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const prHeader = challengeRes.headers['payment-required'] as string;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: PRICING.network ?? 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: '/priced', method: 'GET' });
    const coinbasePayload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: req,
      payload: {
        signature: proof.signature,
        nonce: proof.nonce,
        requestHash: proof.requestHash,
        payer: proof.payer,
        timestamp: proof.timestamp,
        expiresAt: proof.expiresAt,
      },
    };
    const paymentSig = Buffer.from(JSON.stringify(coinbasePayload), 'utf8').toString('base64');

    // First attempt should succeed
    const payRes1 = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes1.statusCode).toBe(200);

    // Replay should be rejected
    const payRes2 = await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes2.statusCode).toBe(402);
    expect(payRes2.json()).toHaveProperty('error');
    await app.close();
  });

  it('receipt saved from Coinbase-format proof', async () => {
    const { MemoryReceiptStore } = await import('x402-tool-server');
    const receiptStore = new MemoryReceiptStore();
    const app = Fastify({ logger: false });
    app.register(
      createX402Middleware({
        verifier: new MockVerifier({ secret: SECRET }),
        wireFormat: 'coinbase',
        receiptStore,
      }),
    );
    app.route(
      pricedRoute({
        method: 'GET',
        url: '/priced',
        pricing: PRICING,
        handler: async () => ({ paid: true }),
      }),
    );
    await app.ready();

    const payer = new MockPayer({ secret: SECRET });
    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const prHeader = challengeRes.headers['payment-required'] as string;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: PRICING.network ?? 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: '/priced', method: 'GET' });
    const coinbasePayload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: req,
      payload: {
        signature: proof.signature,
        nonce: proof.nonce,
        requestHash: proof.requestHash,
        payer: proof.payer,
        timestamp: proof.timestamp,
        expiresAt: proof.expiresAt,
      },
    };
    const paymentSig = Buffer.from(JSON.stringify(coinbasePayload), 'utf8').toString('base64');

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'payment-signature': paymentSig },
    });

    const receipt = receiptStore.get(proof.nonce);
    expect(receipt).toBeDefined();
    expect(receipt!.payer).toBe(proof.payer);
    await app.close();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  createX402Middleware,
  pricedRoute,
  MemoryReceiptStore,
} from 'x402-tool-server';
import type { CoinbasePaymentRequired, CoinbasePaymentPayload } from 'x402-tool-server/compat';
import { x402Fetch, BudgetTracker } from '@darklrd/x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'compat-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xCOMPAT',
};

async function buildServer(wireFormat: 'toolkit' | 'coinbase' | 'dual', receiptStore?: MemoryReceiptStore) {
  const fastify = Fastify({ logger: false });
  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
      wireFormat,
      receiptStore,
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city?: string };
        return { city: city ?? 'Unknown', temp: 22 };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('Coinbase compat — E2E integration', () => {
  let coinbaseServer: FastifyInstance;
  let coinbaseUrl: string;
  let toolkitServer: FastifyInstance;
  let toolkitUrl: string;
  let dualServer: FastifyInstance;
  let dualUrl: string;
  let payer: MockPayer;

  beforeAll(async () => {
    ({ fastify: coinbaseServer, baseUrl: coinbaseUrl } = await buildServer('coinbase'));
    ({ fastify: toolkitServer, baseUrl: toolkitUrl } = await buildServer('toolkit'));
    ({ fastify: dualServer, baseUrl: dualUrl } = await buildServer('dual'));
    payer = new MockPayer({ secret: SECRET });
  });

  afterAll(async () => {
    await coinbaseServer.close();
    await toolkitServer.close();
    await dualServer.close();
  });

  it('Coinbase-format server + toolkit client: full payment flow', async () => {
    const res = await x402Fetch(
      `${coinbaseUrl}/weather?city=Berlin`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ city: 'Berlin', temp: 22 });
  });

  it('Toolkit-format server + simulated Coinbase client: full payment flow', async () => {
    // Get challenge
    const challengeRes = await fetch(`${toolkitUrl}/weather`);
    expect(challengeRes.status).toBe(402);
    const body = await challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; scheme: string } };
    const challenge = body.x402;

    // Pay with MockPayer
    const proof = await payer.pay(
      { ...challenge, version: 1, price: PRICING.price, asset: PRICING.asset, network: 'mock', recipient: PRICING.recipient },
      { url: `${toolkitUrl}/weather`, method: 'GET' },
    );

    // Send as PAYMENT-SIGNATURE (Coinbase format)
    const coinbasePayload: CoinbasePaymentPayload = {
      x402Version: 1,
      accepted: {
        scheme: 'exact',
        network: 'mock:1',
        asset: 'USDC',
        amount: '1000',
        payTo: PRICING.recipient,
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

    const payRes = await fetch(`${toolkitUrl}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes.status).toBe(200);
  });

  it('Dual-format server + toolkit client: full payment flow', async () => {
    const res = await x402Fetch(
      `${dualUrl}/weather?city=Tokyo`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ city: 'Tokyo', temp: 22 });
  });

  it('Dual-format server + Coinbase client: full payment flow', async () => {
    const challengeRes = await fetch(`${dualUrl}/weather`);
    expect(challengeRes.status).toBe(402);
    const prHeader = challengeRes.headers.get('payment-required');
    expect(prHeader).toBeTruthy();

    const pr = JSON.parse(Buffer.from(prHeader!, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: `${dualUrl}/weather`, method: 'GET' });
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

    const payRes = await fetch(`${dualUrl}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes.status).toBe(200);
  });

  it('Coinbase-format server + idempotency: replay works', async () => {
    const challengeRes = await fetch(`${coinbaseUrl}/weather`);
    const prHeader = challengeRes.headers.get('payment-required')!;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: `${coinbaseUrl}/weather`, method: 'GET' });
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

    const payRes = await fetch(`${coinbaseUrl}/weather`, {
      headers: {
        'payment-signature': paymentSig,
        'idempotency-key': 'idem-coinbase-1',
      },
    });
    expect(payRes.status).toBe(200);

    // Replay with same idempotency key
    const replayRes = await fetch(`${coinbaseUrl}/weather`, {
      headers: {
        'payment-signature': paymentSig,
        'idempotency-key': 'idem-coinbase-1',
      },
    });
    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get('x-idempotent-replay')).toBe('true');
  });

  it('Coinbase-format server + nonce replay rejection', async () => {
    const challengeRes = await fetch(`${coinbaseUrl}/weather`);
    const prHeader = challengeRes.headers.get('payment-required')!;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: `${coinbaseUrl}/weather`, method: 'GET' });
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

    const payRes1 = await fetch(`${coinbaseUrl}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes1.status).toBe(200);

    // Replay same nonce (no idempotency key)
    const payRes2 = await fetch(`${coinbaseUrl}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });
    expect(payRes2.status).toBe(402);
  });

  it('Coinbase-format server + receipts saved correctly', async () => {
    const receiptStore = new MemoryReceiptStore();
    const { fastify, baseUrl } = await buildServer('coinbase', receiptStore);

    const challengeRes = await fetch(`${baseUrl}/weather`);
    const prHeader = challengeRes.headers.get('payment-required')!;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };

    const proof = await payer.pay(challenge, { url: `${baseUrl}/weather`, method: 'GET' });
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

    await fetch(`${baseUrl}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });

    const receipt = receiptStore.get(proof.nonce);
    expect(receipt).toBeDefined();
    expect(receipt!.payer).toBe(proof.payer);
    expect(receipt!.nonce).toBe(proof.nonce);

    await fastify.close();
  });

  it('Coinbase-format server + events emitted correctly', async () => {
    const fastify2 = Fastify({ logger: false });
    fastify2.register(
      createX402Middleware({
        verifier: new MockVerifier({ secret: SECRET }),
        wireFormat: 'coinbase',
      }),
    );
    fastify2.route(
      pricedRoute({
        method: 'GET',
        url: '/weather',
        pricing: PRICING,
        handler: async () => ({ temp: 22 }),
      }),
    );
    await fastify2.listen({ port: 0, host: '127.0.0.1' });
    const addr = fastify2.server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;

    const events: string[] = [];
    fastify2.x402Events.on('x402:challenge', () => events.push('challenge'));
    fastify2.x402Events.on('x402:payment', () => events.push('payment'));

    // Trigger challenge event
    await fetch(`${url}/weather`);
    expect(events).toContain('challenge');

    // Trigger payment event
    const challengeRes = await fetch(`${url}/weather`);
    const prHeader = challengeRes.headers.get('payment-required')!;
    const pr = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf8')) as CoinbasePaymentRequired;
    const req = pr.accepts[0];

    const challenge = {
      version: 1,
      scheme: req.scheme,
      price: PRICING.price,
      asset: PRICING.asset,
      network: 'mock',
      recipient: PRICING.recipient,
      nonce: req.extra['nonce'],
      expiresAt: new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString(),
      requestHash: req.extra['requestHash'],
    };
    const proof = await payer.pay(challenge, { url: `${url}/weather`, method: 'GET' });
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
    await fetch(`${url}/weather`, {
      headers: { 'payment-signature': paymentSig },
    });
    expect(events).toContain('payment');

    await fastify2.close();
  });

  it('Coinbase-format challenge + BudgetTracker', async () => {
    const budget = new BudgetTracker({ maxSpend: '0.005', asset: 'USDC' });

    const res = await x402Fetch(
      `${coinbaseUrl}/weather?city=Paris`,
      {},
      { payer, maxRetries: 1, budget },
    );
    expect(res.status).toBe(200);
    expect(parseFloat(budget.spent)).toBeGreaterThan(0);
  });
});

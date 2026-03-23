import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  createX402Middleware,
  pricedRoute,
  MemoryReceiptStore,
} from 'x402-tool-server';
import type { X402ChallengeEvent, X402PaymentEvent, X402ErrorEvent } from 'x402-tool-server';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'events-test-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xEVENTS',
  description: 'Events test endpoint',
};

async function buildTestServer(verifierSecret = SECRET) {
  const receiptStore = new MemoryReceiptStore();
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: verifierSecret }),
      receiptStore,
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

  fastify.route(
    pricedRoute({
      method: 'POST',
      url: '/priced-post',
      pricing: PRICING,
      handler: async () => ({ posted: true }),
    }),
  );

  fastify.get('/free', async () => ({ free: true }));

  await fastify.ready();
  return fastify;
}

function makeProofHeader(payer: MockPayer, challenge: { nonce: string; requestHash: string; expiresAt: string; version: number }) {
  return payer
    .pay(challenge, { url: 'http://localhost/priced', method: 'GET' })
    .then((proof) => Buffer.from(JSON.stringify(proof)).toString('base64url'));
}

describe('Payment Event Emitter', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it('x402Events decorator is available on fastify instance', () => {
    expect(app.x402Events).toBeDefined();
    expect(typeof app.x402Events.on).toBe('function');
    expect(typeof app.x402Events.emit).toBe('function');
  });

  it('x402:challenge fires when priced route called without proof', async () => {
    const events: X402ChallengeEvent[] = [];
    app.x402Events.on('x402:challenge', (e) => events.push(e));

    await app.inject({ method: 'GET', url: '/priced' });

    expect(events).toHaveLength(1);
  });

  it('x402:challenge event contains correct challenge fields', async () => {
    const events: X402ChallengeEvent[] = [];
    app.x402Events.on('x402:challenge', (e) => events.push(e));

    await app.inject({ method: 'GET', url: '/priced' });

    const event = events[0];
    expect(event.challenge.price).toBe(PRICING.price);
    expect(event.challenge.asset).toBe(PRICING.asset);
    expect(event.challenge.recipient).toBe(PRICING.recipient);
    expect(event.challenge.nonce).toMatch(/^[0-9a-f]{8}-/);
    expect(event.challenge.requestHash).toHaveLength(64);
  });

  it('x402:challenge event contains request info', async () => {
    const events: X402ChallengeEvent[] = [];
    app.x402Events.on('x402:challenge', (e) => events.push(e));

    await app.inject({ method: 'GET', url: '/priced' });

    const event = events[0];
    expect(event.request.method).toBe('GET');
    expect(event.request.url).toBe('/priced');
    expect(typeof event.request.ip).toBe('string');
  });

  it('x402:payment fires on successful payment', async () => {
    const events: X402PaymentEvent[] = [];
    app.x402Events.on('x402:payment', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const payer = new MockPayer({ secret: SECRET });
    const proofHeader = await makeProofHeader(payer, x402);

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    expect(events).toHaveLength(1);
  });

  it('x402:payment event contains receipt with correct amount and payer', async () => {
    const events: X402PaymentEvent[] = [];
    app.x402Events.on('x402:payment', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const payer = new MockPayer({ secret: SECRET });
    const proofHeader = await makeProofHeader(payer, x402);

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    const event = events[0];
    expect(event.receipt.amount).toBe(PRICING.price);
    expect(event.receipt.payer).toContain('mock://');
    expect(event.receipt.asset).toBe(PRICING.asset);
    expect(event.receipt.recipient).toBe(PRICING.recipient);
  });

  it('x402:error fires with reason invalid_proof on bad proof', async () => {
    const events: X402ErrorEvent[] = [];
    app.x402Events.on('x402:error', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const wrongPayer = new MockPayer({ secret: 'wrong-secret' });
    const proofHeader = await makeProofHeader(wrongPayer, x402);

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('invalid_proof');
  });

  it('x402:error fires with reason nonce_replay on replayed nonce', async () => {
    const events: X402ErrorEvent[] = [];
    app.x402Events.on('x402:error', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const payer = new MockPayer({ secret: SECRET });
    const proofHeader = await makeProofHeader(payer, x402);

    // First use — success
    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    // Second use — replay
    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('nonce_replay');
  });

  it('x402:error event contains pricing config', async () => {
    const events: X402ErrorEvent[] = [];
    app.x402Events.on('x402:error', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const wrongPayer = new MockPayer({ secret: 'wrong-secret' });
    const proofHeader = await makeProofHeader(wrongPayer, x402);

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    expect(events[0].pricing.price).toBe(PRICING.price);
    expect(events[0].pricing.asset).toBe(PRICING.asset);
    expect(events[0].pricing.recipient).toBe(PRICING.recipient);
  });

  it('no events fire for free (non-priced) routes', async () => {
    const challengeEvents: X402ChallengeEvent[] = [];
    const paymentEvents: X402PaymentEvent[] = [];
    const errorEvents: X402ErrorEvent[] = [];
    app.x402Events.on('x402:challenge', (e) => challengeEvents.push(e));
    app.x402Events.on('x402:payment', (e) => paymentEvents.push(e));
    app.x402Events.on('x402:error', (e) => errorEvents.push(e));

    await app.inject({ method: 'GET', url: '/free' });

    expect(challengeEvents).toHaveLength(0);
    expect(paymentEvents).toHaveLength(0);
    expect(errorEvents).toHaveLength(0);
  });

  it('no events fire when no listeners are registered', async () => {
    // Just ensure no errors are thrown when no listeners
    const res = await app.inject({ method: 'GET', url: '/priced' });
    expect(res.statusCode).toBe(402);
  });

  it('multiple listeners on same event all receive the event', async () => {
    const eventsA: X402ChallengeEvent[] = [];
    const eventsB: X402ChallengeEvent[] = [];
    app.x402Events.on('x402:challenge', (e) => eventsA.push(e));
    app.x402Events.on('x402:challenge', (e) => eventsB.push(e));

    await app.inject({ method: 'GET', url: '/priced' });

    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
  });

  it('listener errors do not block the response', async () => {
    const app2 = await buildTestServer();
    app2.x402Events.on('x402:payment', () => {
      throw new Error('payment listener boom');
    });

    const challengeRes = await app2.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const payer = new MockPayer({ secret: SECRET });
    const proofHeader = await makeProofHeader(payer, x402);

    const res = await app2.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    expect(res.statusCode).toBe(200);
    await app2.close();
  });

  it('x402:payment event timestamp is a valid ISO string', async () => {
    const events: X402PaymentEvent[] = [];
    app.x402Events.on('x402:payment', (e) => events.push(e));

    const challengeRes = await app.inject({ method: 'GET', url: '/priced' });
    const { x402 } = challengeRes.json() as { x402: { nonce: string; requestHash: string; expiresAt: string; version: number } };

    const payer = new MockPayer({ secret: SECRET });
    const proofHeader = await makeProofHeader(payer, x402);

    await app.inject({
      method: 'GET',
      url: '/priced',
      headers: { 'x-payment-proof': proofHeader },
    });

    const ts = new Date(events[0].timestamp);
    expect(ts.toISOString()).toBe(events[0].timestamp);
  });
});

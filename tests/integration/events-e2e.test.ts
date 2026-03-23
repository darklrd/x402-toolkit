import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import type { X402ChallengeEvent, X402PaymentEvent, X402ErrorEvent } from 'x402-tool-server';
import { x402Fetch } from '@darklrd/x402-agent-client';
import { MockPayer, MockVerifier } from 'x402-adapters';

const SECRET = 'events-e2e-secret';
const PRICING = {
  price: '0.002',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xEVENTS_E2E',
};

async function buildE2EServer() {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  fastify.get('/free', async () => ({ status: 'ok' }));

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

  fastify.route(
    pricedRoute({
      method: 'POST',
      url: '/action',
      pricing: PRICING,
      handler: async (req) => {
        const body = req.body as { action: string };
        return { executed: body.action };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('Events end-to-end integration', () => {
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

  it('challenge event fires during real 402 flow', async () => {
    const events: X402ChallengeEvent[] = [];
    fastify.x402Events.on('x402:challenge', (e) => events.push(e));

    const res = await fetch(`${baseUrl}/weather?city=London`);
    expect(res.status).toBe(402);
    expect(events).toHaveLength(1);
    expect(events[0].challenge.price).toBe(PRICING.price);

    fastify.x402Events.removeAllListeners('x402:challenge');
  });

  it('payment event fires after successful x402Fetch', async () => {
    const events: X402PaymentEvent[] = [];
    fastify.x402Events.on('x402:payment', (e) => events.push(e));

    const res = await x402Fetch(
      `${baseUrl}/weather?city=Paris`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].receipt.amount).toBe(PRICING.price);
    expect(events[0].receipt.endpoint).toBe('/weather');

    fastify.x402Events.removeAllListeners('x402:payment');
  });

  it('error event fires for invalid proof over HTTP', async () => {
    const events: X402ErrorEvent[] = [];
    fastify.x402Events.on('x402:error', (e) => events.push(e));

    const wrongPayer = new MockPayer({ secret: 'wrong' });
    const res = await x402Fetch(
      `${baseUrl}/weather?city=Berlin`,
      {},
      { payer: wrongPayer, maxRetries: 1 },
    );
    expect(res.status).toBe(402);
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('invalid_proof');

    fastify.x402Events.removeAllListeners('x402:error');
  });

  it('full lifecycle: challenge → payment events in sequence', async () => {
    const challengeEvents: X402ChallengeEvent[] = [];
    const paymentEvents: X402PaymentEvent[] = [];
    fastify.x402Events.on('x402:challenge', (e) => challengeEvents.push(e));
    fastify.x402Events.on('x402:payment', (e) => paymentEvents.push(e));

    // x402Fetch first gets a 402 (challenge event), then pays (payment event)
    const res = await x402Fetch(
      `${baseUrl}/weather?city=Tokyo`,
      {},
      { payer, maxRetries: 1 },
    );
    expect(res.status).toBe(200);

    expect(challengeEvents.length).toBeGreaterThanOrEqual(1);
    expect(paymentEvents).toHaveLength(1);

    // Challenge fires before payment
    const challengeTs = new Date(challengeEvents[0].timestamp).getTime();
    const paymentTs = new Date(paymentEvents[0].timestamp).getTime();
    expect(paymentTs).toBeGreaterThanOrEqual(challengeTs);

    fastify.x402Events.removeAllListeners('x402:challenge');
    fastify.x402Events.removeAllListeners('x402:payment');
  });

  it('events carry correct IP for HTTP requests', async () => {
    const events: X402ChallengeEvent[] = [];
    fastify.x402Events.on('x402:challenge', (e) => events.push(e));

    await fetch(`${baseUrl}/weather?city=Oslo`);

    expect(events).toHaveLength(1);
    expect(events[0].request.ip).toBe('127.0.0.1');

    fastify.x402Events.removeAllListeners('x402:challenge');
  });

  it('POST route payment event includes correct endpoint and method', async () => {
    const events: X402PaymentEvent[] = [];
    fastify.x402Events.on('x402:payment', (e) => events.push(e));

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
    expect(events).toHaveLength(1);
    expect(events[0].receipt.endpoint).toBe('/action');
    expect(events[0].receipt.method).toBe('POST');
    expect(events[0].request.method).toBe('POST');

    fastify.x402Events.removeAllListeners('x402:payment');
  });
});

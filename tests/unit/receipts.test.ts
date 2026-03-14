/**
 * Unit tests — receipt store + receipt endpoint
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute, MemoryReceiptStore } from 'x402-tool-server';
import { MemoryReceiptStore as ReceiptStoreClass } from 'x402-tool-server';
import { MockVerifier, MockPayer } from 'x402-adapters';
import { x402Fetch } from '@darklrd/x402-agent-client';

const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xTEST',
  description: 'Test endpoint',
};

const SECRET = 'test-secret';

async function buildTestServer(receiptStore: InstanceType<typeof ReceiptStoreClass>) {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
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

  await fastify.ready();
  return fastify;
}

describe('MemoryReceiptStore', () => {
  it('saves and retrieves a receipt', () => {
    const store = new MemoryReceiptStore();
    const receipt = {
      nonce: 'test-nonce',
      payer: 'mock-payer',
      amount: '0.001',
      asset: 'USDC',
      network: 'mock',
      recipient: '0xTEST',
      endpoint: '/priced',
      method: 'GET',
      requestHash: 'abc123',
      paidAt: new Date().toISOString(),
    };

    store.save(receipt);
    expect(store.get('test-nonce')).toEqual(receipt);
    expect(store.size).toBe(1);
    store.destroy();
  });

  it('returns undefined for unknown nonce', () => {
    const store = new MemoryReceiptStore();
    expect(store.get('nonexistent')).toBeUndefined();
    store.destroy();
  });

  it('expires receipts after ttlMs', async () => {
    const store = new MemoryReceiptStore({ ttlMs: 50 });
    store.save({
      nonce: 'expire-me',
      payer: 'mock',
      amount: '0.001',
      asset: 'USDC',
      network: 'mock',
      recipient: '0xTEST',
      endpoint: '/priced',
      method: 'GET',
      requestHash: 'abc',
      paidAt: new Date().toISOString(),
    });

    expect(store.get('expire-me')).toBeDefined();
    await new Promise((r) => setTimeout(r, 100));
    expect(store.get('expire-me')).toBeUndefined();
    store.destroy();
  });
});

describe('Receipt endpoint', () => {
  let app: FastifyInstance;
  let receiptStore: InstanceType<typeof ReceiptStoreClass>;

  beforeEach(async () => {
    receiptStore = new MemoryReceiptStore();
    app = await buildTestServer(receiptStore);
  });

  afterEach(async () => {
    receiptStore.destroy();
    await app.close();
  });

  it('returns 404 for unknown nonce', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/x402/receipts/unknown-nonce',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Receipt not found' });
  });

  it('saves receipt after successful payment and retrieves via endpoint', async () => {
    // Use a real HTTP server + x402Fetch for the full 402 → pay → retry flow
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const payer = new MockPayer({ secret: SECRET });

    // Step 1: x402Fetch handles 402 → pay → retry automatically
    const paidRes = await x402Fetch(`${baseUrl}/priced`, {}, { payer });
    expect(paidRes.status).toBe(200);
    const body = await paidRes.json();
    expect(body).toEqual({ paid: true });

    // Step 2: Retrieve the receipt nonce from the store (test has direct access)
    expect(receiptStore.size).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeInternal = (receiptStore as any).store as Map<string, { receipt: { nonce: string } }>;
    const savedNonce = storeInternal.values().next().value.receipt.nonce;

    const receiptRes = await fetch(`${baseUrl}/x402/receipts/${savedNonce}`);
    expect(receiptRes.status).toBe(200);
    const receipt = await receiptRes.json();
    expect(receipt.nonce).toBe(savedNonce);
    expect(receipt.amount).toBe('0.001');
    expect(receipt.asset).toBe('USDC');
    expect(receipt.endpoint).toBe('/priced');
    expect(receipt.method).toBe('GET');
    expect(receipt.requestHash).toBeDefined();
    expect(receipt.paidAt).toBeDefined();
  });
});

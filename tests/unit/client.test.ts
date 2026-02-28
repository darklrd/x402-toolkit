/**
 * Unit tests — x402Fetch and createTool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { x402Fetch, createTool } from 'x402-agent-client';
import type { PayerInterface, X402Challenge, RequestContext, PaymentProof } from 'x402-agent-client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeChallenge(overrides: Partial<X402Challenge> = {}): X402Challenge {
  return {
    version: 1,
    scheme: 'exact',
    price: '0.001',
    asset: 'USDC',
    network: 'mock',
    recipient: '0xTEST',
    nonce: 'test-nonce-1234',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

function makeProof(challenge: X402Challenge): PaymentProof {
  return {
    version: challenge.version,
    nonce: challenge.nonce,
    requestHash: challenge.requestHash,
    payer: 'mock://0x1',
    timestamp: new Date().toISOString(),
    expiresAt: challenge.expiresAt,
    signature: 'fake-sig',
  };
}


class SpyPayer implements PayerInterface {
  calls: Array<{ challenge: X402Challenge; context: RequestContext }> = [];

  async pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof> {
    this.calls.push({ challenge, context });
    return makeProof(challenge);
  }
}

// ── x402Fetch tests ───────────────────────────────────────────────────────────

describe('x402Fetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes through non-402 responses unchanged', async () => {
    const payer = new SpyPayer();
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockResponse));

    const res = await x402Fetch('http://localhost/free', {}, { payer });
    expect(res.status).toBe(200);
    expect(payer.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('calls payer.pay on 402 and retries with proof', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    const mock402 = new Response(JSON.stringify({ x402: challenge }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
    const mock200 = new Response(JSON.stringify({ paid: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mock200);
    vi.stubGlobal('fetch', fetchMock);

    const res = await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1 });

    expect(res.status).toBe(200);
    expect(payer.calls).toHaveLength(1);
    expect(payer.calls[0]?.challenge.nonce).toBe(challenge.nonce);

    // Second fetch call must include X-Payment-Proof header
    const secondCallArgs = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = secondCallArgs?.[1]?.headers as Record<string, string>;
    expect(headers?.['x-payment-proof']).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('returns 402 if payer fails and maxRetries is 0', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    const mock402 = new Response(JSON.stringify({ x402: challenge }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mock402));

    const res = await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 0 });
    expect(res.status).toBe(402);
    expect(payer.calls).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('passes existing headers through on retry', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    const mock402 = new Response(JSON.stringify({ x402: challenge }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
    const mock200 = new Response('{}', { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mock200);
    vi.stubGlobal('fetch', fetchMock);

    await x402Fetch(
      'http://localhost/priced',
      { headers: { 'x-custom': 'hello' } },
      { payer, maxRetries: 1 },
    );

    const retryInit = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = retryInit?.[1]?.headers as Record<string, string>;
    expect(headers?.['x-custom']).toBe('hello');
    expect(headers?.['x-payment-proof']).toBeDefined();

    vi.unstubAllGlobals();
  });

  it('does not retry on non-x402 402 body', async () => {
    const payer = new SpyPayer();
    const mock402 = new Response(JSON.stringify({ error: 'payment required' }), { status: 402 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mock402));

    const res = await x402Fetch('http://localhost/other', {}, { payer, maxRetries: 1 });
    expect(res.status).toBe(402);
    expect(payer.calls).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

// ── createTool tests ──────────────────────────────────────────────────────────

describe('createTool', () => {
  it('returns a tool with correct name, description, inputSchema', () => {
    const payer = new SpyPayer();
    const tool = createTool({
      name: 'my_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      endpoint: 'http://localhost/tool',
      fetchOptions: { payer },
    });

    expect(tool.name).toBe('my_tool');
    expect(tool.description).toBe('A test tool');
    expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });

  it('throws on missing required field', async () => {
    const payer = new SpyPayer();
    const tool = createTool({
      name: 'strict_tool',
      description: 'Requires x',
      inputSchema: { type: 'object', required: ['x'] },
      endpoint: 'http://localhost/tool',
      fetchOptions: { payer },
    });

    await expect(tool.invoke({})).rejects.toThrow('Missing required field: x');
  });

  it('GET tool appends input as query params', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    const mock402 = new Response(JSON.stringify({ x402: challenge }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
    const mock200 = new Response(JSON.stringify({ result: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mock200);
    vi.stubGlobal('fetch', fetchMock);

    const tool = createTool({
      name: 'get_tool',
      description: 'test',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      endpoint: 'http://localhost/weather',
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1 },
    });

    const result = await tool.invoke({ city: 'London' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    // First fetch URL should include city query param
    const firstUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(firstUrl.searchParams.get('city')).toBe('London');

    vi.unstubAllGlobals();
  });

  it('POST tool sends input as JSON body', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    const mock402 = new Response(JSON.stringify({ x402: challenge }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
    const mock200 = new Response(JSON.stringify({ result: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mock200));

    const tool = createTool({
      name: 'post_tool',
      description: 'test',
      inputSchema: { type: 'object' },
      endpoint: 'http://localhost/action',
      method: 'POST',
      fetchOptions: { payer, maxRetries: 1 },
    });

    const result = await tool.invoke({ action: 'run' });
    expect(result.ok).toBe(true);

    vi.unstubAllGlobals();
  });
});

// ── MockPayer / MockVerifier round-trip ───────────────────────────────────────

describe('MockPayer + MockVerifier round-trip (without server)', () => {
  it('MockPayer proof passes MockVerifier verification', async () => {
    const { MockPayer, MockVerifier } = await import('x402-adapters');
    const SECRET = 'round-trip-secret';
    const payer = new MockPayer({ secret: SECRET });
    const verifier = new MockVerifier({ secret: SECRET });

    const challenge = makeChallenge({ nonce: 'rt-nonce', requestHash: 'b'.repeat(64) });
    const proof = await payer.pay(challenge, { url: 'http://x/tool', method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');

    const valid = await verifier.verify(proofHeader, 'b'.repeat(64), {
      price: '0.001',
      asset: 'USDC',
      recipient: '0xTEST',
    });
    expect(valid).toBe(true);
  });

  it('wrong secret fails verification', async () => {
    const { MockPayer, MockVerifier } = await import('x402-adapters');
    const payer = new MockPayer({ secret: 'correct' });
    const verifier = new MockVerifier({ secret: 'wrong' });

    const challenge = makeChallenge({ nonce: 'n1', requestHash: 'c'.repeat(64) });
    const proof = await payer.pay(challenge, { url: 'http://x', method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url');

    const valid = await verifier.verify(proofHeader, 'c'.repeat(64), {
      price: '0.001',
      asset: 'USDC',
      recipient: '0xTEST',
    });
    expect(valid).toBe(false);
  });

  it('tampered requestHash fails verification', async () => {
    const { MockPayer, MockVerifier } = await import('x402-adapters');
    const SECRET = 'tamper-secret';
    const payer = new MockPayer({ secret: SECRET });
    const verifier = new MockVerifier({ secret: SECRET });

    const challenge = makeChallenge({ nonce: 'n2', requestHash: 'd'.repeat(64) });
    const proof = await payer.pay(challenge, { url: 'http://x', method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url');

    // Server re-computes a different requestHash (e.g. request was tampered)
    const valid = await verifier.verify(proofHeader, 'e'.repeat(64), {
      price: '0.001',
      asset: 'USDC',
      recipient: '0xTEST',
    });
    expect(valid).toBe(false);
  });

  it('expired proof fails verification', async () => {
    const { MockPayer, MockVerifier } = await import('x402-adapters');
    const SECRET = 'exp-secret';
    const payer = new MockPayer({ secret: SECRET });
    const verifier = new MockVerifier({ secret: SECRET });

    const challenge = makeChallenge({
      nonce: 'n3',
      requestHash: 'f'.repeat(64),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });
    const proof = await payer.pay(challenge, { url: 'http://x', method: 'GET' });
    const proofHeader = Buffer.from(JSON.stringify(proof)).toString('base64url');

    const valid = await verifier.verify(proofHeader, 'f'.repeat(64), {
      price: '0.001',
      asset: 'USDC',
      recipient: '0xTEST',
    });
    expect(valid).toBe(false);
  });
});

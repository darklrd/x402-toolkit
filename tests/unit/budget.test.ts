import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BudgetTracker,
  BudgetExceededError,
  x402Fetch,
  createTool,
} from '@darklrd/x402-agent-client';
import type {
  PayerInterface,
  X402Challenge,
  RequestContext,
  PaymentProof,
} from '@darklrd/x402-agent-client';

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

// ── BudgetTracker standalone ─────────────────────────────────────────────────

describe('BudgetTracker', () => {
  it('initializes with zero spent', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    expect(budget.spent).toBe('0');
    expect(budget.remaining).toBe('0.05');
  });

  it('reserve increments spent', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    budget.reserve('0.001');
    expect(budget.spent).toBe('0.001');
  });

  it('reserve multiple times accumulates', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    budget.reserve('0.001');
    budget.reserve('0.001');
    budget.reserve('0.001');
    expect(budget.spent).toBe('0.003');
  });

  it('reserve throws BudgetExceededError when amount exceeds remaining', () => {
    const budget = new BudgetTracker({ maxSpend: '0.002' });
    expect(() => budget.reserve('0.003')).toThrow(BudgetExceededError);
  });

  it('reserve throws when cumulative spend would exceed budget', () => {
    const budget = new BudgetTracker({ maxSpend: '0.005' });
    budget.reserve('0.003');
    expect(() => budget.reserve('0.003')).toThrow(BudgetExceededError);
  });

  it('reserve exact remaining succeeds', () => {
    const budget = new BudgetTracker({ maxSpend: '0.002' });
    budget.reserve('0.001');
    budget.reserve('0.001');
    expect(budget.remaining).toBe('0');
  });

  it('release decrements spent', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    budget.reserve('0.003');
    budget.release('0.001');
    expect(budget.spent).toBe('0.002');
  });

  it('release does not go below zero', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    budget.reserve('0.001');
    budget.release('0.005');
    expect(budget.spent).toBe('0');
  });

  it('reset zeroes spent', () => {
    const budget = new BudgetTracker({ maxSpend: '0.05' });
    budget.reserve('0.003');
    budget.reset();
    expect(budget.spent).toBe('0');
    expect(budget.remaining).toBe('0.05');
  });

  it('BudgetExceededError has correct name and fields', () => {
    const budget = new BudgetTracker({ maxSpend: '0.002' });
    budget.reserve('0.001');
    try {
      budget.reserve('0.005');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const e = err as BudgetExceededError;
      expect(e.name).toBe('BudgetExceededError');
      expect(e.requested).toBe('0.005');
      expect(e.spent).toBe('0.001');
      expect(e.maxSpend).toBe('0.002');
      expect(e.remaining).toBe('0.001');
    }
  });
});

// ── x402Fetch with budget ────────────────────────────────────────────────────

describe('x402Fetch with budget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('records spend after successful 402 payment', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1, budget });
    expect(budget.spent).toBe('0.001');
    vi.unstubAllGlobals();
  });

  it('throws BudgetExceededError before calling payer when budget exceeded', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.0005' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } })));

    await expect(
      x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1, budget }),
    ).rejects.toThrow(BudgetExceededError);
    expect(payer.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('accumulates across multiple x402Fetch calls', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    const makeMocks = () => vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    vi.stubGlobal('fetch', makeMocks());
    await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1, budget });

    vi.stubGlobal('fetch', makeMocks());
    await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1, budget });

    expect(budget.spent).toBe('0.002');
    vi.unstubAllGlobals();
  });

  it('releases reservation when payer.pay throws', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const budget = new BudgetTracker({ maxSpend: '0.01' });
    const failPayer: PayerInterface = {
      pay: async () => { throw new Error('payer broke'); },
    };

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } })));

    await expect(
      x402Fetch('http://localhost/priced', {}, { payer: failPayer, maxRetries: 1, budget }),
    ).rejects.toThrow('payer broke');
    expect(budget.spent).toBe('0');
    vi.unstubAllGlobals();
  });

  it('no budget option works as before (no regression)', async () => {
    const challenge = makeChallenge();
    const payer = new SpyPayer();

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    const res = await x402Fetch('http://localhost/priced', {}, { payer, maxRetries: 1 });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('budget not charged on non-402 responses', async () => {
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 })));

    await x402Fetch('http://localhost/free', {}, { payer, maxRetries: 1, budget });
    expect(budget.spent).toBe('0');
    vi.unstubAllGlobals();
  });

  it('budget not charged on non-x402 402 responses', async () => {
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'pay up' }), { status: 402 })));

    await x402Fetch('http://localhost/other', {}, { payer, maxRetries: 1, budget });
    expect(budget.spent).toBe('0');
    vi.unstubAllGlobals();
  });
});

// ── createTool with budget ───────────────────────────────────────────────────

describe('createTool with budget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('tool.invoke records spend via shared budget', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: true }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const tool = createTool({
      name: 'test_tool',
      description: 'test',
      inputSchema: { type: 'object' },
      endpoint: 'http://localhost/tool',
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    await tool.invoke({});
    expect(budget.spent).toBe('0.001');
    vi.unstubAllGlobals();
  });

  it('tool.invoke throws BudgetExceededError when budget exceeded', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.0005' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } })));

    const tool = createTool({
      name: 'test_tool',
      description: 'test',
      inputSchema: { type: 'object' },
      endpoint: 'http://localhost/tool',
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    await expect(tool.invoke({})).rejects.toThrow(BudgetExceededError);
    vi.unstubAllGlobals();
  });

  it('multiple tools sharing one budget accumulate correctly', async () => {
    const challenge = makeChallenge({ price: '0.001' });
    const payer = new SpyPayer();
    const budget = new BudgetTracker({ maxSpend: '0.01' });

    const makeMocks = () => vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ x402: challenge }), { status: 402, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: true }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const tool1 = createTool({
      name: 'tool_a',
      description: 'a',
      inputSchema: { type: 'object' },
      endpoint: 'http://localhost/a',
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    const tool2 = createTool({
      name: 'tool_b',
      description: 'b',
      inputSchema: { type: 'object' },
      endpoint: 'http://localhost/b',
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1, budget },
    });

    vi.stubGlobal('fetch', makeMocks());
    await tool1.invoke({});

    vi.stubGlobal('fetch', makeMocks());
    await tool2.invoke({});

    expect(budget.spent).toBe('0.002');
    vi.unstubAllGlobals();
  });
});

import { describe, it, expect } from 'vitest';
import {
  createPaidMcpRegistry,
  createMcpPaymentGuard,
  MemoryMcpReceiptStore,
} from 'x402-mcp';
import type { McpGuardDecision, McpPaymentGuard, PaidMcpRegistry } from 'x402-mcp';
import { MockPayer, MockVerifier } from 'x402-adapters';
import type { X402Challenge } from '@darklrd/x402-agent-client';

const SECRET = 'guard-secret';
const TRANSPORT_PATH = '/mcp';
const pricing = { price: '0.001', asset: 'USDC', network: 'mock', recipient: 'merchant' };

function buildRegistry(): PaidMcpRegistry {
  const registry = createPaidMcpRegistry();
  registry.tool(
    {
      name: 'get_weather',
      description: 'weather',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      pricing,
    },
    async () => ({ content: [] }),
  );
  registry.tool(
    {
      name: 'get_price',
      description: 'price',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } },
      pricing,
    },
    async () => ({ content: [] }),
  );
  return registry;
}

function makeGuard(overrides: Partial<Parameters<typeof createMcpPaymentGuard>[0]> = {}): McpPaymentGuard {
  return createMcpPaymentGuard({
    transportPath: TRANSPORT_PATH,
    registry: buildRegistry(),
    verifier: new MockVerifier({ secret: SECRET }),
    ...overrides,
  });
}

function callBody(name: string, args: Record<string, unknown> = {}, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function asChallenge(decision: McpGuardDecision): X402Challenge {
  if (decision.action !== 'challenge') {
    throw new Error(`expected challenge, got ${decision.action}`);
  }
  return (decision.body as { x402: X402Challenge }).x402;
}

function encodeProofHeader(proof: unknown): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

async function signedHeaderFor(
  guard: McpPaymentGuard,
  name: string,
  args: Record<string, unknown>,
  secret = SECRET,
): Promise<string> {
  const challengeDecision = await guard.evaluate({ body: callBody(name, args), headers: {} });
  const challenge = asChallenge(challengeDecision);
  const payer = new MockPayer({ secret });
  const proof = await payer.pay(challenge, { url: 'http://localhost/mcp', method: 'POST' });
  return encodeProofHeader(proof);
}

describe('createMcpPaymentGuard', () => {
  it('emits a 402 challenge for a paid tool call without a proof', async () => {
    const guard = makeGuard();
    const decision = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: {},
    });
    expect(decision.action).toBe('challenge');
    expect((decision as Extract<McpGuardDecision, { action: 'challenge' }>).status).toBe(402);
    const challenge = asChallenge(decision);
    expect(challenge.price).toBe('0.001');
    expect(challenge.requestHash).toMatch(/^[0-9a-f]{64}$/);
    guard.dispose();
  });

  it('passes through non-tools/call methods like tools/list', async () => {
    const guard = makeGuard();
    const decision = await guard.evaluate({
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      headers: {},
    });
    expect(decision.action).toBe('passthrough');
    guard.dispose();
  });

  it('rejects JSON-RPC batch requests', async () => {
    const guard = makeGuard();
    const decision = await guard.evaluate({
      body: [callBody('get_weather', { city: 'London' })],
      headers: {},
    });
    expect(decision.action).toBe('reject');
    expect((decision as Extract<McpGuardDecision, { action: 'reject' }>).status).toBe(400);
    guard.dispose();
  });

  it('rejects an unknown tool when allowUnpricedTools is false (default)', async () => {
    const guard = makeGuard();
    const decision = await guard.evaluate({ body: callBody('unknown_tool'), headers: {} });
    expect(decision.action).toBe('reject');
    guard.dispose();
  });

  it('passes through an unknown tool when allowUnpricedTools is true', async () => {
    const guard = makeGuard({ allowUnpricedTools: true });
    const decision = await guard.evaluate({ body: callBody('unknown_tool'), headers: {} });
    expect(decision.action).toBe('passthrough');
    guard.dispose();
  });

  it('rejects an invalid proof (wrong signing secret)', async () => {
    const guard = makeGuard();
    const header = await signedHeaderFor(guard, 'get_weather', { city: 'London' }, 'wrong-secret');
    const decision = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: { 'x-payment-proof': header },
    });
    expect(decision.action).toBe('reject');
    expect((decision as Extract<McpGuardDecision, { action: 'reject' }>).status).toBe(402);
    guard.dispose();
  });

  it('accepts a valid proof and then rejects its replay', async () => {
    const guard = makeGuard();
    const header = await signedHeaderFor(guard, 'get_weather', { city: 'London' });

    const first = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: { 'x-payment-proof': header },
    });
    expect(first.action).toBe('proceed');

    const replay = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }, 2),
      headers: { 'x-payment-proof': header },
    });
    expect(replay.action).toBe('reject');
    guard.dispose();
  });

  it('rejects a proof bound to a different tool (cross-tool reuse)', async () => {
    const guard = makeGuard();
    // Sign a proof for get_weather, then try to spend it on get_price.
    const header = await signedHeaderFor(guard, 'get_weather', { city: 'London' });
    const decision = await guard.evaluate({
      body: callBody('get_price', { symbol: 'BTC' }),
      headers: { 'x-payment-proof': header },
    });
    expect(decision.action).toBe('reject');
    guard.dispose();
  });

  it('records an MCP receipt with the tool name on a successful payment', async () => {
    const receiptStore = new MemoryMcpReceiptStore();
    const guard = makeGuard({ receiptStore });

    const challengeDecision = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: {},
    });
    const challenge = asChallenge(challengeDecision);
    const payer = new MockPayer({ secret: SECRET });
    const proof = await payer.pay(challenge, { url: 'http://localhost/mcp', method: 'POST' });

    const decision = await guard.evaluate({
      body: callBody('get_weather', { city: 'London' }),
      headers: { 'x-payment-proof': encodeProofHeader(proof) },
    });
    expect(decision.action).toBe('proceed');

    const receipt = receiptStore.get(challenge.nonce);
    expect(receipt?.toolName).toBe('get_weather');
    expect(receipt?.mcpMethod).toBe('tools/call');
    expect(receipt?.method).toBe('MCP');
    expect(receipt?.endpoint).toBe(TRANSPORT_PATH);
    receiptStore.destroy();
    guard.dispose();
  });
});

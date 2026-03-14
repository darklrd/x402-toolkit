import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { createTool, executeToolCall } from '@darklrd/x402-agent-client';
import type { Tool } from '@darklrd/x402-agent-client';

const SECRET = 'openai-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xE2E',
};

async function buildE2EServer(secret: string) {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret }),
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/secret',
      pricing: PRICING,
      handler: async () => {
        return { secret: '42' };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('OpenAI executeToolCall E2E integration', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;
  let secretTool: Tool;

  beforeAll(async () => {
    ({ fastify, baseUrl } = await buildE2EServer(SECRET));
    const payer = new MockPayer({ secret: SECRET });
    secretTool = createTool({
      name: 'get_secret',
      description: 'Fetch the secret value',
      inputSchema: { type: 'object', properties: {}, required: [] },
      endpoint: `${baseUrl}/secret`,
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1 },
    });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('successful invoke returns tool message with correct content', async () => {
    const result = await executeToolCall(
      { id: 'call_1', name: secretTool.name, args: {} },
      [secretTool],
    );
    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe('call_1');
    expect(typeof result.content).toBe('string');
    const data = JSON.parse(result.content as string) as { secret: string };
    expect(data).toEqual({ secret: '42' });
  });

  it('throws when tool name does not match any tool', async () => {
    await expect(
      executeToolCall({ id: 'call_2', name: 'nonexistent_tool', args: {} }, [secretTool]),
    ).rejects.toThrow('nonexistent_tool');
  });

  it('returns error tool message when payer is rejected by verifier', async () => {
    const wrongPayer = new MockPayer({ secret: 'wrong-secret' });
    const wrongTool = createTool({
      name: 'get_secret',
      description: 'Fetch the secret value',
      inputSchema: { type: 'object', properties: {}, required: [] },
      endpoint: `${baseUrl}/secret`,
      method: 'GET',
      fetchOptions: { payer: wrongPayer, maxRetries: 1 },
    });

    const result = await executeToolCall(
      { id: 'call_3', name: 'get_secret', args: {} },
      [wrongTool],
    );
    expect(result.role).toBe('tool');
    const parsed = JSON.parse(result.content as string) as { error: boolean };
    expect(parsed.error).toBe(true);
  });
});

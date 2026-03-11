import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createX402Middleware, pricedRoute } from 'x402-tool-server';
import { MockPayer, MockVerifier } from 'x402-adapters';
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { X402Tool, createX402Tools } from 'x402-langchain';
import type { X402ToolConfig } from 'x402-langchain';

const SECRET = 'langchain-e2e-secret';
const PRICING = {
  price: '0.001',
  asset: 'USDC',
  network: 'mock',
  recipient: '0xE2E',
};

async function buildE2EServer() {
  const fastify = Fastify({ logger: false });

  fastify.register(
    createX402Middleware({
      verifier: new MockVerifier({ secret: SECRET }),
    }),
  );

  fastify.route(
    pricedRoute({
      method: 'GET',
      url: '/weather',
      pricing: PRICING,
      handler: async (req) => {
        const { city } = req.query as { city: string };
        return { city, temp: 20, condition: 'Sunny' };
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
        return { executed: body.action, at: new Date().toISOString() };
      },
    }),
  );

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address() as { port: number };
  return { fastify, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('LangChain E2E integration', () => {
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

  it('X402Tool GET: invoke weather tool returns JSON string with weather data', async () => {
    const weatherSchema = z.object({ city: z.string().describe('City name') });
    const tool = new X402Tool({
      name: 'get_weather',
      description: 'Get current weather for a city',
      schema: weatherSchema,
      endpoint: `${baseUrl}/weather`,
      method: 'GET',
      fetchOptions: { payer, maxRetries: 1 },
    });

    const result = await tool.invoke({ city: 'Paris' });

    expect(typeof result).toBe('string');
    const data = JSON.parse(result as string) as { city: string; temp: number; condition: string };
    expect(data.city).toBe('Paris');
    expect(data.temp).toBe(20);
    expect(data.condition).toBe('Sunny');
  });

  it('X402Tool is instanceof StructuredTool', () => {
    const schema = z.object({ city: z.string() });
    const tool = new X402Tool({
      name: 'test_tool',
      description: 'Test',
      schema,
      endpoint: `${baseUrl}/weather`,
      fetchOptions: { payer },
    });

    expect(tool).toBeInstanceOf(StructuredTool);
  });

  it('X402Tool with wrong payer throws on invoke', async () => {
    const wrongPayer = new MockPayer({ secret: 'wrong-secret' });
    const schema = z.object({ city: z.string() });
    const tool = new X402Tool({
      name: 'get_weather_fail',
      description: 'Get weather',
      schema,
      endpoint: `${baseUrl}/weather`,
      method: 'GET',
      fetchOptions: { payer: wrongPayer, maxRetries: 1 },
    });

    await expect(tool.invoke({ city: 'Berlin' })).rejects.toThrow(/402/);
  });

  it('createX402Tools factory: create 2 tools, invoke both, verify correct responses', async () => {
    const weatherSchema = z.object({ city: z.string() });
    const actionSchema = z.object({ action: z.string() });

    const configs: X402ToolConfig[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        schema: weatherSchema,
        endpoint: `${baseUrl}/weather`,
        method: 'GET',
        fetchOptions: { payer, maxRetries: 1 },
      },
      {
        name: 'do_action',
        description: 'Do action',
        schema: actionSchema,
        endpoint: `${baseUrl}/action`,
        method: 'POST',
        fetchOptions: { payer, maxRetries: 1 },
      },
    ];

    const tools = createX402Tools(configs);
    expect(tools).toHaveLength(2);

    const weatherResult = await tools[0].invoke({ city: 'Tokyo' });
    const weatherData = JSON.parse(weatherResult as string) as { city: string };
    expect(weatherData.city).toBe('Tokyo');

    const actionResult = await tools[1].invoke({ action: 'deploy' });
    const actionData = JSON.parse(actionResult as string) as { executed: string };
    expect(actionData.executed).toBe('deploy');
  });
});

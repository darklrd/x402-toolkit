import { describe, it, expect } from 'vitest';
import { createPaidMcpRegistry } from 'x402-mcp';
import type { PaidMcpToolConfig } from 'x402-mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const weatherConfig: PaidMcpToolConfig = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: 'merchant' },
};

describe('createPaidMcpRegistry', () => {
  it('rejects duplicate tool names', () => {
    const registry = createPaidMcpRegistry();
    registry.tool(weatherConfig, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    expect(() =>
      registry.tool(weatherConfig, async () => ({ content: [] })),
    ).toThrow(/already registered/);
  });

  it('returns pricing and config for a registered tool', () => {
    const registry = createPaidMcpRegistry();
    registry.tool(weatherConfig, async () => ({ content: [] }));
    expect(registry.has('get_weather')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(registry.get('get_weather')?.config.pricing.price).toBe('0.001');
    expect(registry.list()).toHaveLength(1);
  });

  it('createMcpServer exposes registered tools via tools/list', async () => {
    const registry = createPaidMcpRegistry();
    registry.tool(weatherConfig, async ({ city }) => ({
      content: [{ type: 'text', text: JSON.stringify({ city }) }],
    }));

    const server = registry.createMcpServer({ name: 'test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toContain('get_weather');
    const tool = list.tools.find((t) => t.name === 'get_weather');
    expect(tool?.inputSchema?.required).toContain('city');

    await client.close();
    await server.close();
  });

  it('createMcpServer dispatches tools/call to the registered handler', async () => {
    const registry = createPaidMcpRegistry();
    registry.tool(weatherConfig, async ({ city }) => ({
      content: [{ type: 'text', text: JSON.stringify({ city, temp: 22 }) }],
    }));

    const server = registry.createMcpServer({ name: 'test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: 'get_weather', arguments: { city: 'London' } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual({ city: 'London', temp: 22 });

    await client.close();
    await server.close();
  });
});

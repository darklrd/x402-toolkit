import { describe, it, expect } from 'vitest';
import { toBazaarMcpResource } from 'x402-mcp';
import type { PaidMcpToolConfig } from 'x402-mcp';

describe('toBazaarMcpResource', () => {
  it('emits type "mcp" and the tool schema', () => {
    const config: PaidMcpToolConfig = {
      name: 'get_weather',
      description: 'Get current weather for a city',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: 'merchant' },
      discovery: { example: { city: 'London' }, transport: 'streamable-http' },
    };

    const resource = toBazaarMcpResource(config, 'http://localhost:3402/mcp');

    expect(resource.type).toBe('mcp');
    expect(resource.resource).toBe('mcp://tool/get_weather');

    const info = resource.extensions.bazaar.info.input;
    expect(info.type).toBe('mcp');
    expect(info.toolName).toBe('get_weather');
    expect(info.inputSchema).toEqual(config.inputSchema);
    expect(info.description).toBe('Get current weather for a city');
    expect(info.transport).toBe('streamable-http');
    expect(info.example).toEqual({ city: 'London' });
    expect(info.endpoint).toBe('http://localhost:3402/mcp');
  });

  it('defaults transport and resource when discovery is omitted', () => {
    const config: PaidMcpToolConfig = {
      name: 'get_price',
      description: 'Get price',
      inputSchema: { type: 'object', properties: {} },
      pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: 'merchant' },
    };

    const resource = toBazaarMcpResource(config, 'http://localhost:3402/mcp');

    expect(resource.resource).toBe('mcp://tool/get_price');
    expect(resource.extensions.bazaar.info.input.transport).toBe('streamable-http');
    expect(resource.extensions.bazaar.info.input.example).toBeUndefined();
  });

  it('honors an explicit discovery.resource override', () => {
    const config: PaidMcpToolConfig = {
      name: 'get_price',
      description: 'Get price',
      inputSchema: { type: 'object', properties: {} },
      pricing: { price: '0.001', asset: 'USDC', network: 'mock', recipient: 'merchant' },
      discovery: { resource: 'mcp://catalog/prices' },
    };

    const resource = toBazaarMcpResource(config, 'http://localhost:3402/mcp');
    expect(resource.resource).toBe('mcp://catalog/prices');
  });
});

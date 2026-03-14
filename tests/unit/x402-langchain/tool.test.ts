import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v3';
import { isStructuredTool } from '@langchain/core/tools';
import { X402Tool, createX402Tools } from 'x402-langchain';
import type { X402ToolConfig } from 'x402-langchain';
import type { PayerInterface, X402Challenge, RequestContext, PaymentProof } from '@darklrd/x402-agent-client';

vi.mock('@darklrd/x402-agent-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@darklrd/x402-agent-client')>();
  return {
    ...actual,
    createTool: vi.fn(),
  };
});

import { createTool } from '@darklrd/x402-agent-client';

class MockPayer implements PayerInterface {
  async pay(_challenge: X402Challenge, _context: RequestContext): Promise<PaymentProof> {
    return {
      version: 1,
      nonce: 'nonce',
      requestHash: 'a'.repeat(64),
      payer: 'mock://0x1',
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      signature: 'sig',
    };
  }
}

const weatherSchema = z.object({
  city: z.string().describe('City name'),
});

function makeConfig(overrides: Partial<X402ToolConfig> = {}): X402ToolConfig {
  return {
    name: 'get_weather',
    description: 'Get current weather',
    schema: weatherSchema,
    endpoint: 'http://localhost:3000/weather',
    method: 'GET',
    fetchOptions: { payer: new MockPayer() },
    ...overrides,
  };
}

describe('X402Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name, description, and schema after construction', () => {
    const mockInvoke = vi.fn();
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: mockInvoke,
    });

    const tool = new X402Tool(makeConfig());

    expect(tool.name).toBe('get_weather');
    expect(tool.description).toBe('Get current weather');
    expect(tool.schema).toBe(weatherSchema);
  });

  it('_call returns JSON string on success', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { temp: 22 } });
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: mockInvoke,
    });

    const tool = new X402Tool(makeConfig());
    const result = await tool._call({ city: 'Paris' });

    expect(result).toBe(JSON.stringify({ temp: 22 }));
    expect(mockInvoke).toHaveBeenCalledWith({ city: 'Paris' });
  });

  it('_call throws on failure (non-ok response)', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ ok: false, status: 402, data: {} });
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: mockInvoke,
    });

    const tool = new X402Tool(makeConfig());

    await expect(tool._call({ city: 'Paris' })).rejects.toThrow(/HTTP 402/);
  });

  it('returnDirect defaults to false', () => {
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: vi.fn(),
    });

    const tool = new X402Tool(makeConfig());

    expect(tool.returnDirect).toBe(false);
  });

  it('returnDirect can be set to true via config', () => {
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: vi.fn(),
    });

    const tool = new X402Tool(makeConfig({ returnDirect: true }));

    expect(tool.returnDirect).toBe(true);
  });

  it('createX402Tools creates correct number of instances', () => {
    vi.mocked(createTool).mockReturnValue({
      name: 'tool',
      description: 'desc',
      inputSchema: { type: 'object', properties: {} },
      invoke: vi.fn(),
    });

    const configs: X402ToolConfig[] = [
      makeConfig({ name: 'tool1' }),
      makeConfig({ name: 'tool2' }),
      makeConfig({ name: 'tool3' }),
    ];

    const tools = createX402Tools(configs);

    expect(tools).toHaveLength(3);
    expect(tools[0]).toBeInstanceOf(X402Tool);
    expect(tools[1]).toBeInstanceOf(X402Tool);
    expect(tools[2]).toBeInstanceOf(X402Tool);
  });

  it('X402Tool satisfies LangChain StructuredTool interface', () => {
    vi.mocked(createTool).mockReturnValue({
      name: 'get_weather',
      description: 'Get current weather',
      inputSchema: { type: 'object', properties: {} },
      invoke: vi.fn(),
    });

    const tool = new X402Tool(makeConfig());

    expect(isStructuredTool(tool)).toBe(true);
  });
});

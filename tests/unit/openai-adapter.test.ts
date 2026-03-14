import { describe, it, expect } from 'vitest';
import {
  toOpenAITool,
  toOpenAITools,
  parseToolCall,
  serializeResult,
} from '@darklrd/x402-agent-client';
import type { Tool } from '@darklrd/x402-agent-client';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions.js';

const mockTool: Tool = {
  name: 'get_secret',
  description: 'Fetch a secret value',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Secret key' },
    },
    required: ['key'],
  },
  async invoke() {
    return { ok: true, status: 200, data: { secret: 'hello' } };
  },
};

describe('toOpenAITool', () => {
  it('maps a Tool to a ChatCompletionTool', () => {
    const result = toOpenAITool(mockTool);
    expect(result).toEqual({
      type: 'function',
      function: {
        name: 'get_secret',
        description: 'Fetch a secret value',
        parameters: mockTool.inputSchema,
      },
    });
  });
});

describe('toOpenAITools', () => {
  it('maps an array of 2 tools correctly', () => {
    const tool2: Tool = { ...mockTool, name: 'tool_2', description: 'Tool 2' };
    const result = toOpenAITools([mockTool, tool2]);
    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('get_secret');
    expect(result[1].function.name).toBe('tool_2');
    expect(result[0].type).toBe('function');
    expect(result[1].type).toBe('function');
  });
});

describe('parseToolCall', () => {
  it('parses a valid tool call', () => {
    const toolCall: ChatCompletionMessageToolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'foo', arguments: '{"bar":1}' },
    };
    const result = parseToolCall(toolCall);
    expect(result).toEqual({ id: 'call_1', name: 'foo', args: { bar: 1 } });
  });

  it('throws on malformed JSON arguments', () => {
    const toolCall: ChatCompletionMessageToolCall = {
      id: 'call_2',
      type: 'function',
      function: { name: 'foo', arguments: '{bad json' },
    };
    expect(() => parseToolCall(toolCall)).toThrow();
  });
});

describe('serializeResult', () => {
  it('returns JSON of data on success', () => {
    const result = serializeResult({ ok: true, status: 200, data: { secret: 'hello' } });
    expect(result).toBe('{"secret":"hello"}');
  });

  it('returns error JSON on failure', () => {
    const result = serializeResult({ ok: false, status: 402, data: 'payment required' });
    const parsed = JSON.parse(result) as { error: boolean; status: number; data: string };
    expect(parsed.error).toBe(true);
    expect(parsed.status).toBe(402);
  });
});

import type {
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions.js';
import type { Tool } from './tool.js';
import type { ToolInvokeResult } from './types.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export function toOpenAITool(tool: Tool): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  };
}

export function toOpenAITools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map(toOpenAITool);
}

export function parseToolCall(toolCall: ChatCompletionMessageToolCall): ParsedToolCall {
  const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args,
  };
}

export function serializeResult(result: ToolInvokeResult): string {
  if (result.ok) {
    return JSON.stringify(result.data);
  }
  return JSON.stringify({ error: true, status: result.status, data: result.data });
}

export async function executeToolCall(
  parsed: ParsedToolCall,
  tools: Tool[],
): Promise<ChatCompletionToolMessageParam> {
  const tool = tools.find((t) => t.name === parsed.name);
  if (!tool) {
    throw new Error(`Tool not found: ${parsed.name}`);
  }

  try {
    const result = await tool.invoke(parsed.args);
    return {
      role: 'tool',
      tool_call_id: parsed.id,
      content: serializeResult(result),
    };
  } catch {
    return {
      role: 'tool',
      tool_call_id: parsed.id,
      content: JSON.stringify({ error: true, status: 500, data: 'Tool invocation failed' }),
    };
  }
}

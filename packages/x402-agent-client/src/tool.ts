/**
 * createTool — agent-friendly wrapper around x402Fetch.
 *
 * Creates a "tool" object compatible with LLM agent frameworks.
 * The tool validates the input against the declared JSON Schema and
 * calls the priced endpoint via x402Fetch.
 *
 * Usage:
 *   const weatherTool = createTool({
 *     name: 'get_weather',
 *     description: 'Fetch current weather for a city',
 *     inputSchema: {
 *       type: 'object',
 *       properties: { city: { type: 'string', description: 'City name' } },
 *       required: ['city'],
 *     },
 *     endpoint: 'http://localhost:3000/weather',
 *     method: 'GET',
 *     fetchOptions: { payer },
 *   });
 *
 *   const result = await weatherTool.invoke({ city: 'London' });
 */
import { x402Fetch } from './fetch.js';
import type { ToolConfig, ToolInvokeResult, JsonSchema } from './types.js';

function validateInput(input: Record<string, unknown>, schema: JsonSchema): string | null {
  if (!schema.required) return null;
  for (const key of schema.required) {
    if (!(key in input) || input[key] === undefined || input[key] === null) {
      return `Missing required field: ${key}`;
    }
  }
  return null;
}

function buildUrl(endpoint: string, params: Record<string, unknown>): URL {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export interface Tool<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  /** Tool name (for agent framework registration) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for the input */
  inputSchema: JsonSchema;
  /**
   * Invoke the tool with the given input.
   * For GET requests, input fields are appended as query params.
   * For POST/PUT/PATCH, input is sent as a JSON body.
   */
  invoke(input: TInput): Promise<ToolInvokeResult<TOutput>>;
}

/**
 * Create an agent-friendly tool backed by a priced x402 endpoint.
 */
export function createTool<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput = unknown,
>(config: ToolConfig): Tool<TInput, TOutput> {
  const method = (config.method ?? 'GET').toUpperCase();

  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,

    async invoke(input: TInput): Promise<ToolInvokeResult<TOutput>> {
      // Validate required fields.
      const validationError = validateInput(input, config.inputSchema);
      if (validationError) {
        throw new Error(`[createTool:${config.name}] Input validation failed: ${validationError}`);
      }

      let url: URL;
      let body: string | undefined;
      let headers: Record<string, string> = {};

      if (method === 'GET' || method === 'DELETE') {
        url = buildUrl(config.endpoint, input);
      } else {
        url = new URL(config.endpoint);
        body = JSON.stringify(input);
        headers = { 'content-type': 'application/json' };
      }

      const response = await x402Fetch(
        url,
        { method, body, headers },
        config.fetchOptions,
      );

      let data: TOutput;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        data = (await response.json()) as TOutput;
      } else {
        data = (await response.text()) as unknown as TOutput;
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    },
  };
}

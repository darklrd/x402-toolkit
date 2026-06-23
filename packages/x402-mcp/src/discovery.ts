/**
 * x402 Bazaar-style discovery metadata for paid MCP tools.
 *
 * This is a helper only — it does not publish to a facilitator. Sellers can
 * expose the result on their own discovery endpoint or catalog.
 *
 * See: https://docs.x402.org/extensions/bazaar
 */
import type { PaidMcpToolConfig } from './types.js';

export interface BazaarMcpResource {
  type: 'mcp';
  resource: string;
  extensions: {
    bazaar: {
      info: {
        input: {
          type: 'mcp';
          toolName: string;
          inputSchema: PaidMcpToolConfig['inputSchema'];
          description: string;
          transport: string;
          endpoint: string;
          example?: Record<string, unknown>;
        };
      };
    };
  };
}

export function toBazaarMcpResource(
  config: PaidMcpToolConfig,
  baseUrl: string,
): BazaarMcpResource {
  return {
    type: 'mcp',
    resource: config.discovery?.resource ?? `mcp://tool/${config.name}`,
    extensions: {
      bazaar: {
        info: {
          input: {
            type: 'mcp',
            toolName: config.name,
            inputSchema: config.inputSchema,
            description: config.description,
            transport: config.discovery?.transport ?? 'streamable-http',
            endpoint: baseUrl,
            example: config.discovery?.example,
          },
        },
      },
    },
  };
}

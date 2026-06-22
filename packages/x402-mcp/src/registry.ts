/**
 * Paid MCP tool registry.
 *
 * Associates MCP tool names with pricing + handler, and builds a real
 * low-level MCP `Server` exposing those tools. We use the low-level Server
 * (rather than McpServer.registerTool) because our tool inputs are JSON
 * Schema — which is exactly MCP's wire `Tool.inputSchema` — whereas
 * registerTool expects Zod shapes.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  PaidMcpToolConfig,
  PaidMcpToolEntry,
  PaidMcpToolHandler,
} from './types.js';

export interface PaidMcpRegistry {
  /** Register a paid tool. Throws if the name is already registered. */
  tool(config: PaidMcpToolConfig, handler: PaidMcpToolHandler): PaidMcpRegistry;
  /** Get a registered tool entry by name. */
  get(name: string): PaidMcpToolEntry | undefined;
  /** Whether a tool name is registered. */
  has(name: string): boolean;
  /** All registered tool entries. */
  list(): PaidMcpToolEntry[];
  /** Build a fresh MCP Server that exposes all registered tools. */
  createMcpServer(serverInfo: { name: string; version: string }): Server;
}

export function createPaidMcpRegistry(): PaidMcpRegistry {
  const entries = new Map<string, PaidMcpToolEntry>();

  const registry: PaidMcpRegistry = {
    tool(config, handler) {
      if (entries.has(config.name)) {
        throw new Error(`Paid MCP tool "${config.name}" is already registered`);
      }
      entries.set(config.name, { config, handler });
      return registry;
    },

    get(name) {
      return entries.get(name);
    },

    has(name) {
      return entries.has(name);
    },

    list() {
      return Array.from(entries.values());
    },

    createMcpServer(serverInfo) {
      const server = new Server(serverInfo, {
        capabilities: { tools: {} },
      });

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools: Tool[] = registry.list().map((entry) => {
          const { config } = entry;
          const tool: Tool = {
            name: config.name,
            description: config.description,
            inputSchema: config.inputSchema as Tool['inputSchema'],
          };
          if (config.title !== undefined) tool.title = config.title;
          if (config.outputSchema !== undefined) {
            tool.outputSchema = config.outputSchema as Tool['outputSchema'];
          }
          if (config.annotations !== undefined) {
            tool.annotations = config.annotations as Tool['annotations'];
          }
          return tool;
        });
        return { tools };
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const entry = entries.get(request.params.name);
        if (!entry) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`,
          );
        }
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;
        const result = await entry.handler(args);
        return result as CallToolResult;
      });

      return server;
    },
  };

  return registry;
}

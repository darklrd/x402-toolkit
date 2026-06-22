/**
 * x402-mcp — public types.
 *
 * Reuses the existing toolkit payment primitives instead of inventing a
 * second payment stack:
 *  - PricingConfig / VerifierInterface / WireFormat from `x402-tool-server`
 *  - PayerInterface / BudgetTracker / X402Challenge from `@darklrd/x402-agent-client`
 */
import type { PricingConfig, VerifierInterface, WireFormat } from 'x402-tool-server';
import type {
  PayerInterface,
  BudgetTracker,
  X402Challenge,
  JsonSchema,
} from '@darklrd/x402-agent-client';
import type { PaidMcpRegistry } from './registry.js';

export type { PricingConfig, VerifierInterface, WireFormat, PayerInterface, BudgetTracker, X402Challenge, JsonSchema };

export type McpTransportKind = 'streamable-http' | 'sse';

// ─── MCP tool result (structural subset of the SDK's CallToolResult) ─────────

export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Handler invoked when a paid MCP tool is called with verified payment. */
export type PaidMcpToolHandler = (
  args: Record<string, unknown>,
) => McpToolResult | Promise<McpToolResult>;

// ─── Paid tool definition ────────────────────────────────────────────────────

export interface PaidMcpToolConfig {
  /** MCP tool name (params.name on tools/call). */
  name: string;
  /** Optional human-friendly title. */
  title?: string;
  /** Description shown in tools/list. */
  description: string;
  /** JSON Schema describing the tool input (MCP Tool.inputSchema). */
  inputSchema: JsonSchema;
  /** Optional JSON Schema describing structured output. */
  outputSchema?: JsonSchema;
  /** Optional MCP tool annotations. */
  annotations?: Record<string, unknown>;
  /** x402 pricing attached to this tool. */
  pricing: PricingConfig;
  /** Optional discovery metadata for x402 Bazaar-style catalogs. */
  discovery?: {
    example?: Record<string, unknown>;
    transport?: McpTransportKind;
    resource?: string;
  };
}

export interface PaidMcpToolEntry {
  config: PaidMcpToolConfig;
  handler: PaidMcpToolHandler;
}

// ─── Receipts (MCP-flavored, preserves the base Receipt fields) ──────────────

export interface McpReceipt {
  nonce: string;
  payer: string;
  amount: string;
  asset: string;
  network: string;
  recipient: string;
  /** Transport path that was paid for, e.g. "/mcp". */
  endpoint: string;
  /** Always "MCP" for MCP receipts. */
  method: 'MCP';
  requestHash: string;
  paidAt: string;
  toolName: string;
  mcpMethod: 'tools/call';
  argumentsHash: string;
  sessionId?: string;
}

export interface McpReceiptStore {
  save(receipt: McpReceipt): void;
  get(nonce: string): McpReceipt | undefined;
}

// ─── Server plugin options ───────────────────────────────────────────────────

export interface X402McpPluginOptions {
  /** Fastify route path for the MCP transport, e.g. "/mcp". */
  path: string;
  /** Paid tool registry (built with createPaidMcpRegistry). */
  registry: PaidMcpRegistry;
  /** Identity advertised to MCP clients during initialize. */
  serverInfo: { name: string; version: string };
  /** Verifier that validates payment proofs. */
  verifier: VerifierInterface;
  /** Optional receipt store; if provided, paid calls are recorded. */
  receiptStore?: McpReceiptStore;
  /** Challenge/proof wire format. Default: "toolkit". */
  wireFormat?: WireFormat;
  /** Default challenge TTL in seconds. Default: 300. */
  defaultTtlSeconds?: number;
  /** If true, calls to unpriced tools pass through. Default: false (fail closed). */
  allowUnpricedTools?: boolean;
  /** If false, JSON-RPC batches are allowed. Default: true (reject batches). */
  rejectBatchRequests?: boolean;
}

// ─── Client transport options ────────────────────────────────────────────────

export interface X402McpClientPolicyContext {
  toolName: string;
  challenge: X402Challenge;
  request: unknown;
}

export interface X402McpClientOptions {
  /** Payer that signs payment proofs. */
  payer: PayerInterface;
  /** Optional spend budget tracker. */
  budget?: BudgetTracker;
  /** Maximum payment retries per request. Default: 1. */
  maxRetries?: number;
  /** Optional policy hook invoked before any payment is signed. */
  policy?: (ctx: X402McpClientPolicyContext) => boolean | Promise<boolean>;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type X402McpErrorReason =
  | 'invalid_proof'
  | 'nonce_replay'
  | 'unknown_tool'
  | 'batch_rejected';

export interface X402McpChallengeEvent {
  toolName: string;
  mcpMethod: 'tools/call';
  pricing: PricingConfig;
  challenge: X402Challenge;
  requestHash: string;
  timestamp: string;
  ip?: string;
}

export interface X402McpPaymentEvent {
  toolName: string;
  mcpMethod: 'tools/call';
  pricing: PricingConfig;
  requestHash: string;
  payer: string;
  receipt: McpReceipt;
  timestamp: string;
  ip?: string;
}

export interface X402McpErrorEvent {
  toolName?: string;
  mcpMethod: 'tools/call';
  reason: X402McpErrorReason;
  pricing?: PricingConfig;
  requestHash?: string;
  timestamp: string;
  ip?: string;
}

export interface X402McpEventMap {
  'x402:mcp:challenge': [event: X402McpChallengeEvent];
  'x402:mcp:payment': [event: X402McpPaymentEvent];
  'x402:mcp:error': [event: X402McpErrorEvent];
}

/**
 * x402-mcp — MCP tools with x402 payment gating.
 *
 * Seller side:  createPaidMcpRegistry + x402McpPlugin (Fastify)
 * Buyer side:   createX402McpHttpTransport (MCP Streamable HTTP transport)
 * Discovery:    toBazaarMcpResource
 *
 * Reuses the existing toolkit payment primitives (verifier, payer, budget,
 * wire-format compat, mock + Solana adapters).
 */

// Registry
export { createPaidMcpRegistry } from './registry.js';
export type { PaidMcpRegistry } from './registry.js';

// Canonical hashing
export { canonicalJson, computeMcpRequestHash, computeArgumentsHash } from './canonical.js';
export type { McpRequestHashInput } from './canonical.js';

// Guard (transport-independent)
export { createMcpPaymentGuard } from './guard.js';
export type {
  McpPaymentGuard,
  McpGuardOptions,
  McpGuardRequest,
  McpGuardDecision,
} from './guard.js';

// Fastify plugin
export { x402McpPlugin } from './fastify.js';

// Buyer transport
export { createX402McpHttpTransport } from './client.js';

// Discovery
export { toBazaarMcpResource } from './discovery.js';
export type { BazaarMcpResource } from './discovery.js';

// Events + receipts
export { X402McpEventEmitter } from './events.js';
export { MemoryMcpReceiptStore } from './receipts.js';

// Types
export type {
  McpTransportKind,
  McpContentBlock,
  McpToolResult,
  PaidMcpToolHandler,
  PaidMcpToolConfig,
  PaidMcpToolEntry,
  McpReceipt,
  McpReceiptStore,
  X402McpPluginOptions,
  X402McpClientOptions,
  X402McpClientPolicyContext,
  X402McpErrorReason,
  X402McpChallengeEvent,
  X402McpPaymentEvent,
  X402McpErrorEvent,
  X402McpEventMap,
} from './types.js';

import { EventEmitter } from 'events';
import type { X402McpEventMap } from './types.js';

/**
 * Typed event emitter for MCP payment lifecycle events:
 *  - x402:mcp:challenge — a 402 challenge was issued for a paid tool call
 *  - x402:mcp:payment   — a payment proof was verified and recorded
 *  - x402:mcp:error     — a paid call was rejected (invalid proof, replay, etc.)
 */
export class X402McpEventEmitter extends EventEmitter<X402McpEventMap> {}

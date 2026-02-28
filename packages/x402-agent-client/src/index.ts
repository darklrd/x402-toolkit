/**
 * x402-agent-client — public API
 *
 * Exports:
 *   x402Fetch      Drop-in fetch wrapper that handles 402 → pay → retry
 *   createTool     Agent-friendly tool factory backed by a priced endpoint
 *
 *   PayerInterface Interface that payer implementations must satisfy
 *   RequestContext Context object passed to payer.pay()
 *   X402Challenge  Type: 402 challenge body
 *   PaymentProof   Type: proof sent to server
 *   X402FetchOptions Options for x402Fetch
 *   ToolConfig     Options for createTool
 *   Tool           Type: tool object returned by createTool
 *   ToolInvokeResult Type: result of tool.invoke()
 */

export { x402Fetch } from './fetch.js';
export { createTool } from './tool.js';
export type { Tool } from './tool.js';

export type {
  PayerInterface,
  RequestContext,
  X402Challenge,
  X402ChallengeBody,
  PaymentProof,
  X402FetchOptions,
  ToolConfig,
  ToolInvokeResult,
  JsonSchema,
} from './types.js';

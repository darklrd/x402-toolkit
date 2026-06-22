/**
 * MCP payment guard — transport-independent.
 *
 * Given a parsed JSON-RPC request and its headers, decides whether to:
 *  - passthrough  : free method, or unpriced tool when allowed
 *  - challenge    : paid tool, no/invalid-format proof -> 402 challenge
 *  - reject       : batch, unknown tool (fail closed), invalid proof, replay
 *  - proceed      : verified payment -> forward to the MCP transport
 *
 * Mirrors the HTTP guard in x402-tool-server (middleware.ts) but binds proofs
 * to the canonical MCP request hash instead of the HTTP request hash.
 */
import { randomUUID } from 'crypto';
import {
  challengeToPaymentRequired,
  coinbasePayloadToProofHeader,
  extractProofHeader,
} from 'x402-tool-server';
import type { VerifierInterface, WireFormat, X402Challenge } from 'x402-tool-server';
import { computeMcpRequestHash, computeArgumentsHash } from './canonical.js';
import type { X402McpEventEmitter } from './events.js';
import type { McpReceipt, McpReceiptStore, PricingConfig } from './types.js';
import type { PaidMcpRegistry } from './registry.js';

export interface McpGuardOptions {
  transportPath: string;
  registry: PaidMcpRegistry;
  verifier: VerifierInterface;
  wireFormat?: WireFormat;
  defaultTtlSeconds?: number;
  allowUnpricedTools?: boolean;
  rejectBatchRequests?: boolean;
  receiptStore?: McpReceiptStore;
  events?: X402McpEventEmitter;
}

export interface McpGuardRequest {
  /** Parsed JSON-RPC body (object, or array for a batch). */
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  sessionId?: string;
}

export type McpGuardDecision =
  | { action: 'passthrough' }
  | { action: 'challenge'; status: 402; body: unknown; headers: Record<string, string> }
  | { action: 'reject'; status: number; body: unknown }
  | { action: 'proceed' };

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export interface McpPaymentGuard {
  evaluate(request: McpGuardRequest): Promise<McpGuardDecision>;
  /** Stop the background nonce sweep (for tests / shutdown). */
  dispose(): void;
}

export function createMcpPaymentGuard(options: McpGuardOptions): McpPaymentGuard {
  const {
    transportPath,
    registry,
    verifier,
    wireFormat = 'toolkit',
    defaultTtlSeconds = 300,
    allowUnpricedTools = false,
    rejectBatchRequests = true,
    receiptStore,
    events,
  } = options;

  // In-memory nonce replay protection: nonce -> expiry epoch ms.
  const usedNonces = new Map<string, number>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [nonce, exp] of usedNonces) {
      if (now > exp) usedNonces.delete(nonce);
    }
  }, 60_000);
  if (sweep.unref) sweep.unref();

  function buildChallenge(
    pricing: PricingConfig,
    requestHash: string,
  ): { challenge: X402Challenge; body: unknown; headers: Record<string, string> } {
    const ttl = pricing.ttlSeconds ?? defaultTtlSeconds;
    const challenge: X402Challenge = {
      version: 1,
      scheme: pricing.scheme ?? 'exact',
      price: pricing.price,
      asset: pricing.asset,
      network: pricing.network ?? 'mock',
      recipient: pricing.recipient,
      nonce: randomUUID(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      requestHash,
      description: pricing.description,
    };

    const headers: Record<string, string> = {};
    if (wireFormat === 'coinbase' || wireFormat === 'dual') {
      const assetDecimals = pricing.assetDecimals ?? 6;
      const pr = challengeToPaymentRequired(challenge, transportPath, assetDecimals);
      headers['payment-required'] = Buffer.from(JSON.stringify(pr), 'utf8').toString('base64');
    }

    const body =
      wireFormat === 'toolkit' || wireFormat === 'dual'
        ? { x402: challenge }
        : { error: 'Payment Required' };

    return { challenge, body, headers };
  }

  async function evaluate(request: McpGuardRequest): Promise<McpGuardDecision> {
    const { body, headers, ip, sessionId } = request;

    // ── Reject JSON-RPC batches ──────────────────────────────────────────────
    if (Array.isArray(body)) {
      if (rejectBatchRequests) {
        events?.emit('x402:mcp:error', {
          mcpMethod: 'tools/call',
          reason: 'batch_rejected',
          timestamp: new Date().toISOString(),
          ip,
        });
        return {
          action: 'reject',
          status: 400,
          body: jsonRpcError(null, -32600, 'JSON-RPC batch requests are not supported'),
        };
      }
      return { action: 'passthrough' };
    }

    if (body === null || typeof body !== 'object') {
      return { action: 'passthrough' };
    }

    const rpc = body as JsonRpcRequest;

    // ── Only tools/call is payable ───────────────────────────────────────────
    if (rpc.method !== 'tools/call') {
      return { action: 'passthrough' };
    }

    const toolName = rpc.params?.name;
    if (!toolName) {
      // Malformed tools/call — let the MCP server return a proper JSON-RPC error.
      return { action: 'passthrough' };
    }

    const entry = registry.get(toolName);
    if (!entry) {
      if (allowUnpricedTools) {
        return { action: 'passthrough' };
      }
      events?.emit('x402:mcp:error', {
        toolName,
        mcpMethod: 'tools/call',
        reason: 'unknown_tool',
        timestamp: new Date().toISOString(),
        ip,
      });
      return {
        action: 'reject',
        status: 200,
        body: jsonRpcError(rpc.id, -32601, `Unknown paid tool: ${toolName}`),
      };
    }

    const pricing = entry.config.pricing;
    const args = rpc.params?.arguments ?? {};
    const requestHash = computeMcpRequestHash({ transportPath, toolName, args });

    // ── No proof -> issue a 402 challenge ────────────────────────────────────
    const extracted = extractProofHeader(headers);
    if (!extracted) {
      const { challenge, body: challengeBody, headers: challengeHeaders } = buildChallenge(
        pricing,
        requestHash,
      );
      events?.emit('x402:mcp:challenge', {
        toolName,
        mcpMethod: 'tools/call',
        pricing,
        challenge,
        requestHash,
        timestamp: new Date().toISOString(),
        ip,
      });
      return { action: 'challenge', status: 402, body: challengeBody, headers: challengeHeaders };
    }

    // ── Verify proof against the canonical MCP request hash ──────────────────
    const normalizedProof =
      extracted.format === 'coinbase'
        ? coinbasePayloadToProofHeader(extracted.proof)
        : extracted.proof;

    const valid = await verifier.verify(normalizedProof, requestHash, pricing);
    if (!valid) {
      events?.emit('x402:mcp:error', {
        toolName,
        mcpMethod: 'tools/call',
        reason: 'invalid_proof',
        pricing,
        requestHash,
        timestamp: new Date().toISOString(),
        ip,
      });
      return {
        action: 'reject',
        status: 402,
        body: {
          error: 'Invalid or expired payment proof',
          hint: 'Obtain a fresh challenge by retrying this tools/call without a payment proof header',
        },
      };
    }

    // ── Replay protection + receipt + event ──────────────────────────────────
    let proof: { nonce?: string; expiresAt?: string; payer?: string; timestamp?: string } = {};
    try {
      proof = JSON.parse(Buffer.from(normalizedProof, 'base64url').toString('utf8'));
    } catch {
      // Proof already passed verification; tolerate parse failure for replay/receipt.
    }

    const nonce = proof.nonce;
    if (nonce) {
      if (usedNonces.has(nonce)) {
        events?.emit('x402:mcp:error', {
          toolName,
          mcpMethod: 'tools/call',
          reason: 'nonce_replay',
          pricing,
          requestHash,
          timestamp: new Date().toISOString(),
          ip,
        });
        return {
          action: 'reject',
          status: 402,
          body: { error: 'Nonce already used (replay detected)' },
        };
      }
      // Keep the nonce until its expiry + 60s grace. Fall back to a fixed TTL
      // if expiresAt is missing or unparsable, otherwise a NaN expiry would
      // never be swept (the entry would leak forever).
      const parsedExpiry = proof.expiresAt ? new Date(proof.expiresAt).getTime() : NaN;
      const expMs = Number.isFinite(parsedExpiry) ? parsedExpiry + 60_000 : Date.now() + 360_000;
      usedNonces.set(nonce, expMs);
    }

    if (receiptStore && nonce) {
      const receipt: McpReceipt = {
        nonce,
        payer: proof.payer ?? 'unknown',
        amount: pricing.price,
        asset: pricing.asset,
        network: pricing.network ?? 'mock',
        recipient: pricing.recipient,
        endpoint: transportPath,
        method: 'MCP',
        requestHash,
        paidAt: proof.timestamp ?? new Date().toISOString(),
        toolName,
        mcpMethod: 'tools/call',
        argumentsHash: computeArgumentsHash(args),
        sessionId,
      };
      receiptStore.save(receipt);

      events?.emit('x402:mcp:payment', {
        toolName,
        mcpMethod: 'tools/call',
        pricing,
        requestHash,
        payer: receipt.payer,
        receipt,
        timestamp: new Date().toISOString(),
        ip,
      });
    } else {
      events?.emit('x402:mcp:payment', {
        toolName,
        mcpMethod: 'tools/call',
        pricing,
        requestHash,
        payer: proof.payer ?? 'unknown',
        receipt: {
          nonce: nonce ?? '',
          payer: proof.payer ?? 'unknown',
          amount: pricing.price,
          asset: pricing.asset,
          network: pricing.network ?? 'mock',
          recipient: pricing.recipient,
          endpoint: transportPath,
          method: 'MCP',
          requestHash,
          paidAt: proof.timestamp ?? new Date().toISOString(),
          toolName,
          mcpMethod: 'tools/call',
          argumentsHash: computeArgumentsHash(args),
          sessionId,
        },
        timestamp: new Date().toISOString(),
        ip,
      });
    }

    return { action: 'proceed' };
  }

  return {
    evaluate,
    dispose() {
      clearInterval(sweep);
    },
  };
}

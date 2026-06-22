/**
 * createX402McpHttpTransport — a payer-enabled MCP Streamable HTTP transport.
 *
 * Wraps the SDK's StreamableHTTPClientTransport with a custom fetch that runs
 * the x402 402 -> pay -> retry loop. On a 402 it parses the challenge (toolkit
 * body or Coinbase header), infers the tool name from the outgoing JSON-RPC
 * request, runs the optional policy hook, reserves budget, signs via the
 * payer, and retries with the correct proof header.
 *
 * The loop mirrors x402Fetch from @darklrd/x402-agent-client, adding the
 * MCP-specific policy hook and tool-name inference.
 */
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  parseCoinbasePaymentRequired,
  encodeCoinbasePaymentSignature,
} from '@darklrd/x402-agent-client';
import type { PaymentProof, X402Challenge } from '@darklrd/x402-agent-client';
import type { X402McpClientOptions } from './types.js';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface ParsedChallenge {
  challenge: X402Challenge;
  format: 'toolkit' | 'coinbase';
}

async function parseChallenge(response: Response): Promise<ParsedChallenge | null> {
  const header = response.headers.get('payment-required');
  if (header) {
    const challenge = parseCoinbasePaymentRequired(header);
    if (challenge) {
      // Drain the body so the socket is released before we retry (this path
      // reads only headers, unlike the toolkit path which consumes JSON).
      await response.body?.cancel().catch(() => undefined);
      return { challenge, format: 'coinbase' };
    }
    // Unparseable Coinbase header — fall through to the toolkit body, which
    // `wireFormat: 'dual'` servers also emit.
  }
  try {
    const body = (await response.json()) as unknown;
    if (body !== null && typeof body === 'object' && 'x402' in body) {
      const x402 = (body as Record<string, unknown>).x402;
      if (x402 !== null && typeof x402 === 'object' && !Array.isArray(x402)) {
        return { challenge: x402 as X402Challenge, format: 'toolkit' };
      }
    }
  } catch {
    // not JSON / not a toolkit challenge
  }
  return null;
}

function inferToolName(body: unknown): { toolName: string; request: unknown } {
  if (typeof body !== 'string') return { toolName: '', request: body };
  try {
    const parsed = JSON.parse(body) as { method?: string; params?: { name?: string } };
    if (parsed && parsed.method === 'tools/call') {
      return { toolName: parsed.params?.name ?? '', request: parsed };
    }
    return { toolName: '', request: parsed };
  } catch {
    return { toolName: '', request: body };
  }
}

function mergeHeaders(
  existing: RequestInit['headers'],
  add: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (existing instanceof Headers) {
    existing.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(existing)) {
    for (const [key, value] of existing) out[key] = value;
  } else if (existing) {
    Object.assign(out, existing);
  }
  Object.assign(out, add);
  return out;
}

export function createX402McpHttpTransport(
  url: string | URL,
  options: X402McpClientOptions,
): StreamableHTTPClientTransport {
  const { payer, budget, maxRetries = 1, policy } = options;
  const targetUrl = typeof url === 'string' ? new URL(url) : url;

  const x402fetch: FetchLike = async (reqUrl, init) => {
    const urlStr = reqUrl instanceof URL ? reqUrl.toString() : String(reqUrl);
    const method = (init?.method ?? 'GET').toUpperCase();

    let response = await fetch(reqUrl, init);

    for (let attempt = 0; attempt < maxRetries && response.status === 402; attempt++) {
      const parsed = await parseChallenge(response);
      if (!parsed) break;

      const { challenge, format } = parsed;
      const { toolName, request } = inferToolName(init?.body);

      if (policy) {
        const allowed = await policy({ toolName, challenge, request });
        if (!allowed) {
          throw new Error(`x402-mcp: payment denied by policy for tool "${toolName}"`);
        }
      }

      if (budget) budget.reserve(challenge.price);

      let proof: PaymentProof;
      try {
        proof = await payer.pay(challenge, { url: urlStr, method });
      } catch (err) {
        if (budget) budget.release(challenge.price);
        throw err;
      }

      const headerName = format === 'coinbase' ? 'payment-signature' : 'x-payment-proof';
      const headerValue =
        format === 'coinbase'
          ? encodeCoinbasePaymentSignature(proof, challenge)
          : Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');

      const retryInit: RequestInit = {
        ...init,
        headers: mergeHeaders(init?.headers, { [headerName]: headerValue }),
      };

      response = await fetch(reqUrl, retryInit);
    }

    return response;
  };

  return new StreamableHTTPClientTransport(targetUrl, { fetch: x402fetch });
}

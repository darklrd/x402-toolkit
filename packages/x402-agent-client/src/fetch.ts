/**
 * x402Fetch — a drop-in fetch wrapper that handles the 402 → pay → retry loop.
 *
 * Algorithm:
 *   1. Send the request normally.
 *   2. If the response is 402, parse the X402Challenge from the body.
 *   3. Call payer.pay(challenge, context) to get a PaymentProof.
 *   4. Encode the proof as base64url JSON and attach it as X-Payment-Proof.
 *   5. Retry the request (at most `maxRetries` times, default 1).
 *   6. Return whatever the server responds with on the retry.
 */
import type {
  X402ChallengeBody,
  PaymentProof,
  X402FetchOptions,
  RequestContext,
} from './types.js';

/** Encode a payment proof for the X-Payment-Proof header */
function encodeProof(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

/** Parse a 402 response body into X402ChallengeBody */
async function parseChallengeBody(response: Response): Promise<X402ChallengeBody | null> {
  try {
    const body = await response.json() as unknown;
    if (
      body !== null &&
      typeof body === 'object' &&
      'x402' in body &&
      typeof (body as Record<string, unknown>).x402 === 'object'
    ) {
      return body as X402ChallengeBody;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * x402Fetch — wraps the global `fetch` with automatic 402 handling.
 *
 * @param url          - Request URL (string or URL)
 * @param init         - Standard RequestInit options
 * @param x402Options  - x402 options: payer and maxRetries
 * @returns            The final Response (after any payment retry)
 */
export async function x402Fetch(
  url: string | URL,
  init: RequestInit = {},
  x402Options: X402FetchOptions,
): Promise<Response> {
  const { payer, maxRetries = 1 } = x402Options;
  const urlStr = url instanceof URL ? url.toString() : url;
  const method = (init.method ?? 'GET').toUpperCase();

  const context: RequestContext = { url: urlStr, method };

  // Initial attempt (no proof).
  let response = await fetch(url, init);

  for (let attempt = 0; attempt < maxRetries && response.status === 402; attempt++) {
    const challengeBody = await parseChallengeBody(response);

    if (!challengeBody) {
      // 402 but not from x402 — return as-is.
      break;
    }

    const { x402: challenge } = challengeBody;

    // Ask the payer to generate a proof.
    const proof = await payer.pay(challenge, context);
    const proofHeader = encodeProof(proof);

    // Retry the request with the payment proof.
    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...init.headers,
        'x-payment-proof': proofHeader,
      },
    };

    response = await fetch(url, retryInit);
  }

  return response;
}

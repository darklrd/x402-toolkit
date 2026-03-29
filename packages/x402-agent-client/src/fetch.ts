import type {
  X402Challenge,
  X402ChallengeBody,
  PaymentProof,
  X402FetchOptions,
  RequestContext,
} from './types.js';
import {
  parseCoinbasePaymentRequired,
  encodeCoinbasePaymentSignature,
} from './compat.js';

function encodeProof(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url');
}

async function parseChallengeFromResponse(
  response: Response,
): Promise<{ challenge: X402Challenge; format: 'toolkit' | 'coinbase' } | null> {
  const paymentRequiredHeader = response.headers.get('payment-required');
  if (paymentRequiredHeader) {
    const challenge = parseCoinbasePaymentRequired(paymentRequiredHeader);
    if (challenge) return { challenge, format: 'coinbase' };
  }

  try {
    const body = await response.json() as unknown;
    if (
      body !== null &&
      typeof body === 'object' &&
      'x402' in body &&
      typeof (body as Record<string, unknown>).x402 === 'object'
    ) {
      return { challenge: (body as X402ChallengeBody).x402, format: 'toolkit' };
    }
    return null;
  } catch {
    return null;
  }
}

export async function x402Fetch(
  url: string | URL,
  init: RequestInit = {},
  x402Options: X402FetchOptions,
): Promise<Response> {
  const { payer, maxRetries = 1 } = x402Options;
  const urlStr = url instanceof URL ? url.toString() : url;
  const method = (init.method ?? 'GET').toUpperCase();

  const context: RequestContext = { url: urlStr, method };

  let response = await fetch(url, init);

  for (let attempt = 0; attempt < maxRetries && response.status === 402; attempt++) {
    const parsed = await parseChallengeFromResponse(response);

    if (!parsed) {
      break;
    }

    const { challenge, format: challengeFormat } = parsed;
    const { budget } = x402Options;

    if (budget) {
      budget.reserve(challenge.price);
    }

    let proof: PaymentProof;
    try {
      proof = await payer.pay(challenge, context);
    } catch (err) {
      if (budget) budget.release(challenge.price);
      throw err;
    }

    const headerName = challengeFormat === 'coinbase' ? 'payment-signature' : 'x-payment-proof';
    const headerValue = challengeFormat === 'coinbase'
      ? encodeCoinbasePaymentSignature(proof, challenge)
      : encodeProof(proof);

    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...init.headers,
        [headerName]: headerValue,
      },
    };

    response = await fetch(url, retryInit);
  }

  return response;
}

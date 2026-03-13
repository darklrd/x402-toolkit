import type { X402Challenge, PaymentProof, RequestContext } from './browser-payer';

export type FlowStep =
  | { type: 'request'; url: string }
  | { type: '402'; challenge: X402Challenge }
  | { type: 'signing' }
  | { type: 'signed'; signature: string }
  | { type: 'retry' }
  | { type: 'success'; status: number; data: Record<string, unknown> }
  | { type: 'error'; message: string };

interface Payer {
  pay(challenge: X402Challenge, context: RequestContext): Promise<PaymentProof>;
}

function encodeProofBase64Url(proof: PaymentProof): string {
  const json = JSON.stringify(proof);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function x402BrowserFetch(
  url: string,
  payer: Payer,
  onStep: (step: FlowStep) => void,
): Promise<Response> {
  const method = 'GET';
  const context: RequestContext = { url, method };

  onStep({ type: 'request', url });

  let response = await fetch(url);

  if (response.status !== 402) {
    if (response.ok) {
      const data = (await response.clone().json()) as Record<string, unknown>;
      onStep({ type: 'success', status: response.status, data });
    }
    return response;
  }

  const body = (await response.json()) as { x402?: X402Challenge };
  if (!body.x402) return response;

  onStep({ type: '402', challenge: body.x402 });
  onStep({ type: 'signing' });

  const proof = await payer.pay(body.x402, context);
  onStep({ type: 'signed', signature: proof.signature });
  const proofHeader = encodeProofBase64Url(proof);

  onStep({ type: 'retry' });

  response = await fetch(url, {
    headers: { 'x-payment-proof': proofHeader },
  });

  if (response.ok) {
    const data = (await response.clone().json()) as Record<string, unknown>;
    onStep({ type: 'success', status: response.status, data });
  } else {
    onStep({ type: 'error', message: `Server returned ${response.status}` });
  }

  return response;
}

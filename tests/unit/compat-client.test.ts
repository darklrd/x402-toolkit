import { describe, it, expect } from 'vitest';
import {
  detectChallengeFormat,
  parseCoinbasePaymentRequired,
  encodeCoinbasePaymentSignature,
} from '@darklrd/x402-agent-client/compat';
import type { X402Challenge, PaymentProof } from '@darklrd/x402-agent-client';

function makeChallenge(overrides: Partial<X402Challenge> = {}): X402Challenge {
  return {
    version: 1,
    scheme: 'exact',
    price: '0.001',
    asset: 'USDC',
    network: 'mock',
    recipient: '0xTEST',
    nonce: 'test-nonce',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    requestHash: 'a'.repeat(64),
    ...overrides,
  };
}

function makeProof(challenge: X402Challenge): PaymentProof {
  return {
    version: challenge.version,
    nonce: challenge.nonce,
    requestHash: challenge.requestHash,
    payer: 'mock://0x0001',
    timestamp: new Date().toISOString(),
    expiresAt: challenge.expiresAt,
    signature: 'fake-sig',
  };
}

function encodeCoinbasePaymentRequired(pr: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(pr), 'utf8').toString('base64');
}

describe('detectChallengeFormat', () => {
  it('toolkit format when no PAYMENT-REQUIRED header', () => {
    const response = new Response('{}', { status: 402 });
    expect(detectChallengeFormat(response)).toBe('unknown');
  });

  it('coinbase format from header', () => {
    const response = new Response('{}', {
      status: 402,
      headers: { 'payment-required': 'some-base64' },
    });
    expect(detectChallengeFormat(response)).toBe('coinbase');
  });

  it('unknown when neither', () => {
    const response = new Response('not json', { status: 402 });
    expect(detectChallengeFormat(response)).toBe('unknown');
  });
});

describe('parseCoinbasePaymentRequired', () => {
  it('decodes valid header', () => {
    const pr = {
      x402Version: 1,
      resource: { url: '/weather' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'test-nonce', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    const encoded = encodeCoinbasePaymentRequired(pr);
    const challenge = parseCoinbasePaymentRequired(encoded);
    expect(challenge).not.toBeNull();
    expect(challenge!.scheme).toBe('exact');
    expect(challenge!.network).toBe('mock');
    expect(challenge!.recipient).toBe('0xTEST');
  });

  it('returns null for invalid base64', () => {
    expect(parseCoinbasePaymentRequired('not-valid-base64!!!')).toBeNull();
  });

  it('returns null for missing accepts', () => {
    const pr = { x402Version: 1, resource: { url: '/test' }, accepts: [] };
    const encoded = encodeCoinbasePaymentRequired(pr);
    expect(parseCoinbasePaymentRequired(encoded)).toBeNull();
  });

  it('maps amount back to price', () => {
    const pr = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'mock:1',
          asset: 'USDC',
          amount: '100000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    const encoded = encodeCoinbasePaymentRequired(pr);
    const challenge = parseCoinbasePaymentRequired(encoded);
    expect(challenge!.price).toBe('0.100000');
  });

  it('maps CAIP-2 back to toolkit network', () => {
    const pr = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    const encoded = encodeCoinbasePaymentRequired(pr);
    const challenge = parseCoinbasePaymentRequired(encoded);
    expect(challenge!.network).toBe('base-sepolia');
  });

  it('maps asset address back to symbol', () => {
    const pr = {
      x402Version: 1,
      resource: { url: '/test' },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          amount: '1000',
          payTo: '0xTEST',
          maxTimeoutSeconds: 300,
          extra: { nonce: 'n', requestHash: 'a'.repeat(64) },
        },
      ],
    };
    const encoded = encodeCoinbasePaymentRequired(pr);
    const challenge = parseCoinbasePaymentRequired(encoded);
    expect(challenge!.asset).toBe('USDC');
  });
});

describe('encodeCoinbasePaymentSignature', () => {
  it('produces valid base64', () => {
    const challenge = makeChallenge();
    const proof = makeProof(challenge);
    const result = encodeCoinbasePaymentSignature(proof, challenge);
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString('utf8'));
    expect(decoded).toHaveProperty('x402Version', 1);
  });

  it('includes accepted requirements', () => {
    const challenge = makeChallenge();
    const proof = makeProof(challenge);
    const result = encodeCoinbasePaymentSignature(proof, challenge);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString('utf8'));
    expect(decoded.accepted).toHaveProperty('scheme', 'exact');
    expect(decoded.accepted).toHaveProperty('payTo', '0xTEST');
  });

  it('includes payload with signature', () => {
    const challenge = makeChallenge();
    const proof = makeProof(challenge);
    const result = encodeCoinbasePaymentSignature(proof, challenge);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString('utf8'));
    expect(decoded.payload).toHaveProperty('signature', 'fake-sig');
  });
});
